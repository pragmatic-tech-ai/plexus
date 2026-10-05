import { ServiceBase, ServiceKey, type IDisposable, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { editorSemanticLegend } from './semantic-scopes.js'
import { SolutionLanguageService, SemanticTokensProvider } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { CodeDocument } from '../../modules/code-editor/code-document.js'
import { collectTodlSources } from './todl-sources.js'
import { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostic.js'
import { lspToMonacoRange, type MonacoRange } from '../../modules/meta-model/todl-lsp/position.js'
import type { Position, Range, Location, WorkspaceEdit, CodeAction, TextEdit, Diagnostic as LspDiagnostic } from 'vscode-languageserver-types'

// An LSP TextEdit + WorkspaceEdit slice, as consumed by applyWorkspaceEdit.
interface LspTextEdit { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }
interface WorkspaceEditLike { changes?: Record<string, LspTextEdit[]> }
interface EditableModel { applyEdits(edits: Array<{ range: MonacoRange; text: string }>): void }

// The request params the Monaco provider adapters send through sendRequest. They
// always carry a todl:// textDocument.uri; feature-specific fields ride alongside.
interface UriParam { textDocument: { uri: string } }
interface PositionParam extends UriParam { position: Position }
interface ReferenceParam extends PositionParam { context?: { includeDeclaration?: boolean } }
interface RenameParam extends PositionParam { newName: string }
interface CodeActionParam extends UriParam { range: Range; context?: { diagnostics?: LspDiagnostic[] } }

export interface SemanticLegend { tokenTypes: string[]; tokenModifiers: string[] }

// One open project as the client knows it: its identity (projectId =
// Project.RootPath), display name, and the storage its sources live in. Keyed in
// the registry by projectKey = lowercase-hex(projectId), which is also the
// authority segment of every todl:// URI for the project.
interface RegisteredProject
{
  projectId: string
  projectName: string
  storage: IStorage
}

// The renderer-side TODL language client: a thin in-process adapter over the
// registered SolutionLanguageService (ILanguageService). It owns a synthetic-URI
// registry mapping documents to/from (project, storage, relpath), feeds project
// sources into the service as live buffers (DidChange), pulls diagnostics back,
// translates URIs across the service boundary, and applies WorkspaceEdits.
//
// URI contract: the Monaco side speaks todl://<hex-projectKey>/<relpath>; the
// service keys projects by storage.Root (trailing '/') and serves only buffers
// pushed under that root. So every request URI is translated todl://→service, and
// every URI the service returns (Location / WorkspaceEdit keys) is rewritten
// service→todl:// before it reaches Monaco. applyWorkspaceEdit stays todl://-based.
export class TodlLanguageClient extends ServiceBase
{
  public static readonly Key = new ServiceKey<TodlLanguageClient>('TodlLanguageClient')

  // LSP method strings the provider adapters dispatch on (providers.ts emits these).
  private static readonly MethodHover = 'textDocument/hover'
  private static readonly MethodDefinition = 'textDocument/definition'
  private static readonly MethodReferences = 'textDocument/references'
  private static readonly MethodCompletion = 'textDocument/completion'
  private static readonly MethodFoldingRange = 'textDocument/foldingRange'
  private static readonly MethodDocumentSymbol = 'textDocument/documentSymbol'
  private static readonly MethodSemanticTokens = 'textDocument/semanticTokens/full'
  private static readonly MethodSignatureHelp = 'textDocument/signatureHelp'
  private static readonly MethodPrepareRename = 'textDocument/prepareRename'
  private static readonly MethodRename = 'textDocument/rename'
  private static readonly MethodCodeAction = 'textDocument/codeAction'
  private static readonly MethodFormatting = 'textDocument/formatting'

  // The todl:// scheme prefix + the root separator (mirrors the service's
  // RootUriOf trailing-'/' normalization exactly).
  private static readonly TodlUriScheme = 'todl://'
  private static readonly RootSeparator = '/'
  // The diagnostics producer id this client publishes under.
  private static readonly DiagnosticOwner = 'todl'
  // The RenameError discriminant (RenameEdits returns WorkspaceEdit | { Error }).
  private static readonly RenameErrorKey = 'Error'
  // The service PropertyChanged signal raised when its stale-member set changes.
  private static readonly StaleMembersPropertyName = 'StaleMembers'

  // Prefix of the project-level "Unresolved base" problem diagnostic.
  private static readonly UnresolvedBasePrefix = 'Unresolved base: '
  private static readonly UnresolvedBaseSuffix = '.'
  private static readonly ProblemSeparator = '; '
  // Rejected by sendRequest for a method outside the dispatch table.
  private static readonly UnknownMethodMessage = 'TODL language client: unknown request method:'
  // Logged ('[plexus] ...', err) when an off-signal (StaleMembers / editor-edit)
  // diagnostics refresh rejects — these run fire-and-forget, so a rejection would
  // otherwise surface only as an unhandled promise rejection with no context.
  private static readonly StaleMembersRefreshFailedMessage = '[plexus] StaleMemberIds refresh failed:'
  private static readonly DiagnosticsRefreshFailedMessage = '[plexus] diagnostics refresh failed:'

  // LSP severity (1-based) → canonical severity. Unmapped ⇒ Error.
  private static readonly SeverityByLsp: Record<number, DiagnosticSeverity> = {
    1: DiagnosticSeverity.Error,
    2: DiagnosticSeverity.Warning,
    3: DiagnosticSeverity.Info,
    4: DiagnosticSeverity.Hint,
  }

  private readonly semanticLegend: SemanticLegend
  // Subscribers to "semantic tokens may have changed for a reason other than a
  // document edit" (bases refreshed / stale members).
  private readonly semanticStaleSubs = new Set<() => void>()
  private readonly projects = new Map<string, RegisteredProject>() // projectKey → project
  // Documents currently fed to the service per project (projectKey → set of
  // todl:// URIs), so edits/structural changes can re-push/forget the right ones.
  private readonly openDocs = new Map<string, Set<string>>()
  // Open editor documents → their current todl:// URI, and → the Content subscription.
  private readonly docUris = new Map<CodeDocument, string>()
  private readonly docListeners = new Map<CodeDocument, IDisposable>()
  // Latest canonical diagnostics per project (projectId → relpath → canonical), so
  // a per-URI pull can be flattened into the whole-project slice the store wants.
  private readonly diagsByProject = new Map<string, Map<string, Diagnostic[]>>()
  // Per-storage unresolved-base problems, pulled from the service and cached so
  // publishProject can append them synchronously.
  private readonly baseProblems = new Map<IStorage, string[]>()
  // The live subscription to the service's StaleMembers push, set by
  // SubscribeToStaleMembers (called once at init) — kept so a re-call is idempotent.
  private staleMembersSubscription: IDisposable | undefined

  constructor(provider: IServiceProvider)
  {
    super(provider)
    // The legend is intrinsic to the engine's token types now, not a handshake.
    this.semanticLegend = SemanticTokensProvider.Legend
  }

  // The in-process language service this adapter drives. Typed as the concrete
  // service so WhenIdle / PropertyChanged (beyond ILanguageService) are reachable.
  private get service(): SolutionLanguageService
  {
    return this.Provider.getRequired(SolutionLanguageService.Key)
  }

  private get diagnostics(): DiagnosticsService | undefined
  {
    return this.Provider.get(DiagnosticsService.Key)
  }

  // Issue a feature request from the Monaco provider adapters. Translates the
  // incoming todl:// URI to a service URI, calls the service, and rewrites any URIs
  // in the result back to todl:// (so navigation/edits stay in Monaco's namespace).
  public async sendRequest(method: string, params: unknown): Promise<unknown>
  {
    switch (method)
    {
      case TodlLanguageClient.MethodHover:
      {
        const p = params as PositionParam
        return this.service.HoverAt(this.serviceUriOf(p.textDocument.uri), p.position)
      }
      case TodlLanguageClient.MethodDefinition:
      {
        const p = params as PositionParam
        const loc = await this.service.DefinitionAt(this.serviceUriOf(p.textDocument.uri), p.position)
        return loc === null ? null : this.rewriteLocation(loc)
      }
      case TodlLanguageClient.MethodReferences:
      {
        const p = params as ReferenceParam
        const locs = await this.service.ReferencesAt(this.serviceUriOf(p.textDocument.uri), p.position, p.context?.includeDeclaration ?? false)
        return locs.map((l): Location => this.rewriteLocation(l))
      }
      case TodlLanguageClient.MethodCompletion:
      {
        const p = params as PositionParam
        return this.service.CompletionsAt(this.serviceUriOf(p.textDocument.uri), p.position)
      }
      case TodlLanguageClient.MethodFoldingRange:
      {
        const p = params as UriParam
        return this.service.FoldingRanges(this.serviceUriOf(p.textDocument.uri))
      }
      case TodlLanguageClient.MethodDocumentSymbol:
      {
        const p = params as UriParam
        return this.service.DocumentSymbols(this.serviceUriOf(p.textDocument.uri))
      }
      case TodlLanguageClient.MethodSemanticTokens:
      {
        const p = params as UriParam
        return this.service.SemanticTokens(this.serviceUriOf(p.textDocument.uri))
      }
      case TodlLanguageClient.MethodSignatureHelp:
      {
        const p = params as PositionParam
        return this.service.SignatureHelpAt(this.serviceUriOf(p.textDocument.uri), p.position)
      }
      case TodlLanguageClient.MethodPrepareRename:
      {
        const p = params as PositionParam
        return this.service.PrepareRename(this.serviceUriOf(p.textDocument.uri), p.position)
      }
      case TodlLanguageClient.MethodRename:
      {
        const p = params as RenameParam
        const res = await this.service.RenameEdits(this.serviceUriOf(p.textDocument.uri), p.position, p.newName)
        if (TodlLanguageClient.RenameErrorKey in res) return null
        return this.rewriteWorkspaceEdit(res)
      }
      case TodlLanguageClient.MethodCodeAction:
      {
        const p = params as CodeActionParam
        const actions = await this.service.CodeActions(this.serviceUriOf(p.textDocument.uri), p.range, p.context?.diagnostics ?? [])
        return actions.map((a): CodeAction => this.rewriteCodeAction(a))
      }
      case TodlLanguageClient.MethodFormatting:
      {
        const p = params as UriParam
        return this.service.FormatDocument(this.serviceUriOf(p.textDocument.uri))
      }
      default:
        return Promise.reject(new Error(`${TodlLanguageClient.UnknownMethodMessage} ${method}`))
    }
  }

  // Rewrite a Location's uri service→todl://.
  private rewriteLocation(loc: Location): Location
  {
    return { ...loc, uri: this.toMonacoUri(loc.uri) }
  }

  // Rewrite a WorkspaceEdit's changes keys service→todl://.
  private rewriteWorkspaceEdit(edit: WorkspaceEdit): WorkspaceEdit
  {
    if (edit.changes === undefined) return edit
    const changes: Record<string, TextEdit[]> = {}
    for (const [uri, edits] of Object.entries(edit.changes)) changes[this.toMonacoUri(uri)] = edits
    return { ...edit, changes }
  }

  // Rewrite a CodeAction's embedded WorkspaceEdit keys service→todl://.
  private rewriteCodeAction(action: CodeAction): CodeAction
  {
    if (action.edit === undefined) return action
    return { ...action, edit: this.rewriteWorkspaceEdit(action.edit) }
  }

  // How to find an open editor's Monaco model by URI (production wires
  // monaco.editor.getModel; tests pass a fake). Null ⇒ the file is closed.
  private findModel: ((uri: string) => EditableModel | null) | undefined
  public setModelFinder(fn: (uri: string) => EditableModel | null): void
  {
    this.findModel = fn
  }

  // Apply a WorkspaceEdit through one path: open buffers via their Monaco model
  // (preserving dirty tracking + undo), closed files via storage. Rename and
  // quick-fixes delegate here rather than letting Monaco apply (which would drop
  // closed-file edits). Consumes todl:// keys — unchanged from the IPC era.
  public async applyWorkspaceEdit(edit: WorkspaceEditLike): Promise<void>
  {
    for (const [uri, edits] of Object.entries(edit.changes ?? {}))
    {
      const model = this.findModel?.(uri) ?? null
      if (model !== null)
      {
        model.applyEdits(edits.map((e) => ({ range: lspToMonacoRange(e.range), text: e.newText })))
        continue
      }
      const resolved = this.resolveUri(uri)
      if (resolved === null) continue
      const text = await resolved.storage.ReadText(resolved.relpath)
      await resolved.storage.WriteText(resolved.relpath, TodlLanguageClient.ApplyTextEdits(text, edits))
    }
  }

  // Absolute offset of a 0-based (line, character) position in text.
  private static OffsetAt(text: string, line: number, character: number): number
  {
    let i = 0
    let curLine = 0
    while (i < text.length && curLine < line) { if (text[i] === '\n') curLine++; i++ }
    return i + character
  }

  // Apply LSP TextEdits to a string, offset-descending so earlier edits don't
  // shift later offsets. Pure — the closed-file write path relies on it.
  private static ApplyTextEdits(text: string, edits: readonly LspTextEdit[]): string
  {
    const resolved = edits
      .map((e) => ({
        start: TodlLanguageClient.OffsetAt(text, e.range.start.line, e.range.start.character),
        end: TodlLanguageClient.OffsetAt(text, e.range.end.line, e.range.end.character),
        newText: e.newText,
      }))
      .sort((a, b) => b.start - a.start)
    let out = text
    for (const e of resolved) out = out.slice(0, e.start) + e.newText + out.slice(e.end)
    return out
  }

  // The semantic-tokens legend advertised to the Monaco provider. The engine's
  // concept-bearing types (`type`/`class`) are renamed to TODL-only scopes so a
  // blue theme rule targets .todl without colliding with the mural grammar.
  public SemanticLegend(): SemanticLegend
  {
    return editorSemanticLegend(this.semanticLegend)
  }

  // Subscribe to semantic-token staleness. The Monaco semantic-tokens provider
  // forwards this to its onDidChange so open documents re-fetch — this is how a
  // newly added meta-model concept recolors live, without a document edit.
  public onSemanticTokensStale(cb: () => void): () => void
  {
    this.semanticStaleSubs.add(cb)
    return () => { this.semanticStaleSubs.delete(cb) }
  }

  private fireSemanticStale(): void
  {
    for (const cb of [...this.semanticStaleSubs]) cb()
  }

  // The opaque authority segment for a project's URIs. MUST be lowercase-hex
  // (no chars Monaco's Uri would decode/lowercase): Monaco normalizes a URI's
  // authority (lowercases it, decodes %XX), so `model.uri.toString()` sent on
  // requests must equal the string we register. encodeURIComponent(RootPath)
  // fails this (its `%3A`/`:` get mangled) — hex round-trips identically. The
  // registry maps the key back to the project, so it needn't be human-readable.
  public projectKeyFor(projectId: string): string
  {
    let hex = ''
    for (let i = 0; i < projectId.length; i++) hex += projectId.charCodeAt(i).toString(16).padStart(2, '0')
    return hex
  }

  // A document URI: todl://<projectKey>/<relpath>. An empty relpath yields the
  // project rootUri.
  public uriFor(projectId: string, relpath: string): string
  {
    return `${TodlLanguageClient.TodlUriScheme}${this.projectKeyFor(projectId)}/${relpath}`
  }

  // Record a project so its URIs resolve back to (project, storage, relpath).
  public registerProject(projectId: string, projectName: string, storage: IStorage): void
  {
    this.projects.set(this.projectKeyFor(projectId), { projectId, projectName, storage })
  }

  // Reverse a todl:// URI to its project + storage + project-relative path, or
  // null when the project is unknown (e.g. after close).
  public resolveUri(uri: string): { projectId: string; storage: IStorage; relpath: string } | null
  {
    const rest = uri.startsWith(TodlLanguageClient.TodlUriScheme) ? uri.slice(TodlLanguageClient.TodlUriScheme.length) : ''
    const slash = rest.indexOf(TodlLanguageClient.RootSeparator)
    if (slash < 0) return null
    const key = rest.slice(0, slash)
    const relpath = rest.slice(slash + 1)
    const entry = this.projects.get(key)
    if (entry === undefined) return null
    return { projectId: entry.projectId, storage: entry.storage, relpath }
  }

  // The service's project-root URI for a storage: its Root normalized to a single
  // trailing separator (mirrors SolutionLanguageService.RootUriOf exactly, so
  // longest-prefix matching is byte-identical on both sides of the boundary).
  private static RootUriOf(storage: IStorage): string
  {
    const root = storage.Root
    return root.endsWith(TodlLanguageClient.RootSeparator) ? root : root + TodlLanguageClient.RootSeparator
  }

  // Monaco → service: the service URI for a (storage, relpath) pair.
  private static ServiceUriFor(storage: IStorage, relpath: string): string
  {
    return TodlLanguageClient.RootUriOf(storage) + relpath
  }

  // Monaco → service: derive (storage, relpath) from a todl:// URI and build the
  // service URI. Returns the input unchanged if the project is unknown (defensive).
  private serviceUriOf(uri: string): string
  {
    const resolved = this.resolveUri(uri)
    return resolved === null ? uri : TodlLanguageClient.ServiceUriFor(resolved.storage, resolved.relpath)
  }

  // Service → Monaco: among all registered projects whose service root is a prefix
  // of the service URI, pick the LONGEST-prefix match (symmetric with the service's
  // ProjectRegistry.ProjectFor, so nested roots attribute identically), strip it to
  // recover relpath, and rebuild the todl:// URI. Returns the input unchanged if no
  // project matches (defensive).
  private toMonacoUri(serviceUri: string): string
  {
    let bestProject: RegisteredProject | undefined
    let bestPrefix = ''
    for (const project of this.projects.values())
    {
      const prefix = TodlLanguageClient.RootUriOf(project.storage)
      if (serviceUri.startsWith(prefix) && prefix.length > bestPrefix.length)
      {
        bestProject = project
        bestPrefix = prefix
      }
    }
    if (bestProject === undefined) return serviceUri
    return this.uriFor(bestProject.projectId, serviceUri.slice(bestPrefix.length))
  }

  private projectByStorage(storage: IStorage): { key: string; project: RegisteredProject } | null
  {
    for (const [key, project] of this.projects) if (project.storage === storage) return { key, project }
    return null
  }

  // Register a project and feed every project .todl (the whole set — not just the
  // visible tab — so the service can analyze the project as a whole) into the
  // service as a live buffer, then pull the project's diagnostics. WhenIdle covers
  // the project-registration race: the service registers a newly-added member's
  // root on an async lifecycle tail that ProjectFor does not await.
  public async AttachProject(projectId: string, projectName: string, storage: IStorage): Promise<void>
  {
    this.registerProject(projectId, projectName, storage)
    const opened = new Set<string>()
    for (const s of await collectTodlSources(storage))
    {
      this.service.DidChange(TodlLanguageClient.ServiceUriFor(storage, s.uri), s.text)
      opened.add(this.uriFor(projectId, s.uri))
    }
    this.openDocs.set(this.projectKeyFor(projectId), opened)
    await this.service.WhenIdle()
    await this.RefreshDiagnostics(projectId, storage)
  }

  // Unregister a project on close: drop its registry + open docs + diagnostics.
  // (A removed buffer simply stops being pushed; there is no didClose.)
  public DetachProject(storage: IStorage): void
  {
    const found = this.projectByStorage(storage)
    if (found === null) return
    this.DisposeProjectDocuments(found.key)
    this.openDocs.delete(found.key)
    this.projects.delete(found.key)
    this.baseProblems.delete(storage)
    this.diagsByProject.delete(found.project.projectId)
    this.diagnostics?.ClearProject(found.project.projectId)
  }

  // Tear down the per-document Content subscriptions (and drop the doc→uri map
  // entries) for every open document under the detached project, so a project
  // open/close cycle doesn't pin closed documents or leak their listeners.
  private DisposeProjectDocuments(projectKey: string): void
  {
    const prefix = TodlLanguageClient.TodlUriScheme + projectKey + TodlLanguageClient.RootSeparator
    for (const [doc, uri] of [...this.docUris])
    {
      if (!uri.startsWith(prefix)) continue
      this.docListeners.get(doc)?.dispose()
      this.docListeners.delete(doc)
      this.docUris.delete(doc)
    }
  }

  // Re-pull a project's diagnostics after its bases may have changed. The service
  // refreshes its own warm bases on lifecycle/reference events; WhenIdle awaits
  // that serialized tail, then a fresh pull reflects the new bases.
  public async RefreshBases(storage: IStorage): Promise<void>
  {
    const found = this.projectByStorage(storage)
    if (found === null) return
    await this.service.WhenIdle()
    await this.RefreshDiagnostics(found.project.projectId, storage)
    this.fireSemanticStale()
  }

  // Called once at init (main.js, after both this client and the language service
  // are resolved): subscribe to the service's StaleMembers push so a producer/base
  // change flows into a coalesced editor refresh here. Re-callable — drops any
  // prior subscription first, so it stays idempotent.
  public SubscribeToStaleMembers(): void
  {
    this.staleMembersSubscription?.dispose()
    this.staleMembersSubscription = this.service.PropertyChanged(TodlLanguageClient.StaleMembersPropertyName).subscribe((): void =>
    {
      this.refreshAllProjects().catch((err: unknown) =>
      {
        console.error(TodlLanguageClient.StaleMembersRefreshFailedMessage, err)
      })
    })
  }

  // Over-refresh is acceptable here (few projects): a StaleMembers raise re-pulls
  // diagnostics for every registered project rather than mapping the stale set to
  // affected members. WhenIdle covers the member-add/reference-change tail the
  // service runs before its roots/bases settle.
  private async refreshAllProjects(): Promise<void>
  {
    await this.service.WhenIdle()
    for (const project of [...this.projects.values()]) await this.RefreshDiagnostics(project.projectId, project.storage)
    this.fireSemanticStale()
  }

  // Record a document's URI and publish it on the document so the editor keys its
  // Monaco model on it.
  private assignUri(doc: CodeDocument, uri: string): void
  {
    this.docUris.set(doc, uri)
    doc.Uri = uri
  }

  // Wire an open editor document to the service: assign its URI, ensure the service
  // has its buffer, and forward every Content edit as a full-text DidChange +
  // diagnostics re-pull. Idempotent.
  public AttachDocument(doc: CodeDocument, storage: IStorage): void
  {
    if (this.docListeners.has(doc)) return
    const found = this.projectByStorage(storage)
    if (found === null) return
    const uri = this.uriFor(found.project.projectId, doc.Id)
    this.assignUri(doc, uri)
    const opened = this.openDocs.get(found.key)
    if (opened !== undefined && !opened.has(uri))
    {
      opened.add(uri)
      this.service.DidChange(TodlLanguageClient.ServiceUriFor(storage, doc.Id), doc.Content)
    }
    const sub = doc.PropertyChanged(CodeDocument.ContentKey).subscribe((): void =>
    {
      this.onDocumentEdited(doc)
    })
    this.docListeners.set(doc, sub)
  }

  // Forward one editor edit to the service and re-pull the owning project's
  // diagnostics (an edit in one file can change diagnostics in siblings).
  private onDocumentEdited(doc: CodeDocument): void
  {
    const current = this.docUris.get(doc)
    if (current === undefined) return
    const resolved = this.resolveUri(current)
    if (resolved === null) return
    this.service.DidChange(TodlLanguageClient.ServiceUriFor(resolved.storage, resolved.relpath), doc.Content)
    this.scheduleDiagnostics(resolved.projectId, resolved.storage)
  }

  // Move a document to (storage, relpath): forget the old buffer, push the new one,
  // and refresh both the old and new project slices. The Content listener reads the
  // live URI, so it follows automatically.
  private moveDoc(doc: CodeDocument, storage: IStorage, relpath: string): void
  {
    const old = this.docUris.get(doc)
    const oldResolved = old !== undefined ? this.resolveUri(old) : null
    if (old !== undefined) for (const set of this.openDocs.values()) set.delete(old)
    const found = this.projectByStorage(storage)
    if (found === null) return
    const uri = this.uriFor(found.project.projectId, relpath)
    this.assignUri(doc, uri)
    this.openDocs.get(found.key)?.add(uri)
    this.service.DidChange(TodlLanguageClient.ServiceUriFor(storage, relpath), doc.Content)
    if (oldResolved !== null && oldResolved.projectId !== found.project.projectId)
    {
      this.scheduleDiagnostics(oldResolved.projectId, oldResolved.storage)
    }
    this.scheduleDiagnostics(found.project.projectId, storage)
  }

  // In-place rename within the same project; the storage is derived from the
  // document's current URI.
  public RelocateDocument(doc: CodeDocument, newPath: string): void
  {
    const old = this.docUris.get(doc)
    const resolved = old !== undefined ? this.resolveUri(old) : null
    if (resolved === null) return
    this.moveDoc(doc, resolved.storage, newPath)
  }

  // Cross-project move (doc.Id already points at the new path).
  public ReattachDocument(doc: CodeDocument, storage: IStorage): void
  {
    this.moveDoc(doc, storage, doc.Id)
  }

  // Reconcile the service's buffer set for a project with what is on disk now —
  // push every current .todl and forget the ones that disappeared (their slice
  // drops when the project is re-pulled). Covers explorer create/delete/rename
  // with no editor open.
  public async ResyncProject(projectId: string, storage: IStorage): Promise<void>
  {
    const key = this.projectKeyFor(projectId)
    const next = new Set<string>()
    for (const s of await collectTodlSources(storage))
    {
      this.service.DidChange(TodlLanguageClient.ServiceUriFor(storage, s.uri), s.text)
      next.add(this.uriFor(projectId, s.uri))
    }
    this.openDocs.set(key, next)
    await this.RefreshDiagnostics(projectId, storage)
  }

  // Fire-and-forget a diagnostics re-pull off a synchronous edit/move handler,
  // logging a rejection with context rather than leaking an unhandled rejection.
  private scheduleDiagnostics(projectId: string, storage: IStorage): void
  {
    this.RefreshDiagnostics(projectId, storage).catch((err: unknown) =>
    {
      console.error(TodlLanguageClient.DiagnosticsRefreshFailedMessage, err)
    })
  }

  // Pull diagnostics for every buffer currently open in the project, rebuild the
  // whole-project slice keyed by relpath, and publish it. An empty pull for a URI
  // clears that URI's slice. Reproduces the old whole-project publish.
  private async RefreshDiagnostics(projectId: string, storage: IStorage): Promise<void>
  {
    const key = this.projectKeyFor(projectId)
    const opened = this.openDocs.get(key) ?? new Set<string>()
    const project = this.projects.get(key)
    const projectName = project?.projectName ?? ''
    const byUri = new Map<string, Diagnostic[]>()
    for (const todlUri of opened)
    {
      const resolved = this.resolveUri(todlUri)
      if (resolved === null) continue
      const lsp = await this.service.DiagnosticsFor(TodlLanguageClient.ServiceUriFor(resolved.storage, resolved.relpath))
      byUri.set(resolved.relpath, TodlLanguageClient.ToCanonical(projectId, projectName, resolved.relpath, lsp))
    }
    this.diagsByProject.set(projectId, byUri)
    const resolvedBases = await this.service.ResolveBasesFor(storage)
    this.baseProblems.set(storage, resolvedBases.problems)
    this.publishProject(projectId)
  }

  // Map a file's LSP diagnostics (0-based, inclusive) to canonical (1-based,
  // exclusive end) keyed to the file's project-relative path.
  private static ToCanonical(projectId: string, projectName: string, relpath: string, lsp: readonly LspDiagnostic[]): Diagnostic[]
  {
    return lsp.map((d): Diagnostic => ({
      owner: TodlLanguageClient.DiagnosticOwner, projectId, projectName, uri: relpath,
      message: d.message,
      severity: TodlLanguageClient.SeverityByLsp[d.severity ?? 1] ?? DiagnosticSeverity.Error,
      span: {
        startLine: d.range.start.line + 1, startColumn: d.range.start.character + 1,
        endLine: d.range.end.line + 1, endColumn: d.range.end.character + 1,
      },
    }))
  }

  // Flatten a project's per-URI diagnostics (plus any unresolved-base problems)
  // and replace its slice in the store.
  private publishProject(projectId: string): void
  {
    const byUri = this.diagsByProject.get(projectId) ?? new Map<string, Diagnostic[]>()
    const flat: Diagnostic[] = []
    for (const list of byUri.values()) flat.push(...list)
    const project = [...this.projects.values()].find((p) => p.projectId === projectId)
    if (project !== undefined)
    {
      const problems = this.baseProblems.get(project.storage) ?? []
      if (problems.length > 0)
      {
        flat.push({
          owner: TodlLanguageClient.DiagnosticOwner, projectId, projectName: project.projectName, uri: null,
          message: TodlLanguageClient.UnresolvedBaseMessage(problems),
          severity: DiagnosticSeverity.Error, span: null,
        })
      }
    }
    this.diagnostics?.Publish(TodlLanguageClient.DiagnosticOwner, projectId, flat)
  }

  // The project-level "Unresolved base" message for a set of base problems.
  private static UnresolvedBaseMessage(problems: readonly string[]): string
  {
    return TodlLanguageClient.UnresolvedBasePrefix + problems.join(TodlLanguageClient.ProblemSeparator) + TodlLanguageClient.UnresolvedBaseSuffix
  }
}
