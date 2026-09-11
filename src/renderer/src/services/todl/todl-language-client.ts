import { ServiceBase, ServiceKey, type Disposable, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { editorSemanticLegend } from './semantic-scopes.js'
import type { MessageConnection } from 'vscode-jsonrpc'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { CodeDocument } from '../../modules/code-editor/code-document.js'
import { collectTodlSources } from './todl-sources.js'
import { WorkspaceBaseResolver } from '../projects/workspace-base-resolver.js'
import { DiagnosticsService } from '../diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../diagnostics/diagnostic.js'
import { lspToMonacoRange, type MonacoRange } from '../../modules/meta-model/todl-lsp/position.js'

// An LSP TextEdit + WorkspaceEdit slice, as returned by rename/code-action.
interface LspTextEdit { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }
interface WorkspaceEditLike { changes?: Record<string, LspTextEdit[]> }
interface EditableModel { applyEdits(edits: Array<{ range: MonacoRange; text: string }>): void }

// Absolute offset of a 0-based (line, character) position in text.
function offsetAt(text: string, line: number, character: number): number {
  let i = 0
  let curLine = 0
  while (i < text.length && curLine < line) { if (text[i] === '\n') curLine++; i++ }
  return i + character
}

// Apply LSP TextEdits to a string, offset-descending so earlier edits don't
// shift later offsets. Pure — the closed-file write path and its test rely on it.
export function applyTextEdits(text: string, edits: readonly LspTextEdit[]): string {
  const resolved = edits
    .map((e) => ({
      start: offsetAt(text, e.range.start.line, e.range.start.character),
      end: offsetAt(text, e.range.end.line, e.range.end.character),
      newText: e.newText,
    }))
    .sort((a, b) => b.start - a.start)
  let out = text
  for (const e of resolved) out = out.slice(0, e.start) + e.newText + out.slice(e.end)
  return out
}

// The slice of an LSP diagnostic / publish notification the client maps. LSP
// positions are 0-based; canonical diagnostics are 1-based with exclusive end.
interface LspRangeLike { start: { line: number; character: number }; end: { line: number; character: number } }
interface LspDiagnostic { range: LspRangeLike; message: string; severity?: number }
interface PublishDiagnosticsParams { uri: string; diagnostics: LspDiagnostic[] }

export interface SemanticLegend { tokenTypes: string[]; tokenModifiers: string[] }

const LSP_SEVERITY: Record<number, DiagnosticSeverity> = {
  1: DiagnosticSeverity.Error,
  2: DiagnosticSeverity.Warning,
  3: DiagnosticSeverity.Info,
  4: DiagnosticSeverity.Hint,
}

// One open project as the client knows it: its identity (projectId =
// Project.RootPath), display name, and the storage its sources live in. Keyed in
// the registry by projectKey = encodeURIComponent(projectId), which is also the
// authority segment of every todl:// URI for the project.
interface RegisteredProject {
  projectId: string
  projectName: string
  storage: IStorage
}

// The renderer-side TODL language client. Owns the MessageConnection to the
// out-of-process server, a synthetic-URI registry that maps documents to/from
// (project, storage, relpath), the project source/base feed, diagnostics
// routing, and WorkspaceEdit application. Replaces TodlValidationService.
//
// This file grows in layers: registry (here) → source/base feed → document sync
// → diagnostics routing → WorkspaceEdit application.
export class TodlLanguageClient extends ServiceBase {
  public static readonly Key = new ServiceKey<TodlLanguageClient>('TodlLanguageClient')

  private connection: MessageConnection | undefined
  private semanticLegend: SemanticLegend | undefined
  // Subscribers to "semantic tokens may have changed for a reason other than a
  // document edit" (bases refreshed / server reinitialized).
  private readonly semanticStaleSubs = new Set<() => void>()
  private readonly projects = new Map<string, RegisteredProject>() // projectKey → project
  // Per-project resolved bases (+ unresolved-base problems), cached so a base
  // set isn't re-read from the backends on every keystroke. Keyed by storage.
  private readonly baseCache = new Map<IStorage, { bases: TodlDocument[]; problems: string[] }>()
  // Server documents currently open per project (projectKey → set of URIs), so
  // edits/structural changes can didChange/didClose the right ones.
  private readonly openDocs = new Map<string, Set<string>>()
  // Monotonic didChange version per URI.
  private readonly versions = new Map<string, number>()
  // Open editor documents → their current server URI, and → the Content subscription.
  private readonly docUris = new Map<CodeDocument, string>()
  private readonly docListeners = new Map<CodeDocument, Disposable>()
  // Latest diagnostics per project (projectId → relpath → canonical), so a
  // per-URI publish can be flattened into the whole-project slice the store wants.
  private readonly diagsByProject = new Map<string, Map<string, Diagnostic[]>>()

  constructor(provider: IServiceProvider) { super(provider) }

  private get diagnostics(): DiagnosticsService | undefined {
    return this.Provider.get(DiagnosticsService.Key)
  }

  private async notify(method: string, params: unknown): Promise<void> {
    await this.connection?.sendNotification(method, params)
  }

  // Issue an LSP request to the server. Used by the Monaco provider adapters.
  public sendRequest<R>(method: string, params: unknown): Promise<R> {
    if (this.connection === undefined) return Promise.reject(new Error('TODL language client not initialized'))
    return this.connection.sendRequest(method, params) as Promise<R>
  }

  // How to find an open editor's Monaco model by URI (production wires
  // monaco.editor.getModel; tests pass a fake). Null ⇒ the file is closed.
  private findModel: ((uri: string) => EditableModel | null) | undefined
  public setModelFinder(fn: (uri: string) => EditableModel | null): void { this.findModel = fn }

  // Apply a WorkspaceEdit through one path: open buffers via their Monaco model
  // (preserving dirty tracking + undo), closed files via storage. Rename and
  // quick-fixes delegate here rather than letting Monaco apply (which would drop
  // closed-file edits).
  public async applyWorkspaceEdit(edit: WorkspaceEditLike): Promise<void> {
    for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
      const model = this.findModel?.(uri) ?? null
      if (model !== null) {
        model.applyEdits(edits.map((e) => ({ range: lspToMonacoRange(e.range), text: e.newText })))
        continue
      }
      const resolved = this.resolveUri(uri)
      if (resolved === null) continue
      const text = await resolved.storage.ReadText(resolved.relpath)
      await resolved.storage.WriteText(resolved.relpath, applyTextEdits(text, edits))
    }
  }

  private nextVersion(uri: string): number {
    const v = (this.versions.get(uri) ?? 0) + 1
    this.versions.set(uri, v)
    return v
  }

  // Establish the handshake over an already-listening connection. The publish-
  // diagnostics handler is registered in the diagnostics-routing layer.
  public async Initialize(connection: MessageConnection): Promise<void> {
    this.connection = connection
    connection.onNotification('textDocument/publishDiagnostics', (p) =>
      this.onPublishDiagnostics(p as PublishDiagnosticsParams))
    await this.handshake()
  }

  private async handshake(): Promise<void> {
    const res = (await this.connection?.sendRequest('initialize', {
      processId: null, rootUri: null, capabilities: {}, initializationOptions: { mode: 'pushed' },
    })) as { capabilities?: { semanticTokensProvider?: { legend?: SemanticLegend } } } | null
    this.semanticLegend = res?.capabilities?.semanticTokensProvider?.legend
    await this.connection?.sendNotification('initialized', {})
  }

  // Recover after a server restart: re-handshake and re-push every project's
  // bases + open documents to the fresh child.
  public async Reinitialize(): Promise<void> {
    await this.handshake()
    await this.ResyncAll()
    this.fireSemanticStale()
  }

  // Re-push bases + all sources for every registered project (server restart).
  public async ResyncAll(): Promise<void> {
    for (const project of [...this.projects.values()]) {
      const { bases } = await this.basesFor(project.storage)
      await this.notify('todl/setBases', { rootUri: this.uriFor(project.projectId, ''), bases })
      const opened = new Set<string>()
      for (const s of await collectTodlSources(project.storage)) {
        const uri = this.uriFor(project.projectId, s.uri)
        opened.add(uri)
        await this.notify('textDocument/didOpen', {
          textDocument: { uri, languageId: 'todl', version: this.nextVersion(uri), text: s.text },
        })
      }
      this.openDocs.set(this.projectKeyFor(project.projectId), opened)
    }
  }

  // The semantic-tokens legend advertised to the Monaco provider. The server's
  // concept-bearing types (`type`/`class`) are renamed to TODL-only scopes so a
  // blue theme rule targets .todl without colliding with the mural grammar.
  public SemanticLegend(): SemanticLegend {
    return editorSemanticLegend(this.semanticLegend ?? { tokenTypes: [], tokenModifiers: [] })
  }

  // Subscribe to semantic-token staleness. The Monaco semantic-tokens provider
  // forwards this to its onDidChange so open documents re-fetch — this is how a
  // newly added meta-model concept recolors live, without a document edit.
  public onSemanticTokensStale(cb: () => void): () => void {
    this.semanticStaleSubs.add(cb)
    return () => { this.semanticStaleSubs.delete(cb) }
  }

  private fireSemanticStale(): void {
    for (const cb of [...this.semanticStaleSubs]) cb()
  }

  // The opaque authority segment for a project's URIs. MUST be lowercase-hex
  // (no chars Monaco's Uri would decode/lowercase): Monaco normalizes a URI's
  // authority (lowercases it, decodes %XX), so `model.uri.toString()` sent on
  // requests must equal the string we didOpen. encodeURIComponent(RootPath)
  // fails this (its `%3A`/`:` get mangled) — hex round-trips identically. The
  // registry maps the key back to the project, so it needn't be human-readable.
  public projectKeyFor(projectId: string): string {
    let hex = ''
    for (let i = 0; i < projectId.length; i++) hex += projectId.charCodeAt(i).toString(16).padStart(2, '0')
    return hex
  }

  // A document URI: todl://<projectKey>/<relpath>. An empty relpath yields the
  // project rootUri (the server partitions projects by this prefix).
  public uriFor(projectId: string, relpath: string): string {
    return `todl://${this.projectKeyFor(projectId)}/${relpath}`
  }

  // Record a project so its URIs resolve back to (project, storage, relpath).
  public registerProject(projectId: string, projectName: string, storage: IStorage): void {
    this.projects.set(this.projectKeyFor(projectId), { projectId, projectName, storage })
  }

  // Reverse a todl:// URI to its project + storage + project-relative path, or
  // null when the project is unknown (e.g. after close).
  public resolveUri(uri: string): { projectId: string; storage: IStorage; relpath: string } | null {
    const rest = uri.startsWith('todl://') ? uri.slice('todl://'.length) : ''
    const slash = rest.indexOf('/')
    if (slash < 0) return null
    const key = rest.slice(0, slash)
    const relpath = rest.slice(slash + 1)
    const entry = this.projects.get(key)
    if (entry === undefined) return null
    return { projectId: entry.projectId, storage: entry.storage, relpath }
  }

  // Resolve (and cache) a project's declared bases, preferring an open sibling
  // producer's live source over the published artifact (WorkspaceBaseResolver).
  // Cache is per-storage; RefreshBases drops it to pick up producer edits.
  private async basesFor(storage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[] }> {
    const cached = this.baseCache.get(storage)
    if (cached !== undefined) return cached
    const resolved = await this.Provider.getRequired(WorkspaceBaseResolver.Key).ResolveForStorage(storage)
    this.baseCache.set(storage, resolved)
    return resolved
  }

  private projectByStorage(storage: IStorage): { key: string; project: RegisteredProject } | null {
    for (const [key, project] of this.projects) if (project.storage === storage) return { key, project }
    return null
  }

  // Register a project, push its resolved bases, and didOpen every project .todl
  // (the whole set — not just the visible tab — so the server can analyze the
  // project as a whole).
  public async AttachProject(projectId: string, projectName: string, storage: IStorage): Promise<void> {
    this.registerProject(projectId, projectName, storage)
    const { bases } = await this.basesFor(storage)
    await this.notify('todl/setBases', { rootUri: this.uriFor(projectId, ''), bases })
    const opened = new Set<string>()
    for (const s of await collectTodlSources(storage)) {
      const uri = this.uriFor(projectId, s.uri)
      opened.add(uri)
      await this.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'todl', version: this.nextVersion(uri), text: s.text },
      })
    }
    this.openDocs.set(this.projectKeyFor(projectId), opened)
  }

  // Unregister a project on close: didClose its docs, drop registry + caches.
  // (Diagnostics clearing is added in the diagnostics-routing layer.)
  public DetachProject(storage: IStorage): void {
    const found = this.projectByStorage(storage)
    if (found === null) return
    const opened = this.openDocs.get(found.key) ?? new Set<string>()
    for (const uri of opened) void this.notify('textDocument/didClose', { textDocument: { uri } })
    this.openDocs.delete(found.key)
    this.projects.delete(found.key)
    this.baseCache.delete(storage)
    this.diagsByProject.delete(found.project.projectId)
    this.diagnostics?.ClearProject(found.project.projectId)
  }

  // Re-resolve a project's bases after a (re)publish and push them to the server,
  // which drops the old set and re-analyzes.
  public async RefreshBases(storage: IStorage): Promise<void> {
    const found = this.projectByStorage(storage)
    if (found === null) return
    this.baseCache.delete(storage)
    const { bases } = await this.basesFor(storage)
    await this.notify('todl/refreshBases', { rootUri: this.uriFor(found.project.projectId, ''), bases })
    this.fireSemanticStale()
  }

  // Record a document's URI and publish it on the document so the editor keys its
  // Monaco model on it.
  private assignUri(doc: CodeDocument, uri: string): void {
    this.docUris.set(doc, uri)
    doc.Uri = uri
  }

  private sendDidChange(uri: string, text: string): void {
    void this.notify('textDocument/didChange', {
      textDocument: { uri, version: this.nextVersion(uri) },
      contentChanges: [{ text }],
    })
  }

  // Wire an open editor document to the server: assign its URI, ensure the server
  // has it open, and forward every Content edit as a full-text didChange (the
  // server's incremental sync accepts a range-less full replace). Idempotent.
  public AttachDocument(doc: CodeDocument, storage: IStorage): void {
    if (this.docListeners.has(doc)) return
    const found = this.projectByStorage(storage)
    if (found === null) return
    const uri = this.uriFor(found.project.projectId, doc.Id)
    this.assignUri(doc, uri)
    const opened = this.openDocs.get(found.key)
    if (opened !== undefined && !opened.has(uri)) {
      opened.add(uri)
      void this.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'todl', version: this.nextVersion(uri), text: doc.Content },
      })
    }
    const sub = doc.PropertyChanged(CodeDocument.ContentKey).subscribe((): void => {
      const current = this.docUris.get(doc)
      if (current !== undefined) this.sendDidChange(current, doc.Content)
    })
    this.docListeners.set(doc, sub)
  }

  // Move a document to (storage, relpath): close the old server doc, open the new
  // one. The Content listener reads the live URI, so it follows automatically.
  private moveDoc(doc: CodeDocument, storage: IStorage, relpath: string): void {
    const old = this.docUris.get(doc)
    if (old !== undefined) {
      void this.notify('textDocument/didClose', { textDocument: { uri: old } })
      for (const set of this.openDocs.values()) set.delete(old)
    }
    const found = this.projectByStorage(storage)
    if (found === null) return
    const uri = this.uriFor(found.project.projectId, relpath)
    this.assignUri(doc, uri)
    this.openDocs.get(found.key)?.add(uri)
    void this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'todl', version: this.nextVersion(uri), text: doc.Content },
    })
  }

  // In-place rename within the same project; the storage is derived from the
  // document's current URI.
  public RelocateDocument(doc: CodeDocument, newPath: string): void {
    const old = this.docUris.get(doc)
    const resolved = old !== undefined ? this.resolveUri(old) : null
    if (resolved === null) return
    this.moveDoc(doc, resolved.storage, newPath)
  }

  // Cross-project move (doc.Id already points at the new path).
  public ReattachDocument(doc: CodeDocument, storage: IStorage): void {
    this.moveDoc(doc, storage, doc.Id)
  }

  // Reconcile the server's open set for a project with what is on disk now —
  // didOpen new files, didChange still-present ones, didClose removed ones.
  // Covers explorer create/delete/rename with no editor open.
  public async ResyncProject(projectId: string, storage: IStorage): Promise<void> {
    const key = this.projectKeyFor(projectId)
    const prev = this.openDocs.get(key) ?? new Set<string>()
    const next = new Set<string>()
    for (const s of await collectTodlSources(storage)) {
      const uri = this.uriFor(projectId, s.uri)
      next.add(uri)
      if (prev.has(uri)) {
        this.sendDidChange(uri, s.text)
      } else {
        void this.notify('textDocument/didOpen', {
          textDocument: { uri, languageId: 'todl', version: this.nextVersion(uri), text: s.text },
        })
      }
    }
    for (const uri of prev) if (!next.has(uri)) void this.notify('textDocument/didClose', { textDocument: { uri } })
    this.openDocs.set(key, next)
  }

  // Route a server publishDiagnostics into the canonical store. The store wants
  // the whole project slice at once, so accumulate per-URI then flatten.
  private onPublishDiagnostics(params: PublishDiagnosticsParams): void {
    const key = params.uri.startsWith('todl://') ? params.uri.slice('todl://'.length).split('/')[0] : undefined
    const entry = key !== undefined ? this.projects.get(key) : undefined
    const resolved = this.resolveUri(params.uri)
    if (entry === undefined || resolved === null) return
    const canon = params.diagnostics.map((d): Diagnostic => ({
      owner: 'todl', projectId: entry.projectId, projectName: entry.projectName, uri: resolved.relpath,
      message: d.message,
      severity: LSP_SEVERITY[d.severity ?? 1] ?? DiagnosticSeverity.Error,
      span: {
        startLine: d.range.start.line + 1, startColumn: d.range.start.character + 1,
        endLine: d.range.end.line + 1, endColumn: d.range.end.character + 1,
      },
    }))
    let byUri = this.diagsByProject.get(entry.projectId)
    if (byUri === undefined) { byUri = new Map(); this.diagsByProject.set(entry.projectId, byUri) }
    byUri.set(resolved.relpath, canon)
    this.publishProject(entry.projectId)
  }

  // Flatten a project's per-URI diagnostics (plus any unresolved-base problems)
  // and replace its slice in the store.
  private publishProject(projectId: string): void {
    const byUri = this.diagsByProject.get(projectId) ?? new Map<string, Diagnostic[]>()
    const flat: Diagnostic[] = []
    for (const list of byUri.values()) flat.push(...list)
    const project = [...this.projects.values()].find((p) => p.projectId === projectId)
    if (project !== undefined) {
      const problems = this.baseCache.get(project.storage)?.problems ?? []
      if (problems.length > 0) {
        flat.push({
          owner: 'todl', projectId, projectName: project.projectName, uri: null,
          message: `Unresolved base: ${problems.join('; ')}.`,
          severity: DiagnosticSeverity.Error, span: null,
        })
      }
    }
    this.diagnostics?.Publish('todl', projectId, flat)
  }
}
