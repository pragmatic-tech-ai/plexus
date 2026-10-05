import {
    NodeSeverity,
    type HierarchyItem, type HierarchyItemInit,
    type IHierarchyProvider, type IRealizeContext, type DropData, type NodeContribution,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Disposable, type IDisposable } from '@pragmatic-tech-ai/mural/runtime'
import { ProjectType, type SolutionMember } from '@pragmatic-tech-ai/todl'
import { ReferenceNodeKey } from './reference-node-key.js'
import { ReferenceResolution, type IReferenceView, type MemberReferencesView, type DeclaredReference } from './reference-view.js'

// Owns the References subtree for one member: a References root → a Meta-models group
// (and, for an architecture, a Libraries group) → one leaf per declared reference,
// decorated with its resolution. Migrated to mural's B+C1 provider contract: Realize
// PUSHES the groups into the References root (and the leaves into each group when it
// expands) via the IRealizeContext, and returns the OnReferencesViewChanged subscription
// as its teardown. A repeated reference keeps its leaf instance (interned by kind@id), so
// a repin mutates the SAME row in place; an add/remove inserts/removes it. The canonical
// scheme is preserved: references / references/<group-slug> / references/<group-slug>/<id>@<ver>.
export class ReferencesProvider implements IHierarchyProvider
{
    private static readonly Id = 'plexus.references'
    public readonly ProviderId = ReferencesProvider.Id
    private static readonly MetaModelsGroupLabel = 'Meta-models'
    private static readonly LibrariesGroupLabel = 'Libraries'
    private static readonly UnresolvedMessage = 'Unresolved: not published and no workspace producer'
    private static readonly RootCanonical = 'references'
    private static readonly MetaModelsSlug = 'meta-models'
    private static readonly LibrariesSlug = 'libraries'
    private static readonly CanonicalSeparator = '/'
    private static readonly LeafVersionSeparator = '@'
    private static readonly LeafKeySeparator = '@'
    private static readonly LiveIconSuffix = '-live'
    private static readonly PublishedIconSuffix = '-published'
    private static readonly UnresolvedIconSuffix = '-unresolved'

    private readonly groupItemByKind = new Map<ProjectType, HierarchyItem>()
    private readonly leafItemByKey = new Map<string, HierarchyItem>()     // kind@id -> leaf
    private readonly groupMembers = new Map<HierarchyItem, Set<string>>() // group -> leaf keys present
    private readonly itemByCanonical = new Map<string, HierarchyItem>()
    private readonly canonicalByItem = new Map<HierarchyItem, string>()
    private rootItem: HierarchyItem | undefined

    constructor(private readonly member: SolutionMember, private readonly view: IReferenceView)
    {
    }

    public Realize(item: HierarchyItem, context: IRealizeContext): IDisposable
    {
        if (item.Key === ReferenceNodeKey.Group)
        {
            return this.realizeGroup(item, item.ExtObject as ProjectType, context)
        }
        // A reference leaf is a leaf — never realize children. Every row is now optimistically
        // expandable, so a leaf can be expanded; without this it would fall into realizeRoot and
        // re-emit the References subtree beneath the leaf.
        if (item.Key === ReferenceNodeKey.Leaf) return Disposable.None
        return this.realizeRoot(item, context)
    }

    // The References subtree mints its own rows; nothing is contributor-injected.
    public Integrate(_item: HierarchyItem, _contributions: readonly NodeContribution[]): void
    {
    }

    public GetCanonicalName(item: HierarchyItem): string
    {
        if (item.Key === ReferenceNodeKey.Group)
        {
            return ReferencesProvider.RootCanonical + ReferencesProvider.CanonicalSeparator + ReferencesProvider.slugFor(item.ExtObject as ProjectType)
        }
        if (item.Key === ReferenceNodeKey.Leaf)
        {
            const leaf = item.ExtObject as { kind: ProjectType; ref: DeclaredReference['Ref'] }
            return ReferencesProvider.leafCanonical(leaf.kind, leaf.ref.id, leaf.ref.version)
        }
        return ReferencesProvider.RootCanonical
    }

    public ParseCanonicalName(name: string): HierarchyItem | undefined
    {
        if (name === ReferencesProvider.RootCanonical) return this.rootItem
        return this.itemByCanonical.get(name)
    }

    public CanAccept(_target: HierarchyItem, _drop: DropData): boolean { return false }

    private realizeRoot(item: HierarchyItem, context: IRealizeContext): IDisposable
    {
        this.rootItem = item
        const watch = { disposed: false }
        const off = this.view.OnReferencesViewChanged((affected) =>
        {
            if (!watch.disposed && (affected === undefined || affected === this.member)) void this.populateRoot(item, context)
        })
        void this.populateRoot(item, context)
        return new Disposable(() =>
        {
            watch.disposed = true
            off.dispose()
        })
    }

    private realizeGroup(group: HierarchyItem, kind: ProjectType, context: IRealizeContext): IDisposable
    {
        const watch = { disposed: false }
        const off = this.view.OnReferencesViewChanged((affected) =>
        {
            if (!watch.disposed && (affected === undefined || affected === this.member)) void this.populateGroup(group, kind, context)
        })
        void this.populateGroup(group, kind, context)
        return new Disposable(() =>
        {
            watch.disposed = true
            off.dispose()
        })
    }

    private async populateRoot(item: HierarchyItem, context: IRealizeContext): Promise<void>
    {
        const view = await this.view.ReferencesViewFor(this.member)
        if (view === undefined) return
        this.ensureGroup(ProjectType.MetaModel, context)
        if (view.OffersLibraries) this.ensureGroup(ProjectType.Library, context)
        else this.removeGroup(ProjectType.Library, context)
        item.Severity = ReferencesProvider.severityFor([...view.MetaModels, ...view.Libraries])
        this.rollUpGroup(ProjectType.MetaModel, view)
        if (view.OffersLibraries) this.rollUpGroup(ProjectType.Library, view)
    }

    private async populateGroup(group: HierarchyItem, kind: ProjectType, context: IRealizeContext): Promise<void>
    {
        const view = await this.view.ReferencesViewFor(this.member)
        if (view === undefined) return
        const next = new Set<string>()
        for (const dref of ReferencesProvider.listFor(view, kind))
        {
            const key = ReferencesProvider.leafKey(kind, dref)
            next.add(key)
            let leaf = this.leafItemByKey.get(key)
            if (leaf === undefined)
            {
                leaf = context.NewItem(ReferenceNodeKey.Leaf, ReferencesProvider.leafInit(kind, dref))
                this.leafItemByKey.set(key, leaf)
            }
            else
            {
                this.applyLeaf(leaf, kind, dref)
            }
            this.setCanonical(leaf, ReferencesProvider.leafCanonical(kind, dref.Ref.id, dref.Ref.version))
            context.InsertChild(leaf)
        }
        const prev = this.groupMembers.get(group) ?? new Set<string>()
        for (const key of prev)
        {
            if (next.has(key)) continue
            const leaf = this.leafItemByKey.get(key)
            if (leaf === undefined) continue
            context.RemoveChild(leaf)
            this.forgetLeaf(key, leaf)
        }
        this.groupMembers.set(group, next)
    }

    private ensureGroup(kind: ProjectType, context: IRealizeContext): void
    {
        let group = this.groupItemByKind.get(kind)
        if (group === undefined)
        {
            group = context.NewItem(ReferenceNodeKey.Group, ReferencesProvider.groupInit(kind))
            this.groupItemByKind.set(kind, group)
            this.setCanonical(group, ReferencesProvider.RootCanonical + ReferencesProvider.CanonicalSeparator + ReferencesProvider.slugFor(kind))
        }
        context.InsertChild(group)
    }

    private removeGroup(kind: ProjectType, context: IRealizeContext): void
    {
        const group = this.groupItemByKind.get(kind)
        if (group === undefined) return
        context.RemoveChild(group)
        this.groupItemByKind.delete(kind)
        this.groupMembers.delete(group)
        this.dropCanonical(group)
    }

    private rollUpGroup(kind: ProjectType, view: MemberReferencesView): void
    {
        const group = this.groupItemByKind.get(kind)
        if (group === undefined) return
        group.Severity = ReferencesProvider.severityFor(ReferencesProvider.listFor(view, kind))
    }

    private applyLeaf(leaf: HierarchyItem, kind: ProjectType, dref: DeclaredReference): void
    {
        const unresolved = dref.Resolution === ReferenceResolution.Unresolved
        leaf.Caption = ReferencesProvider.leafCaption(dref)
        leaf.IconKey = ReferenceNodeKey.Leaf + ReferencesProvider.iconSuffix(dref.Resolution)
        leaf.Severity = unresolved ? NodeSeverity.Warning : NodeSeverity.Ok
        leaf.Error = unresolved ? ReferencesProvider.UnresolvedMessage : undefined
        leaf.ExtObject = { kind, ref: dref.Ref }
    }

    private setCanonical(item: HierarchyItem, canonical: string): void
    {
        const prev = this.canonicalByItem.get(item)
        if (prev !== undefined && prev !== canonical) this.itemByCanonical.delete(prev)
        this.canonicalByItem.set(item, canonical)
        this.itemByCanonical.set(canonical, item)
    }

    private dropCanonical(item: HierarchyItem): void
    {
        const canonical = this.canonicalByItem.get(item)
        if (canonical !== undefined) this.itemByCanonical.delete(canonical)
        this.canonicalByItem.delete(item)
    }

    private forgetLeaf(key: string, leaf: HierarchyItem): void
    {
        this.leafItemByKey.delete(key)
        this.dropCanonical(leaf)
    }

    private static listFor(view: MemberReferencesView, kind: ProjectType): readonly DeclaredReference[]
    {
        return kind === ProjectType.Library ? view.Libraries : view.MetaModels
    }

    private static groupInit(kind: ProjectType): HierarchyItemInit
    {
        const label = kind === ProjectType.Library ? ReferencesProvider.LibrariesGroupLabel : ReferencesProvider.MetaModelsGroupLabel
        return { Caption: label, IconKey: ReferenceNodeKey.Group, IsExpandable: true, ExtObject: kind, CanonicalSegment: ReferencesProvider.slugFor(kind) }
    }

    private static leafInit(kind: ProjectType, dref: DeclaredReference): HierarchyItemInit
    {
        const unresolved = dref.Resolution === ReferenceResolution.Unresolved
        return {
            Caption: ReferencesProvider.leafCaption(dref),
            IconKey: ReferenceNodeKey.Leaf + ReferencesProvider.iconSuffix(dref.Resolution),
            Severity: unresolved ? NodeSeverity.Warning : NodeSeverity.Ok,
            Error: unresolved ? ReferencesProvider.UnresolvedMessage : undefined,
            IsExpandable: false,
            ExtObject: { kind, ref: dref.Ref },
            CanonicalSegment: dref.Ref.id + ReferencesProvider.LeafVersionSeparator + dref.Ref.version,
        }
    }

    private static leafCaption(dref: DeclaredReference): string
    {
        return dref.Ref.id + ReferencesProvider.LeafVersionSeparator + dref.Ref.version
    }

    private static leafCanonical(kind: ProjectType, id: string, version: string): string
    {
        return ReferencesProvider.RootCanonical
            + ReferencesProvider.CanonicalSeparator + ReferencesProvider.slugFor(kind)
            + ReferencesProvider.CanonicalSeparator + id + ReferencesProvider.LeafVersionSeparator + version
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

    private static leafKey(kind: ProjectType, dref: DeclaredReference): string
    {
        return `${kind}${ReferencesProvider.LeafKeySeparator}${dref.Ref.id}`
    }

    private static severityFor(refs: readonly DeclaredReference[]): NodeSeverity
    {
        return refs.some((r) => r.Resolution === ReferenceResolution.Unresolved) ? NodeSeverity.Warning : NodeSeverity.Ok
    }
}
