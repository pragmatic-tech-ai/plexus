import { MetaData, MuralBase, ObservableCollection, type ICommand } from '@pragmatic-tech-ai/mural/runtime'

// A uniform tree node for the Meta-models panel — one type for every level
// (model id, version, kind group, entity) so a single HierarchicalDataTemplate
// governs the whole tree (mirrors ProjectNode). Kind drives the leading icon.
//
// Version nodes are lazy: they carry a loader and a single "Loading…" sentinel
// child so the TreeView paints a chevron before anything is read. The mural
// TreeViewItem calls OnExpand() on first expand; the node runs its loader once
// and swaps the sentinel for the produced subtree. Because Children is an
// ObservableCollection bound live as the row's ItemsSource, the async swap
// updates the tree in place.
export enum MetaModelNodeKind
{
    Model = 'model',
    Version = 'version',
    Group = 'group',
    Entity = 'entity',
}

// Identifies a published ontology entity so a tree row can open its drawer.
export interface EntityRef { modelId: string; version: string; id: string }

export class MetaModelTreeNode extends MuralBase
{
    public static readonly KindKey = MuralBase.RegisterProperty<MetaModelNodeKind>(
        MetaModelTreeNode, 'Kind', MetaModelNodeKind.Entity, MetaData.None)

    public static readonly LabelKey = MuralBase.RegisterProperty<string>(
        MetaModelTreeNode, 'Label', '', MetaData.None)

    public static readonly ChildrenKey = MuralBase.RegisterProperty<ObservableCollection<MetaModelTreeNode>>(
        MetaModelTreeNode, 'Children',
        undefined as unknown as ObservableCollection<MetaModelTreeNode>, MetaData.None)

    // Delete wiring — set on Model and Version nodes by buildCatalog. ModelId is
    // the published id; ModelVersion is the version (empty on a Model node);
    // DeleteCommand removes the target (see MetaModelsService.deleteTarget).
    public static readonly ModelIdKey = MuralBase.RegisterProperty<string>(
        MetaModelTreeNode, 'ModelId', '', MetaData.None)
    public static readonly ModelVersionKey = MuralBase.RegisterProperty<string>(
        MetaModelTreeNode, 'ModelVersion', '', MetaData.None)
    public static readonly DeleteCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        MetaModelTreeNode, 'DeleteCommand', undefined, MetaData.None)

    // Whether this row can be deleted (Model / Version only). A registered
    // property — NOT a plain getter — because `.mu` bindings on a Model resolve
    // only against the property table (see the `when ($IsDeletable)` trigger in
    // meta-model.resources.mu); a plain getter binds to undefined and the menu
    // never attaches. Set once at construction from Kind.
    public static readonly IsDeletableKey = MuralBase.RegisterProperty<boolean>(
        MetaModelTreeNode, 'IsDeletable', false, MetaData.None)

    // Wiki wiring — Entity rows only. Concept is the ontology entity's local id
    // (the concept the `@wiki` annotation is keyed on); HasWiki (filled async by
    // MetaModelsService) drives the shared "Open Wiki" menu-item visibility.
    public static readonly ConceptKey = MuralBase.RegisterProperty<string>(
        MetaModelTreeNode, 'Concept', '', MetaData.None)
    public static readonly HasWikiKey = MuralBase.RegisterProperty<boolean>(
        MetaModelTreeNode, 'HasWiki', false, MetaData.None)

    // Lazy machinery (view-invisible → plain fields). Only lazy() sets a loader.
    private loader?: () => Promise<MetaModelTreeNode[]>
    private loaded = false

    // Entity activation (view-invisible → plain fields). Only entity() sets these.
    private ref?: EntityRef
    private activate?: (ref: EntityRef) => void

    private constructor(kind: MetaModelNodeKind, label: string)
    {
        super()
        this.set_property_value(MetaModelTreeNode.KindKey, kind)
        this.set_property_value(MetaModelTreeNode.LabelKey, label)
        this.set_property_value(MetaModelTreeNode.ChildrenKey, new ObservableCollection<MetaModelTreeNode>())
        this.set_property_value(MetaModelTreeNode.IsDeletableKey,
            kind === MetaModelNodeKind.Model || kind === MetaModelNodeKind.Version)
    }

    public get Kind(): MetaModelNodeKind { return this.get_property_value(MetaModelTreeNode.KindKey) }
    public get Label(): string { return this.get_property_value(MetaModelTreeNode.LabelKey) }
    public get Children(): ObservableCollection<MetaModelTreeNode>
    {
        return this.get_property_value(MetaModelTreeNode.ChildrenKey)
    }

    public get ModelId(): string { return this.get_property_value(MetaModelTreeNode.ModelIdKey) }
    public set ModelId(v: string) { this.set_property_value(MetaModelTreeNode.ModelIdKey, v) }
    public get ModelVersion(): string { return this.get_property_value(MetaModelTreeNode.ModelVersionKey) }
    public set ModelVersion(v: string) { this.set_property_value(MetaModelTreeNode.ModelVersionKey, v) }
    public get DeleteCommand(): ICommand | undefined { return this.get_property_value(MetaModelTreeNode.DeleteCommandKey) }
    public set DeleteCommand(v: ICommand | undefined) { this.set_property_value(MetaModelTreeNode.DeleteCommandKey, v) }

    // Only Model (id) and Version (<id>/<version>) rows can be deleted; Group /
    // Entity rows get no context menu. Reads the property set at construction.
    public get IsDeletable(): boolean { return this.get_property_value(MetaModelTreeNode.IsDeletableKey) }

    public get Concept(): string { return this.get_property_value(MetaModelTreeNode.ConceptKey) }
    public get HasWiki(): boolean { return this.get_property_value(MetaModelTreeNode.HasWikiKey) }
    public set HasWiki(v: boolean) { this.set_property_value(MetaModelTreeNode.HasWikiKey, v) }

    // A non-lazy node: children (if any) are added by the caller.
    public static leaf(kind: MetaModelNodeKind, label: string): MetaModelTreeNode
    {
        return new MetaModelTreeNode(kind, label)
    }

    // An entity leaf that opens its drawer on double-click activation.
    public static entity(
        label: string, ref: EntityRef, activate: (ref: EntityRef) => void, concept = '',
    ): MetaModelTreeNode
    {
        const node = new MetaModelTreeNode(MetaModelNodeKind.Entity, label)
        node.ref = ref
        node.activate = activate
        node.set_property_value(MetaModelTreeNode.ConceptKey, concept)
        return node
    }

    // A lazy node: seeded with a "Loading…" sentinel; loader runs on first expand.
    public static lazy(
        kind: MetaModelNodeKind, label: string,
        loader: () => Promise<MetaModelTreeNode[]>,
    ): MetaModelTreeNode
    {
        const node = new MetaModelTreeNode(kind, label)
        node.loader = loader
        node.Children.Add(MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'Loading…'))
        return node
    }

    // Called by the mural TreeViewItem when this row expands. Runs the loader
    // exactly once (idempotent); subsequent expands are no-ops.
    public OnExpand(): void
    {
        if (this.loaded || this.loader === undefined) return
        this.loaded = true
        void this.runLoader(this.loader)
    }

    // Called by the mural TreeViewItem on a row double-click. Entity nodes open
    // their drawer; every other node is inert.
    public OnActivate(): void
    {
        if (this.ref !== undefined && this.activate !== undefined) this.activate(this.ref)
    }

    private async runLoader(loader: () => Promise<MetaModelTreeNode[]>): Promise<void>
    {
        let children: MetaModelTreeNode[]
        try { children = await loader() }
        catch { children = [MetaModelTreeNode.leaf(MetaModelNodeKind.Entity, 'Failed to load model.json')] }
        this.Children.Clear()
        for (const c of children) this.Children.Add(c)
    }
}
