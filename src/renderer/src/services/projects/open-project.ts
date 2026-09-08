import { MetaData, MuralBase, ObservableCollection, type ICommand, type PropertyDescriptor } from '@pragmatic-tech-ai/mural/runtime'

import type { IProjectFactory } from './project-factory.js'
import type { IStorage } from '../storage/storage.js'
import { ProjectNode, type Project } from './project.js'
import { NewItemChoice } from './new-item-choice.js'
import type { AgentSkillChoice } from '../../modules/agent-chat/services/agent-skill-choice.js'

// One open project in the explorer — the VM the tree renders as a collapsible
// root. It bundles the project's model (Name + file tree) with the factory and
// storage that back it, and carries the project-specific commands (New File,
// Publish, Close) that its context menu binds. The explorer constructs one per
// open project and sets each command to a RelayCommand closing over this
// instance, so every action unambiguously names its project.
export class OpenProject extends MuralBase
{
    static readonly NameKey = MuralBase.RegisterProperty<string>(OpenProject, 'Name', '', MetaData.None)
    static readonly RootKey = MuralBase.RegisterProperty<ProjectNode>(
        OpenProject, 'Root', undefined as unknown as ProjectNode, MetaData.None)
    // The "Add New" submenu's choices — one per the factory's declared formats,
    // set by the host (ProjectExplorerService.wireProjectCommands).
    static readonly NewItemChoicesKey = MuralBase.RegisterProperty<ObservableCollection<NewItemChoice>>(
        OpenProject, 'NewItemChoices', undefined as unknown as ObservableCollection<NewItemChoice>, MetaData.None)
    static readonly ImportFileCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'ImportFileCommand', undefined, MetaData.None)
    static readonly ImportFolderCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'ImportFolderCommand', undefined, MetaData.None)
    static readonly NewFolderCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'NewFolderCommand', undefined, MetaData.None)
    // Keyboard handler for the project's TreeView (bound via `on KeyDown`): the
    // host inspects the KeyEventArgs and drives F2 (begin rename of SelectedNode),
    // Enter (commit the EditingNode) and Escape (cancel).
    static readonly TreeKeyCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'TreeKeyCommand', undefined, MetaData.None)
    static readonly PublishCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'PublishCommand', undefined, MetaData.None)
    // Bump the producer project's published version by one semver part, or set it
    // via a dialog — all enabled only for factories that expose a version.
    static readonly BumpVersionMajorCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'BumpVersionMajorCommand', undefined, MetaData.None)
    static readonly BumpVersionMinorCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'BumpVersionMinorCommand', undefined, MetaData.None)
    static readonly BumpVersionPatchCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'BumpVersionPatchCommand', undefined, MetaData.None)
    static readonly SetVersionCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'SetVersionCommand', undefined, MetaData.None)
    // Refresh the project's agent scaffold docs (.claude/**) to the current
    // bundled version — enabled for any TODL project.
    static readonly UpdateAgentMetadataCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'UpdateAgentMetadataCommand', undefined, MetaData.None)
    // (Re)generate the project's presentation dictionary — one command per icon mode
    // (colorful / monochrome), both enabled only for factories that support it.
    static readonly GeneratePresentationColorfulCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'GeneratePresentationColorfulCommand', undefined, MetaData.None)
    static readonly GeneratePresentationMonochromeCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'GeneratePresentationMonochromeCommand', undefined, MetaData.None)
    // Re-resolve the project's declared bases (drop the validator's per-storage
    // cache + revalidate) — picks up a republished meta-model/library.
    static readonly RefreshBasesCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'RefreshBasesCommand', undefined, MetaData.None)
    // Open the References manager to edit this project's base bindings (its
    // meta-model + libraries) — enabled only for a consumer factory that binds a
    // meta-model (architecture / library), not for a meta-model project.
    static readonly ManageReferencesCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'ManageReferencesCommand', undefined, MetaData.None)
    static readonly CloseCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'CloseCommand', undefined, MetaData.None)
    // Move dragged node(s) into a target folder — the drag behavior executes this
    // with a { nodes, destPath } argument (see MoveArg in the explorer service).
    static readonly MoveNodesCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        OpenProject, 'MoveNodesCommand', undefined, MetaData.None)
    // The tree's selected node — two-way target of the TreeView's
    // SelectedDataItem. Selecting a row pushes the ProjectNode here; the
    // OnPropertyChanged hook activates it (a leaf opens, a folder no-ops via its
    // OpenCommand). Lets the whole tree stay declarative (ItemsSource +
    // HierarchicalDataTemplate) with no view-tree wiring.
    static readonly SelectedNodeKey = MuralBase.RegisterProperty<ProjectNode | undefined>(
        OpenProject, 'SelectedNode', undefined, MetaData.None)
    // Whether the project's file tree is shown. Pure view state, owned here and
    // two-way bound to the header chevron's ToggleButton.IsChecked; the chevron
    // glyph and the tree's Visibility both bind to it.
    static readonly IsExpandedKey = MuralBase.RegisterProperty<boolean>(
        OpenProject, 'IsExpanded', true, MetaData.None)
    // The "Run Agent / Skill" submenu choices — one per the project's declared
    // .claude/ agents + skills, populated async by ProjectExplorerService. Empty
    // (and HasAgentSkills=false) for a project with no .claude catalog.
    static readonly AgentSkillChoicesKey = MuralBase.RegisterProperty<ObservableCollection<AgentSkillChoice>>(
        OpenProject, 'AgentSkillChoices', undefined as unknown as ObservableCollection<AgentSkillChoice>, MetaData.None)
    static readonly HasAgentSkillsKey = MuralBase.RegisterProperty<boolean>(
        OpenProject, 'HasAgentSkills', false, MetaData.None)

    private project: Project
    private readonly factory: IProjectFactory
    private readonly storage: IStorage

    constructor(project: Project, factory: IProjectFactory, storage: IStorage)
    {
        super()
        this.project = project
        this.factory = factory
        this.storage = storage
        this.set_property_value(OpenProject.NameKey, project.Name)
        this.set_property_value(OpenProject.RootKey, project.Root)
    }

    // Activate the node the tree just selected — run its OpenCommand (wired by
    // ProjectExplorerService.wireNodes: a leaf opens its file, a folder no-ops).
    protected override OnPropertyChanged(descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        if (descriptor.Name === 'SelectedNode' && newValue instanceof ProjectNode)
        {
            newValue.OpenCommand?.Execute(undefined)
        }
    }

    // Adopt a freshly-scanned Project (same factory/storage) — after a rescan
    // (new file/folder, import, delete) rebuilds the tree. The Root instance is
    // KEPT and its subtree reconciled IN PLACE: the TreeView captures Root.Children
    // (an ObservableCollection) when a project's container is first prepared, so
    // swapping Root wholesale would leave the tree observing the old collection and
    // a rescan's added files/folders would never appear. The caller re-wires the
    // new nodes' OpenCommands.
    public Adopt(project: Project): void
    {
        this.project = project
        this.set_property_value(OpenProject.NameKey, project.Name)
        reconcileChildren(this.Root, project.Root)
    }

    public get Name(): string { return this.get_property_value(OpenProject.NameKey) }
    public get Root(): ProjectNode { return this.get_property_value(OpenProject.RootKey) }

    public get NewItemChoices(): ObservableCollection<NewItemChoice> { return this.get_property_value(OpenProject.NewItemChoicesKey) }
    public set NewItemChoices(v: ObservableCollection<NewItemChoice>) { this.set_property_value(OpenProject.NewItemChoicesKey, v) }

    public get ImportFileCommand(): ICommand | undefined { return this.get_property_value(OpenProject.ImportFileCommandKey) }
    public set ImportFileCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.ImportFileCommandKey, v) }
    public get ImportFolderCommand(): ICommand | undefined { return this.get_property_value(OpenProject.ImportFolderCommandKey) }
    public set ImportFolderCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.ImportFolderCommandKey, v) }

    public get NewFolderCommand(): ICommand | undefined { return this.get_property_value(OpenProject.NewFolderCommandKey) }
    public set NewFolderCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.NewFolderCommandKey, v) }

    public get TreeKeyCommand(): ICommand | undefined { return this.get_property_value(OpenProject.TreeKeyCommandKey) }
    public set TreeKeyCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.TreeKeyCommandKey, v) }

    // The node whose row is currently in rename mode (at most one per project).
    // Plain view-transient state — not bound, so a field rather than a DP.
    public EditingNode: ProjectNode | undefined = undefined

    // The tree's full multi-selection — the set of selected ProjectNodes,
    // pushed here by TreeSelectionBehavior (the TreeView runs in Extended
    // selection mode). SelectedNode above stays the anchor (what opens on
    // click); this is what a Delete acts on when several rows are selected.
    // Not bound to the view (the host reads it), so a plain field.
    public SelectedNodes: readonly ProjectNode[] = []

    public get PublishCommand(): ICommand | undefined { return this.get_property_value(OpenProject.PublishCommandKey) }
    public set PublishCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.PublishCommandKey, v) }
    public get BumpVersionMajorCommand(): ICommand | undefined { return this.get_property_value(OpenProject.BumpVersionMajorCommandKey) }
    public set BumpVersionMajorCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.BumpVersionMajorCommandKey, v) }
    public get BumpVersionMinorCommand(): ICommand | undefined { return this.get_property_value(OpenProject.BumpVersionMinorCommandKey) }
    public set BumpVersionMinorCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.BumpVersionMinorCommandKey, v) }
    public get BumpVersionPatchCommand(): ICommand | undefined { return this.get_property_value(OpenProject.BumpVersionPatchCommandKey) }
    public set BumpVersionPatchCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.BumpVersionPatchCommandKey, v) }
    public get SetVersionCommand(): ICommand | undefined { return this.get_property_value(OpenProject.SetVersionCommandKey) }
    public set SetVersionCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.SetVersionCommandKey, v) }
    public get UpdateAgentMetadataCommand(): ICommand | undefined { return this.get_property_value(OpenProject.UpdateAgentMetadataCommandKey) }
    public set UpdateAgentMetadataCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.UpdateAgentMetadataCommandKey, v) }
    public get GeneratePresentationColorfulCommand(): ICommand | undefined { return this.get_property_value(OpenProject.GeneratePresentationColorfulCommandKey) }
    public set GeneratePresentationColorfulCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.GeneratePresentationColorfulCommandKey, v) }
    public get GeneratePresentationMonochromeCommand(): ICommand | undefined { return this.get_property_value(OpenProject.GeneratePresentationMonochromeCommandKey) }
    public set GeneratePresentationMonochromeCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.GeneratePresentationMonochromeCommandKey, v) }

    public get RefreshBasesCommand(): ICommand | undefined { return this.get_property_value(OpenProject.RefreshBasesCommandKey) }
    public set RefreshBasesCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.RefreshBasesCommandKey, v) }

    public get ManageReferencesCommand(): ICommand | undefined { return this.get_property_value(OpenProject.ManageReferencesCommandKey) }
    public set ManageReferencesCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.ManageReferencesCommandKey, v) }

    public get MoveNodesCommand(): ICommand | undefined { return this.get_property_value(OpenProject.MoveNodesCommandKey) }
    public set MoveNodesCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.MoveNodesCommandKey, v) }

    public get CloseCommand(): ICommand | undefined { return this.get_property_value(OpenProject.CloseCommandKey) }
    public set CloseCommand(v: ICommand | undefined) { this.set_property_value(OpenProject.CloseCommandKey, v) }

    public get SelectedNode(): ProjectNode | undefined { return this.get_property_value(OpenProject.SelectedNodeKey) }
    public set SelectedNode(v: ProjectNode | undefined) { this.set_property_value(OpenProject.SelectedNodeKey, v) }

    public get IsExpanded(): boolean { return this.get_property_value(OpenProject.IsExpandedKey) }
    public set IsExpanded(v: boolean) { this.set_property_value(OpenProject.IsExpandedKey, v) }

    public get AgentSkillChoices(): ObservableCollection<AgentSkillChoice> { return this.get_property_value(OpenProject.AgentSkillChoicesKey) }
    public set AgentSkillChoices(v: ObservableCollection<AgentSkillChoice>) { this.set_property_value(OpenProject.AgentSkillChoicesKey, v) }
    public get HasAgentSkills(): boolean { return this.get_property_value(OpenProject.HasAgentSkillsKey) }
    public set HasAgentSkills(v: boolean) { this.set_property_value(OpenProject.HasAgentSkillsKey, v) }

    // The backing project model, factory, and storage (read-only to the explorer).
    public get Project(): Project { return this.project }
    public get Factory(): IProjectFactory { return this.factory }
    public get Storage(): IStorage { return this.storage }
    // The project's root folder — the dedupe + persistence key.
    public get Folder(): string { return this.project.RootPath }
}

// Update `existing`'s Children subtree to match `fresh`'s IN PLACE, keyed by each
// node's project-relative Path (its stable identity). Mutating the same
// ObservableCollection the TreeView observes is what makes the change appear (see
// OpenProject.Adopt). Done INCREMENTALLY — only added/removed rows change — so a
// rescan does not churn the whole tree: a matched child keeps its instance and is
// recursed into, preserving unchanged folders' expansion. Both child lists come
// from the same sorted scan, so survivors stay in fresh's relative order and a new
// node just lands at its index.
function reconcileChildren(existing: ProjectNode, fresh: ProjectNode): void
{
    const freshList = fresh.Children.ToArray()
    const freshPaths = new Set(freshList.map((c) => c.Path))
    for (const child of existing.Children.ToArray())
        if (!freshPaths.has(child.Path)) existing.Children.Remove(child)

    const byPath = new Map(existing.Children.ToArray().map((c) => [c.Path, c]))
    freshList.forEach((child, i) =>
    {
        const kept = byPath.get(child.Path)
        if (kept === undefined) existing.Children.Insert(i, child)
        else reconcileChildren(kept, child)
    })
}
