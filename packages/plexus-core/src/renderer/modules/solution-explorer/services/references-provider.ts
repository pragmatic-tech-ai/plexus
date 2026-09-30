import {
    HierarchyItemId, ChildAdded, ChildRemoved, ChildUpdated, NodeSeverity, NodeKey, HierarchyPropertyId,
    type IHierarchyProvider, type HierarchyChange, type HierarchyNode, type DropData,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ProjectType, type SolutionMember } from '@pragmatic-tech-ai/todl'
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime'
import { ReferenceNodeKey } from './reference-node-key.js'
import { ReferenceResolution, type IReferenceView, type MemberReferencesView, type DeclaredReference } from './reference-view.js'

// Owns the References subtree for one member: a References root → a Meta-models group
// (and, for an architecture, a Libraries group) → one leaf per declared reference,
// decorated with its resolution. Async-seeded like ProjectContentProvider — ObserveChildren
// returns its disposer synchronously and pushes ChildAdded after the async view fetch.
// Refreshes on IReferenceView.OnReferencesViewChanged: re-fetches and diffs, so a repin is a
// ChildUpdated (leaf id kept, keyed by kind@id), an add/remove a ChildAdded/ChildRemoved.
export class ReferencesProvider implements IHierarchyProvider
{
    private static readonly Id = 'plexus.references'
    public readonly ProviderId = ReferencesProvider.Id
    private static readonly RootCaption = 'References'
    private static readonly MetaModelsGroupLabel = 'Meta-models'
    private static readonly LibrariesGroupLabel = 'Libraries'
    private static readonly UnresolvedMessage = 'Unresolved: not published and no workspace producer'
    private static readonly RootCanonical = 'references'
    private static readonly MetaModelsSlug = 'meta-models'
    private static readonly LibrariesSlug = 'libraries'
    private static readonly LiveIconSuffix = '-live'
    private static readonly PublishedIconSuffix = '-published'
    private static readonly UnresolvedIconSuffix = '-unresolved'

    private readonly rootId = HierarchyItemId.Mint()
    private readonly rootMarker = Object.freeze({ references: true })
    private readonly ownedIds = new Set<HierarchyItemId>([this.rootId])
    private readonly nodeById = new Map<HierarchyItemId, HierarchyNode>()
    private readonly canonicalById = new Map<HierarchyItemId, string>()
    private readonly canonicalByName = new Map<string, HierarchyItemId>()
    private readonly groupIdByKind = new Map<ProjectType, HierarchyItemId>()
    private readonly groupKind = new Map<HierarchyItemId, ProjectType>()
    private readonly groupSinks = new Map<HierarchyItemId, (c: HierarchyChange) => void>()
    private readonly groupMembers = new Map<HierarchyItemId, Set<string>>()   // groupId -> set of kind@id keys
    private readonly leafIds = new Map<string, HierarchyItemId>()             // kind@id -> leaf id
    private rootSink: ((c: HierarchyChange) => void) | undefined
    private currentView: MemberReferencesView | undefined
    private fetched = false
    private readonly offChanged: Disposable

    constructor(private readonly member: SolutionMember, private readonly view: IReferenceView)
    {
        this.nodeById.set(this.rootId, this.buildRootNode())
        this.canonicalById.set(this.rootId, ReferencesProvider.RootCanonical)
        this.canonicalByName.set(ReferencesProvider.RootCanonical, this.rootId)
        this.offChanged = this.view.OnReferencesViewChanged((affected) =>
        {
            if (affected === undefined || affected === this.member) void this.refresh()
        })
    }

    public ReferencesRootId(): HierarchyItemId { return this.rootId }
    public ReferencesRootNode(): HierarchyNode { return this.nodeById.get(this.rootId)! }
    public Owns(id: HierarchyItemId): boolean { return this.ownedIds.has(id) }

    public ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        if (node === this.rootId)
        {
            this.rootSink = sink
            void this.realizeRoot()
            return () => { this.rootSink = undefined }
        }
        const kind = this.groupKind.get(node)
        if (kind !== undefined)
        {
            this.groupSinks.set(node, sink)
            void this.realizeGroup(node, kind, sink)
            return () => { this.groupSinks.delete(node) }
        }
        return () => {}
    }

    public GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown
    {
        const node = this.nodeById.get(id)
        if (node === undefined) return undefined
        switch (prop)
        {
            case HierarchyPropertyId.Caption:       return node.Caption
            case HierarchyPropertyId.IconKey:       return node.IconKey
            case HierarchyPropertyId.ExtObject:     return node.ExtObject
            case HierarchyPropertyId.Severity:      return node.Severity
            case HierarchyPropertyId.CanonicalName: return this.canonicalById.get(id) ?? node.Key
            case HierarchyPropertyId.IsExpandable:  return node.IsExpandable === true
            default:                                return undefined
        }
    }

    public GetCanonicalName(id: HierarchyItemId): string { return this.canonicalById.get(id) ?? '' }
    public ParseCanonicalName(name: string): HierarchyItemId { return this.canonicalByName.get(name) ?? HierarchyItemId.Nil }
    public CanAccept(_target: HierarchyItemId, _drop: DropData): boolean { return false }

    public dispose(): void { this.offChanged.dispose() }

    private async ensureView(): Promise<void>
    {
        if (this.fetched) return
        this.currentView = await this.view.ReferencesViewFor(this.member)
        this.fetched = true
    }

    private async realizeRoot(): Promise<void>
    {
        await this.ensureView()
        const sink = this.rootSink
        if (sink === undefined || this.currentView === undefined) return
        sink(new ChildAdded(this.ensureGroupId(ProjectType.MetaModel), this.nodeById.get(this.groupIdByKind.get(ProjectType.MetaModel)!)!))
        if (this.currentView.OffersLibraries)
        {
            const libId = this.ensureGroupId(ProjectType.Library)
            sink(new ChildAdded(libId, this.nodeById.get(libId)!))
        }
    }

    private async realizeGroup(groupId: HierarchyItemId, kind: ProjectType, sink: (c: HierarchyChange) => void): Promise<void>
    {
        await this.ensureView()
        const members = new Set<string>()
        for (const dref of this.listFor(kind))
        {
            const key = ReferencesProvider.leafKey(kind, dref)
            const id = this.ensureLeafId(key, groupId, kind, dref)
            members.add(key)
            sink(new ChildAdded(id, this.nodeById.get(id)!))
        }
        this.groupMembers.set(groupId, members)
    }

    private async refresh(): Promise<void>
    {
        this.currentView = await this.view.ReferencesViewFor(this.member)
        this.fetched = true
        for (const [groupId, kind] of this.groupKind)
        {
            const sink = this.groupSinks.get(groupId)
            if (sink === undefined) continue   // collapsed — rebuilds fresh on next expand
            this.diffGroup(groupId, kind, sink)
        }
    }

    private diffGroup(groupId: HierarchyItemId, kind: ProjectType, sink: (c: HierarchyChange) => void): void
    {
        const old = this.groupMembers.get(groupId) ?? new Set<string>()
        const next = new Set<string>()
        for (const dref of this.listFor(kind))
        {
            const key = ReferencesProvider.leafKey(kind, dref)
            next.add(key)
            const node = this.buildLeaf(kind, dref)
            if (old.has(key))
            {
                const id = this.leafIds.get(key)!
                if (ReferencesProvider.displayDiffers(this.nodeById.get(id), node))
                {
                    this.nodeById.set(id, node)
                    sink(new ChildUpdated(id, node))
                }
            }
            else
            {
                const id = this.ensureLeafId(key, groupId, kind, dref)
                sink(new ChildAdded(id, node))
            }
        }
        for (const key of old)
        {
            if (next.has(key)) continue
            const id = this.leafIds.get(key)
            if (id === undefined) continue
            sink(new ChildRemoved(id))
            this.nodeById.delete(id)
            this.ownedIds.delete(id)
            const canon = this.canonicalById.get(id)
            if (canon !== undefined) { this.canonicalByName.delete(canon); this.canonicalById.delete(id) }
            this.leafIds.delete(key)
        }
        this.groupMembers.set(groupId, next)
    }

    private ensureGroupId(kind: ProjectType): HierarchyItemId
    {
        let id = this.groupIdByKind.get(kind)
        if (id !== undefined) return id
        id = HierarchyItemId.Mint()
        this.groupIdByKind.set(kind, id)
        this.groupKind.set(id, kind)
        this.ownedIds.add(id)
        this.nodeById.set(id, this.buildGroup(kind))
        const canon = `${ReferencesProvider.RootCanonical}/${ReferencesProvider.slugFor(kind)}`
        this.canonicalById.set(id, canon)
        this.canonicalByName.set(canon, id)
        return id
    }

    private ensureLeafId(key: string, groupId: HierarchyItemId, kind: ProjectType, dref: DeclaredReference): HierarchyItemId
    {
        let id = this.leafIds.get(key)
        if (id === undefined)
        {
            id = HierarchyItemId.Mint()
            this.leafIds.set(key, id)
        }
        this.ownedIds.add(id)
        this.nodeById.set(id, this.buildLeaf(kind, dref))
        const groupCanon = this.canonicalById.get(groupId) ?? ReferencesProvider.RootCanonical
        const canon = `${groupCanon}/${dref.Ref.id}@${dref.Ref.version}`
        this.canonicalById.set(id, canon)
        this.canonicalByName.set(canon, id)
        return id
    }

    private listFor(kind: ProjectType): readonly DeclaredReference[]
    {
        if (this.currentView === undefined) return []
        return kind === ProjectType.Library ? this.currentView.Libraries : this.currentView.MetaModels
    }

    private buildRootNode(): HierarchyNode
    {
        return { Key: NodeKey.References, Caption: ReferencesProvider.RootCaption, IconKey: NodeKey.References, ExtObject: this.rootMarker, Severity: NodeSeverity.Ok, IsExpandable: true }
    }

    private buildGroup(kind: ProjectType): HierarchyNode
    {
        const label = kind === ProjectType.Library ? ReferencesProvider.LibrariesGroupLabel : ReferencesProvider.MetaModelsGroupLabel
        return { Key: ReferenceNodeKey.Group, Caption: label, IconKey: ReferenceNodeKey.Group, ExtObject: { group: kind }, Severity: NodeSeverity.Ok, IsExpandable: true }
    }

    private buildLeaf(kind: ProjectType, dref: DeclaredReference): HierarchyNode
    {
        const unresolved = dref.Resolution === ReferenceResolution.Unresolved
        return {
            Key: ReferenceNodeKey.Leaf,
            Caption: `${dref.Ref.id}@${dref.Ref.version}`,
            IconKey: ReferenceNodeKey.Leaf + ReferencesProvider.iconSuffix(dref.Resolution),
            ExtObject: { kind, ref: dref.Ref },
            Severity: unresolved ? NodeSeverity.Warning : NodeSeverity.Ok,
            Error: unresolved ? ReferencesProvider.UnresolvedMessage : undefined,
            IsExpandable: false,
        }
    }

    private static iconSuffix(resolution: ReferenceResolution): string
    {
        if (resolution === ReferenceResolution.LiveWorkspace) return ReferencesProvider.LiveIconSuffix
        if (resolution === ReferenceResolution.Published) return ReferencesProvider.PublishedIconSuffix
        return ReferencesProvider.UnresolvedIconSuffix
    }

    private static slugFor(kind: ProjectType): string
    {
        return kind === ProjectType.Library ? ReferencesProvider.LibrariesSlug : ReferencesProvider.MetaModelsSlug
    }

    private static leafKey(kind: ProjectType, dref: DeclaredReference): string { return `${kind}@${dref.Ref.id}` }

    private static displayDiffers(a: HierarchyNode | undefined, b: HierarchyNode): boolean
    {
        if (a === undefined) return true
        return a.Caption !== b.Caption || a.IconKey !== b.IconKey || a.Severity !== b.Severity || a.Error !== b.Error
    }
}
