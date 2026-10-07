import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { Observable, Signal, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionLanguageService, SolutionManagerService, type RenameError, type Repository, type TodlDocument, type WikiOrigin } from '@pragmatic-tech-ai/todl'
import { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import type {
  CodeAction, CompletionItem, Diagnostic, DocumentSymbol, FoldingRange, Hover,
  Location, Position, Range, SemanticTokens, SignatureHelp, TextEdit, WorkspaceEdit,
} from 'vscode-languageserver-types'

// An in-memory stand-in for the registered SolutionLanguageService that the
// TodlLanguageClient drives. It records the buffers pushed via DidChange, serves
// per-URI diagnostics + configurable feature results, resolves (empty) bases, and
// re-raises the StaleMembers PropertyChanged signal on demand. Extends Observable
// so PropertyChanged / RaisePropertyChanged work exactly as on the real service.
export class FakeLanguageService extends Observable
{
  private static readonly StaleMembersPropertyName = 'StaleMembers'

  // service URI → live text pushed via DidChange.
  public readonly Buffers = new Map<string, string>()
  // service URI → DidChange call count (so a test can assert a push happened).
  public readonly DidChangeCalls: Array<{ uri: string; text: string }> = []
  // Configurable feature results — a test sets the one it exercises.
  public HoverResult: Hover | null = null
  public DefinitionResult: Location | null = null
  public ReferenceResults: Location[] = []
  public RenameResult: WorkspaceEdit | RenameError = { changes: {} }
  public CodeActionResults: CodeAction[] = []
  // service URI → diagnostics this service reports for that file.
  private readonly diagnostics = new Map<string, Diagnostic[]>()
  // Per-storage unresolved-base problems ResolveBasesFor returns.
  public readonly BaseProblems = new Map<IStorage, string[]>()
  // Per-storage resolved base documents ResolveBasesFor returns (empty when unset).
  public readonly BasesByStorage = new Map<IStorage, TodlDocument[]>()
  // Per-storage member id ConsumerIdOf returns (the id GraphChanged names a member by).
  public readonly ConsumerIds = new Map<IStorage, string>()
  // The shared solution graph ModelView serves, and the per-node origin map that says
  // which member storage each node was authored in. Undefined → no active solution.
  public ModelViewResult: { model: Repository; originOf: ReadonlyMap<string, WikiOrigin>; provenanceOf: ReadonlyMap<string, string> } | undefined = undefined
  // The shared-graph change signal source members subscribe to; a test fires it to drive
  // cache invalidation.
  public readonly GraphChanged = new Signal<{ memberIds: readonly string[]; fileIds: readonly string[] }>()
  private staleMembers: ReadonlySet<string> = new Set()

  public SetDiagnostics(uri: string, diags: Diagnostic[]): void
  {
    this.diagnostics.set(uri, diags)
  }

  // An LSP diagnostic (0-based, severity Error) for test fixtures to report.
  public static Diag(message: string, line = 0, startChar = 0, endChar = 1): Diagnostic
  {
    return { range: { start: { line, character: startChar }, end: { line, character: endChar } }, message, severity: 1 }
  }

  public get StaleMembers(): ReadonlySet<string> { return this.staleMembers }

  // Drive the same PropertyChanged('StaleMembers') signal the real service raises.
  public RaiseStaleMembers(ids: ReadonlySet<string>): void
  {
    const old = this.staleMembers
    this.staleMembers = ids
    this.RaisePropertyChanged(FakeLanguageService.StaleMembersPropertyName, old, ids)
  }

  public DidChange(uri: string, text: string): void
  {
    this.Buffers.set(uri, text)
    this.DidChangeCalls.push({ uri, text })
  }

  public DiagnosticsFor(uri: string): Promise<Diagnostic[]>
  {
    return Promise.resolve(this.diagnostics.get(uri) ?? [])
  }

  public HoverAt(_uri: string, _pos: Position): Promise<Hover | null>
  {
    return Promise.resolve(this.HoverResult)
  }

  public DefinitionAt(_uri: string, _pos: Position): Promise<Location | null>
  {
    return Promise.resolve(this.DefinitionResult)
  }

  public ReferencesAt(_uri: string, _pos: Position, _includeDecl: boolean): Promise<Location[]>
  {
    return Promise.resolve(this.ReferenceResults)
  }

  public CompletionsAt(_uri: string, _pos: Position): Promise<CompletionItem[]>
  {
    return Promise.resolve([])
  }

  public FoldingRanges(_uri: string): Promise<FoldingRange[]>
  {
    return Promise.resolve([])
  }

  public DocumentSymbols(_uri: string): Promise<DocumentSymbol[]>
  {
    return Promise.resolve([])
  }

  public SemanticTokens(_uri: string): Promise<SemanticTokens>
  {
    return Promise.resolve({ data: [] })
  }

  public SignatureHelpAt(_uri: string, _pos: Position): Promise<SignatureHelp | null>
  {
    return Promise.resolve(null)
  }

  public PrepareRename(_uri: string, _pos: Position): Promise<Range | null>
  {
    return Promise.resolve(null)
  }

  public RenameEdits(_uri: string, _pos: Position, _newName: string): Promise<WorkspaceEdit | RenameError>
  {
    return Promise.resolve(this.RenameResult)
  }

  public CodeActions(_uri: string, _range: Range, _diags: readonly Diagnostic[]): Promise<CodeAction[]>
  {
    return Promise.resolve(this.CodeActionResults)
  }

  public FormatDocument(_uri: string): Promise<TextEdit[]>
  {
    return Promise.resolve([])
  }

  public ResolveBasesFor(storage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[]; originOf: ReadonlyMap<string, WikiOrigin> }>
  {
    return Promise.resolve({ bases: this.BasesByStorage.get(storage) ?? [], problems: this.BaseProblems.get(storage) ?? [], originOf: new Map() })
  }

  public ReferencedPublishedRefs(_storage: IStorage): Promise<Set<string>>
  {
    return Promise.resolve(new Set())
  }

  public ProducedIdOf(storage: IStorage): Promise<string | undefined>
  {
    return Promise.resolve(this.ConsumerIds.get(storage))
  }

  public ConsumerIdOf(storage: IStorage): Promise<string | undefined>
  {
    return Promise.resolve(this.ConsumerIds.get(storage))
  }

  public ModelView(_storage: IStorage): Promise<{ model: Repository; originOf: ReadonlyMap<string, WikiOrigin>; provenanceOf: ReadonlyMap<string, string> } | undefined>
  {
    return Promise.resolve(this.ModelViewResult)
  }

  public Resources(_nodeId: string): Promise<never[]>
  {
    return Promise.resolve([])
  }

  public WhenIdle(): Promise<void>
  {
    return Promise.resolve()
  }
}

// A service provider with the fake language service registered under the key the
// client resolves. Optionally also registers a DiagnosticsService + a fake
// SolutionManagerService (the stale-members path reads ActiveSolution.Members).
export class FakeServiceHarness
{
  public static Provider(service?: FakeLanguageService): { provider: ServiceProvider; service: FakeLanguageService; diagnostics: DiagnosticsService }
  {
    const fake = service ?? new FakeLanguageService()
    const provider = new ServiceProvider()
    provider.registerInstance(SolutionLanguageService.Key, fake as unknown as SolutionLanguageService)
    const diagnostics = new DiagnosticsService(provider)
    provider.registerInstance(DiagnosticsService.Key, diagnostics)
    provider.registerInstance(SolutionManagerService.Key, { ActiveSolution: { Members: [] } } as unknown as SolutionManagerService)
    return { provider, service: fake, diagnostics }
  }
}
