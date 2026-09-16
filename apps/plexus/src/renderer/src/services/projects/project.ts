import { MetaData, MuralBase, ObservableCollection, type ICommand } from '@pragmatic-tech-ai/mural/runtime'

import { NewItemChoice } from './new-item-choice.js'

// A project and its file tree — the generic, host-owned model a project
// factory populates. `Project` and `ProjectNode` are Models so the explorer's
// TreeView binds them directly (Name/Kind per item, Children for expansion).

// What a tree node represents. 'diagram' and 'todl' are files the active factory
// opens in-app (each is a factory format kind — the explorer routes any node
// whose kind matches a declared format to openFile); 'file' is any other
// attachment (opened via the OS); 'folder' groups.
export type ProjectNodeKind = 'folder' | 'diagram' | 'todl' | 'file'

export class ProjectNode extends MuralBase
{
    static readonly NameKey = MuralBase.RegisterProperty<string>(ProjectNode, 'Name', '', MetaData.None)
    static readonly PathKey = MuralBase.RegisterProperty<string>(ProjectNode, 'Path', '', MetaData.None)
    static readonly KindKey = MuralBase.RegisterProperty<ProjectNodeKind>(ProjectNode, 'Kind', 'file', MetaData.None)
    static readonly ChildrenKey = MuralBase.RegisterProperty<ObservableCollection<ProjectNode>>(
        ProjectNode, 'Children', undefined as unknown as ObservableCollection<ProjectNode>, MetaData.None)
    // The action to run when this node is activated in the tree — set by the
    // host (ProjectExplorerService) so the row can bind `Command = $OpenCommand`
    // without threading the node through a CommandParameter.
    static readonly OpenCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'OpenCommand', undefined, MetaData.None)
    // The "Add New" submenu's choices for this node's container — one per the
    // factory's declared formats, set by the host (ProjectExplorerService.wireNodes).
    // A folder node creates inside itself; a file node beside itself.
    static readonly NewItemChoicesKey = MuralBase.RegisterProperty<ObservableCollection<NewItemChoice>>(
        ProjectNode, 'NewItemChoices', undefined as unknown as ObservableCollection<NewItemChoice>, MetaData.None)
    static readonly NewFolderCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'NewFolderCommand', undefined, MetaData.None)
    static readonly ImportFileCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'ImportFileCommand', undefined, MetaData.None)
    static readonly ImportFolderCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'ImportFolderCommand', undefined, MetaData.None)
    // In-place rename state. IsEditing swaps the row's label for a TextBox (see
    // the ProjectNodeTemplate); EditingName is that box's two-way text buffer.
    // BeginRename (context-menu "Rename" / F2) opens the editor; the TreeView's
    // key handler commits on Enter and cancels on Escape (host-driven).
    static readonly IsEditingKey = MuralBase.RegisterProperty<boolean>(
        ProjectNode, 'IsEditing', false, MetaData.None)
    static readonly EditingNameKey = MuralBase.RegisterProperty<string>(
        ProjectNode, 'EditingName', '', MetaData.None)
    static readonly BeginRenameCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'BeginRenameCommand', undefined, MetaData.None)
    // Delete this node (file or folder, with its contents) from the project,
    // after a confirmation. Set by the host (ProjectExplorerService.wireNodes)
    // so a row's context menu can bind `Command = $DeleteCommand`; disabled on
    // the (unshown) root. When the node is part of a multi-selection, deleting
    // it removes the whole selected set.
    static readonly DeleteCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'DeleteCommand', undefined, MetaData.None)
    // An optional project-type-specific context-menu action for this node,
    // contributed by a module through the INodeCommandContributor seam (e.g. the
    // architecture "Edit Viewpoints…" on a .diagram node). HasNodeAction gates the
    // menu item's visibility so nothing shows for nodes with no contribution.
    static readonly NodeActionLabelKey = MuralBase.RegisterProperty<string>(
        ProjectNode, 'NodeActionLabel', '', MetaData.None)
    static readonly NodeActionCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'NodeActionCommand', undefined, MetaData.None)
    static readonly HasNodeActionKey = MuralBase.RegisterProperty<boolean>(
        ProjectNode, 'HasNodeAction', false, MetaData.None)
    // Diagram export — an "Export ▸ SVG / PPTX" submenu shown on .diagram nodes
    // (HasExport gates its visibility). The commands render the file HEADLESSLY
    // (DiagramHeadlessRenderer) and save via DiagramExportService, so a diagram
    // exports straight from the tree without being opened in the editor.
    static readonly ExportSvgCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'ExportSvgCommand', undefined, MetaData.None)
    static readonly ExportPptxCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        ProjectNode, 'ExportPptxCommand', undefined, MetaData.None)
    static readonly HasExportKey = MuralBase.RegisterProperty<boolean>(
        ProjectNode, 'HasExport', false, MetaData.None)
    // Self-reference so a row can hand the whole node to a ContentControl's
    // Content (`Content = $Data`). The rename editor is stamped lazily through
    // that ContentControl — see the ProjectNodeTemplate — so the heavy TextBox
    // only materialises for the one node being renamed, not once per row.
    static readonly DataKey = MuralBase.RegisterProperty<ProjectNode>(
        ProjectNode, 'Data', undefined as unknown as ProjectNode, MetaData.None)

    constructor(name: string, path: string, kind: ProjectNodeKind)
    {
        super()
        this.set_property_value(ProjectNode.NameKey, name)
        this.set_property_value(ProjectNode.PathKey, path)
        this.set_property_value(ProjectNode.KindKey, kind)
        this.set_property_value(ProjectNode.ChildrenKey, new ObservableCollection<ProjectNode>())
        this.set_property_value(ProjectNode.DataKey, this)
    }

    public get Data(): ProjectNode { return this.get_property_value(ProjectNode.DataKey) }

    public get Name(): string { return this.get_property_value(ProjectNode.NameKey) }
    // Settable so an in-place rename can update the node without rebuilding the
    // tree (the bound TreeView row re-reads Name; the node object is preserved,
    // keeping its container's expansion/selection). Path moves in lock-step.
    public set Name(v: string) { this.set_property_value(ProjectNode.NameKey, v) }
    public get Path(): string { return this.get_property_value(ProjectNode.PathKey) }
    public set Path(v: string) { this.set_property_value(ProjectNode.PathKey, v) }
    public get Kind(): ProjectNodeKind { return this.get_property_value(ProjectNode.KindKey) }
    public get Children(): ObservableCollection<ProjectNode> { return this.get_property_value(ProjectNode.ChildrenKey) }
    public get OpenCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.OpenCommandKey) }
    public set OpenCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.OpenCommandKey, v) }

    public get NewItemChoices(): ObservableCollection<NewItemChoice> { return this.get_property_value(ProjectNode.NewItemChoicesKey) }
    public set NewItemChoices(v: ObservableCollection<NewItemChoice>) { this.set_property_value(ProjectNode.NewItemChoicesKey, v) }

    public get NewFolderCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.NewFolderCommandKey) }
    public set NewFolderCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.NewFolderCommandKey, v) }

    public get ImportFileCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.ImportFileCommandKey) }
    public set ImportFileCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.ImportFileCommandKey, v) }

    public get ImportFolderCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.ImportFolderCommandKey) }
    public set ImportFolderCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.ImportFolderCommandKey, v) }

    public get IsEditing(): boolean { return this.get_property_value(ProjectNode.IsEditingKey) }
    public set IsEditing(v: boolean) { this.set_property_value(ProjectNode.IsEditingKey, v) }

    public get EditingName(): string { return this.get_property_value(ProjectNode.EditingNameKey) }
    public set EditingName(v: string) { this.set_property_value(ProjectNode.EditingNameKey, v) }

    public get BeginRenameCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.BeginRenameCommandKey) }
    public set BeginRenameCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.BeginRenameCommandKey, v) }

    public get DeleteCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.DeleteCommandKey) }
    public set DeleteCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.DeleteCommandKey, v) }

    public get NodeActionLabel(): string { return this.get_property_value(ProjectNode.NodeActionLabelKey) }
    public set NodeActionLabel(v: string) { this.set_property_value(ProjectNode.NodeActionLabelKey, v) }
    public get NodeActionCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.NodeActionCommandKey) }
    public set NodeActionCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.NodeActionCommandKey, v) }
    public get HasNodeAction(): boolean { return this.get_property_value(ProjectNode.HasNodeActionKey) }
    public set HasNodeAction(v: boolean) { this.set_property_value(ProjectNode.HasNodeActionKey, v) }

    public get ExportSvgCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.ExportSvgCommandKey) }
    public set ExportSvgCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.ExportSvgCommandKey, v) }
    public get ExportPptxCommand(): ICommand | undefined { return this.get_property_value(ProjectNode.ExportPptxCommandKey) }
    public set ExportPptxCommand(v: ICommand | undefined) { this.set_property_value(ProjectNode.ExportPptxCommandKey, v) }
    public get HasExport(): boolean { return this.get_property_value(ProjectNode.HasExportKey) }
    public set HasExport(v: boolean) { this.set_property_value(ProjectNode.HasExportKey, v) }
}

export class Project extends MuralBase
{
    static readonly NameKey = MuralBase.RegisterProperty<string>(Project, 'Name', '', MetaData.None)
    static readonly TypeKey = MuralBase.RegisterProperty<string>(Project, 'Type', '', MetaData.None)
    static readonly RootPathKey = MuralBase.RegisterProperty<string>(Project, 'RootPath', '', MetaData.None)
    static readonly RootKey = MuralBase.RegisterProperty<ProjectNode>(
        Project, 'Root', undefined as unknown as ProjectNode, MetaData.None)

    constructor(type: string, name: string, rootPath: string, root: ProjectNode)
    {
        super()
        this.set_property_value(Project.TypeKey, type)
        this.set_property_value(Project.NameKey, name)
        this.set_property_value(Project.RootPathKey, rootPath)
        this.set_property_value(Project.RootKey, root)
    }

    public get Name(): string { return this.get_property_value(Project.NameKey) }
    public get Type(): string { return this.get_property_value(Project.TypeKey) }
    public get RootPath(): string { return this.get_property_value(Project.RootPathKey) }
    public get Root(): ProjectNode { return this.get_property_value(Project.RootKey) }
}
