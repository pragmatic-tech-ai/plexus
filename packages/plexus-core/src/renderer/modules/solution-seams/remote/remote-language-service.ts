import { Signal } from '@pragmatic-tech-ai/todl-runtime'
import type { IDisposable, IStorage, PropertyChangedEventArgs } from '@pragmatic-tech-ai/todl-runtime'
import { EdgeKind, Graph, GraphBuildState, Repository, Tier } from '@pragmatic-tech-ai/todl'
import type { Edge, IBaseResolver, ILanguageService, MetaKind, Node, WikiOrigin } from '@pragmatic-tech-ai/todl'
import type { ModelMemberDto, PublishDiagnosticsParams } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { Diagnostic } from 'vscode-languageserver-types'
import type { DevSessionRequests, IDevSessionPushes } from '../../dev-session/dev-session-surface.js'
import type { IDevStorageSession } from '../../storage/remote-file-storage.js'
import { RemoteFileStorage } from '../../storage/remote-file-storage.js'

// The held develop session as the remote language service uses it: the language/model requests, the
// graph/build/diagnostics pushes, and the storage verbs (a resource's storage is a RemoteFileStorage).
export type IRemoteLanguageSession = IDevStorageSession & DevSessionRequests & IDevSessionPushes

type GraphChange = Parameters<Parameters<ILanguageService['GraphChanged']['subscribe']>[0]>[0]

// The LOCAL half (Ruling R-BASE): base resolution and stale-member tracking run over the opened
// solution's members on this machine and never cross the wire.
export interface ILocalBaseResolution extends IBaseResolver
{
    readonly StaleMembers: ReadonlySet<string>
    PropertyChanged(name: string): Signal<PropertyChangedEventArgs>
}

// Maps a member's storage (what ILanguageService.ModelView is keyed by) to the wire member id the
// environment's model/view endpoint is keyed by.
export interface IRemoteMemberIds
{
    MemberIdOf(storage: IStorage): string | undefined
}

// The trace seam for conditions the service must not swallow silently (a dropped edge, a failed
// sync). Optional: absent, nothing is logged (failures still surface via the signals).
export interface IRemoteLanguageLog
{
    Debug(message: string): void
    Warn(message: string): void
}

// A DidChange send the session rejected: the edit did not reach the environment.
export interface DidChangeFailure
{
    readonly Uri: string
    readonly Error: unknown
}

// A renderer-side ILanguageService driving a dev environment's shared language service over the held
// develop session. LSP features, DidChange, ModelView and Resources go over the wire; the pushes
// re-surface as engine signals; the IBaseResolver face and StaleMembers are local.
export class RemoteLanguageService implements ILanguageService, IDisposable
{
    private static readonly UnknownTier = 'unknown model tier: '
    private static readonly DroppedEdgeKind = 'model view: dropped edge with unknown kind '
    private static readonly DroppedEdgeTarget = 'model view: dropped edge to absent target '
    private static readonly EdgeFrom = ' from '
    private static readonly BuildSyncFailed = 'build-state sync failed: '
    private static readonly DidChangeFailedMessage = 'didChange not delivered for '
    private static readonly ErrorSeparator = ': '

    public readonly GraphChanged: Signal<GraphChange> = new Signal<GraphChange>()
    public readonly BuildStateChanged = new Signal<GraphBuildState>()
    // Raised for every diagnostics push, after the per-uri cache is updated.
    public readonly DiagnosticsPublished = new Signal<PublishDiagnosticsParams>()
    // Raised when a DidChange send is rejected, so the editor can observe that an edit was lost.
    public readonly DidChangeFailed: Signal<DidChangeFailure> = new Signal<DidChangeFailure>()

    // Seeded by SyncBuildState (the session's ActiveSolution summary) right after subscribing, because a
    // push that predates the subscription is never replayed; Building until that answers. A push that
    // arrives first wins (pushSeen), so a slower sync never overwrites a newer state.
    private buildState = GraphBuildState.Building
    private pushSeen = false
    private graphRevision = 0
    private readonly diagnostics = new Map<string, Diagnostic[]>()
    private readonly pending = new Set<Promise<void>>()
    private readonly subscriptions: (() => void)[] = []

    public constructor(
        private readonly session: IRemoteLanguageSession,
        private readonly local: ILocalBaseResolution,
        private readonly members: IRemoteMemberIds,
        private readonly log?: IRemoteLanguageLog,
    )
    {
        this.subscriptions.push(
            session.OnGraphChanged(change =>
            {
                this.graphRevision++
                this.GraphChanged.emit({ memberIds: change.memberIds, fileIds: change.fileIds })
            }),
            session.OnBuildStateChanged(payload =>
            {
                const pushed = RemoteLanguageService.BuildStateOf(payload.buildState)
                if (pushed === undefined) return
                this.pushSeen = true
                this.Apply(pushed)
            }),
            session.OnDiagnostics(params =>
            {
                // Ordering note: a pull (DiagnosticsFor) landing after a newer push overwrites the cache; benign,
                // the pull is authoritative.
                this.diagnostics.set(params.uri, params.diagnostics as unknown as Diagnostic[])
                this.DiagnosticsPublished.emit(params)
            }),
        )
        void this.SyncBuildState()
    }

    // Reads the session's current build state (ActiveSolution) and adopts it unless a push already
    // did. Seeds the initial state at construction; once any recognized push has been observed it is a
    // no-op (a push always wins).
    public async SyncBuildState(): Promise<void>
    {
        try
        {
            const active = await this.session.ActiveSolution()
            if (active !== null && !this.pushSeen) this.Apply(RemoteLanguageService.BuildStateOf(active.buildState))
        }
        catch (error)
        {
            this.log?.Warn(RemoteLanguageService.BuildSyncFailed + String(error))
        }
    }

    private Apply(next: GraphBuildState | undefined): void
    {
        if (next === undefined || next === this.buildState) return
        this.buildState = next
        this.BuildStateChanged.emit(next)
    }

    // The wire build-state string is the engine enum's value; anything else is ignored. Resolved
    // lazily (not in a static initializer) so module load order never matters.
    private static BuildStateOf(wire: string): GraphBuildState | undefined
    {
        return Object.values(GraphBuildState).find(state => state === wire)
    }

    public get BuildState(): GraphBuildState
    {
        return this.buildState
    }

    public get GraphRevision(): number
    {
        return this.graphRevision
    }

    public get StaleMembers(): ReadonlySet<string>
    {
        return this.local.StaleMembers
    }

    // The last diagnostics the environment pushed for a uri (undefined when none arrived yet).
    public CachedDiagnostics(uri: string): readonly Diagnostic[] | undefined
    {
        return this.diagnostics.get(uri)
    }

    // ---- remote: LSP features ------------------------------------------------------------------

    // The session's language requests carry the same shapes as ILanguageService; the cast bridges
    // separately installed copies of the LSP type package (protocol vs engine).
    private get Lsp(): ILanguageService
    {
        return this.session as unknown as ILanguageService
    }

    public CompletionsAt(...args: Parameters<ILanguageService['CompletionsAt']>): ReturnType<ILanguageService['CompletionsAt']>
    {
        return this.Lsp.CompletionsAt(...args)
    }

    public HoverAt(...args: Parameters<ILanguageService['HoverAt']>): ReturnType<ILanguageService['HoverAt']>
    {
        return this.Lsp.HoverAt(...args)
    }

    public DefinitionAt(...args: Parameters<ILanguageService['DefinitionAt']>): ReturnType<ILanguageService['DefinitionAt']>
    {
        return this.Lsp.DefinitionAt(...args)
    }

    public ReferencesAt(...args: Parameters<ILanguageService['ReferencesAt']>): ReturnType<ILanguageService['ReferencesAt']>
    {
        return this.Lsp.ReferencesAt(...args)
    }

    public PrepareRename(...args: Parameters<ILanguageService['PrepareRename']>): ReturnType<ILanguageService['PrepareRename']>
    {
        return this.Lsp.PrepareRename(...args)
    }

    public RenameEdits(...args: Parameters<ILanguageService['RenameEdits']>): ReturnType<ILanguageService['RenameEdits']>
    {
        return this.Lsp.RenameEdits(...args)
    }

    public DocumentSymbols(...args: Parameters<ILanguageService['DocumentSymbols']>): ReturnType<ILanguageService['DocumentSymbols']>
    {
        return this.Lsp.DocumentSymbols(...args)
    }

    public FoldingRanges(...args: Parameters<ILanguageService['FoldingRanges']>): ReturnType<ILanguageService['FoldingRanges']>
    {
        return this.Lsp.FoldingRanges(...args)
    }

    public WorkspaceSymbols(...args: Parameters<ILanguageService['WorkspaceSymbols']>): ReturnType<ILanguageService['WorkspaceSymbols']>
    {
        return this.Lsp.WorkspaceSymbols(...args)
    }

    public SemanticTokens(...args: Parameters<ILanguageService['SemanticTokens']>): ReturnType<ILanguageService['SemanticTokens']>
    {
        return this.Lsp.SemanticTokens(...args)
    }

    public SignatureHelpAt(...args: Parameters<ILanguageService['SignatureHelpAt']>): ReturnType<ILanguageService['SignatureHelpAt']>
    {
        return this.Lsp.SignatureHelpAt(...args)
    }

    public CodeActions(uri: string, range: Parameters<ILanguageService['CodeActions']>[1], diagnostics: readonly Diagnostic[]): ReturnType<ILanguageService['CodeActions']>
    {
        return this.Lsp.CodeActions(uri, range, diagnostics)
    }

    public FormatDocument(...args: Parameters<ILanguageService['FormatDocument']>): ReturnType<ILanguageService['FormatDocument']>
    {
        return this.Lsp.FormatDocument(...args)
    }

    // Pull-model: the environment is authoritative; the answer also refreshes the push cache.
    public async DiagnosticsFor(uri: string): Promise<Diagnostic[]>
    {
        const result = await this.Lsp.DiagnosticsFor(uri)
        // Ordering: this pull may overwrite a newer push that landed meanwhile; benign, the pull is authoritative.
        this.diagnostics.set(uri, result)
        return result
    }

    // The live buffer goes to the environment; the notification is fire-and-forget, tracked so
    // WhenIdle can settle it.
    public DidChange(uri: string, text: string): void
    {
        const send: Promise<void> = this.session.DidChange(uri, text).then(() => undefined, (error: unknown) =>
        {
            this.log?.Warn(RemoteLanguageService.DidChangeFailedMessage + uri + RemoteLanguageService.ErrorSeparator + String(error))
            this.DidChangeFailed.emit({ Uri: uri, Error: error })
        })
        this.pending.add(send)
        void send.then(() => this.pending.delete(send))
    }

    public async WhenIdle(): Promise<void>
    {
        while (this.pending.size > 0) await Promise.all([...this.pending])
    }

    // ---- remote: model view + resources ---------------------------------------------------------

    // Pages the member's model view off the wire and materializes it into an engine Repository.
    // originOf is empty: the wire carries provenance (provenanceOf) but no storage-backed origins.
    public async ModelView(consumerStorage: IStorage): Promise<{ model: Repository; originOf: ReadonlyMap<string, WikiOrigin>; provenanceOf: ReadonlyMap<string, string> } | undefined>
    {
        const memberId = this.members.MemberIdOf(consumerStorage)
        if (memberId === undefined) return undefined
        const items: ModelMemberDto[] = []
        const provenanceOf = new Map<string, string>()
        let cursor: string | undefined
        do
        {
            const page = await this.session.ModelView(memberId, cursor === undefined ? undefined : { cursor })
            items.push(...page.items)
            for (const [id, source] of Object.entries(page.provenanceOf)) provenanceOf.set(id, source)
            cursor = page.nextCursor
        }
        while (cursor !== undefined)
        return { model: this.Materialize(items), originOf: new Map(), provenanceOf }
    }

    public async Resources(nodeId: string): ReturnType<ILanguageService['Resources']>
    {
        const dtos = await this.session.Resources(nodeId)
        return dtos.map(dto => ({ annotation: dto.annotation, path: dto.path, storage: new RemoteFileStorage(this.session, dto.storageRoot) }))
    }

    // DTO -> engine. The wire member is a projection (kind folds metaKind/type; fields, class and
    // canonicalId are not carried), so: an Instance-tier kind is the node's type, any other tier's
    // kind is its metaKind. Edges to nodes absent from the view are dropped.
    private Materialize(items: readonly ModelMemberDto[]): Repository
    {
        const graph = new Graph()
        for (const dto of items) graph.addNode(RemoteLanguageService.NodeOf(dto))
        for (const dto of items)
        {
            for (const edge of dto.edges)
            {
                const kind = EdgeKind[edge.kind as keyof typeof EdgeKind]
                if (kind === undefined)
                {
                    this.log?.Debug(RemoteLanguageService.DroppedEdgeKind + edge.kind + RemoteLanguageService.EdgeFrom + dto.id)
                    continue
                }
                if (!graph.hasNode(edge.to))
                {
                    this.log?.Debug(RemoteLanguageService.DroppedEdgeTarget + edge.to + RemoteLanguageService.EdgeFrom + dto.id)
                    continue
                }
                const materialized: Edge = { kind, via: edge.via, from: dto.id, to: edge.to }
                graph.addEdge(materialized)
            }
        }
        return new Repository(graph)
    }

    private static NodeOf(dto: ModelMemberDto): Node
    {
        const tier = Tier[dto.tier as keyof typeof Tier]
        if (tier === undefined) throw new Error(RemoteLanguageService.UnknownTier + dto.tier)
        const attrs = new Map<string, string | number | boolean>()
        for (const [name, value] of Object.entries(dto.attrs))
        {
            if (value !== null) attrs.set(name, value)
        }
        const instance = tier === Tier.Instance
        return {
            id: dto.id,
            tier,
            type: instance ? dto.kind : null,
            metaKind: instance || dto.kind === null ? null : dto.kind as MetaKind,
            namespace: dto.namespace === '' ? null : dto.namespace,
            localId: dto.localId === '' ? null : dto.localId,
            isClass: dto.isClass,
            class: null,
            storageId: null,
            canonicalId: null,
            fields: [],
            attrs,
        }
    }

    // ---- local: base resolution (Ruling R-BASE) --------------------------------------------------

    public ResolveBasesFor(consumerStorage: IStorage): ReturnType<ILanguageService['ResolveBasesFor']>
    {
        return this.local.ResolveBasesFor(consumerStorage)
    }

    public ReferencedPublishedRefs(consumerStorage: IStorage): ReturnType<ILanguageService['ReferencedPublishedRefs']>
    {
        return this.local.ReferencedPublishedRefs(consumerStorage)
    }

    public WorkspaceProducers(...args: Parameters<ILanguageService['WorkspaceProducers']>): ReturnType<ILanguageService['WorkspaceProducers']>
    {
        return this.local.WorkspaceProducers(...args)
    }

    public ProducedIdOf(consumerStorage: IStorage): ReturnType<ILanguageService['ProducedIdOf']>
    {
        return this.local.ProducedIdOf(consumerStorage)
    }

    public ConsumerIdOf(consumerStorage: IStorage): Promise<string | undefined>
    {
        return this.local.ConsumerIdOf(consumerStorage)
    }

    public Invalidate(memberId: string): void
    {
        this.local.Invalidate(memberId)
    }

    // Local resolver channels only (StaleMembers). BuildState and GraphRevision are announced through
    // BuildStateChanged / GraphChanged, not here; no consumer observes them via PropertyChanged.
    public PropertyChanged(name: string): Signal<PropertyChangedEventArgs>
    {
        return this.local.PropertyChanged(name)
    }

    public dispose(): void
    {
        for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe()
    }
}
