import {
    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
    type ICommand,
} from '@pragmatic-tech-ai/mural/runtime'

import type { FileSystemService } from '../modules/storage/index.js'
import type { BaseRef } from './base-binding.js'
import { ReferenceNode } from './reference-node.js'

// The New Project dialog's view-model + its per-type choice model. Rendered by
// DataTemplate[NewProjectDialogModel] / DataTemplate[ProjectTypeChoice]. It is a
// plain MuralBase (not a service): the ProjectExplorerService builds one, hands it a
// `close` callback wired to DialogService.Close, and awaits the result.

export interface NewProjectResult
{
    type:      string
    name:      string
    location:  string
    // The meta-models the project is authored against — present (any number) only
    // for a type that RequiresMetaModel (a library or an architecture).
    metaModels?: readonly BaseRef[]
    // The libraries an architecture draws on — present (possibly empty) only for a
    // type that OffersLibraries.
    libraries?: readonly BaseRef[]
}

// One selectable project type in the picker (always a full list, even with a
// single registered factory). Marker is the selection glyph the VM toggles —
// themable text, no triggers/converters needed.
export class ProjectTypeChoice extends MuralBase
{
    static readonly TypeKey = MuralBase.RegisterProperty<string>(ProjectTypeChoice, 'Type', '', MetaData.None)
    static readonly TitleKey = MuralBase.RegisterProperty<string>(ProjectTypeChoice, 'Title', '', MetaData.None)
    static readonly DescriptionKey = MuralBase.RegisterProperty<string>(ProjectTypeChoice, 'Description', '', MetaData.None)
    static readonly MarkerKey = MuralBase.RegisterProperty<string>(ProjectTypeChoice, 'Marker', '○', MetaData.None)
    static readonly RequiresMetaModelKey = MuralBase.RegisterProperty<boolean>(
        ProjectTypeChoice, 'RequiresMetaModel', false, MetaData.None)
    static readonly OffersLibrariesKey = MuralBase.RegisterProperty<boolean>(
        ProjectTypeChoice, 'OffersLibraries', false, MetaData.None)
    static readonly SelectCommandKey = MuralBase.RegisterProperty<ICommand | undefined>(
        ProjectTypeChoice, 'SelectCommand', undefined, MetaData.None)

    constructor(type: string, title: string, description: string, requiresMetaModel = false, offersLibraries = false)
    {
        super()
        this.set_property_value(ProjectTypeChoice.TypeKey, type)
        this.set_property_value(ProjectTypeChoice.TitleKey, title)
        this.set_property_value(ProjectTypeChoice.DescriptionKey, description)
        this.set_property_value(ProjectTypeChoice.RequiresMetaModelKey, requiresMetaModel)
        this.set_property_value(ProjectTypeChoice.OffersLibrariesKey, offersLibraries)
    }

    public get Type(): string { return this.get_property_value(ProjectTypeChoice.TypeKey) }
    public get Title(): string { return this.get_property_value(ProjectTypeChoice.TitleKey) }
    public get Description(): string { return this.get_property_value(ProjectTypeChoice.DescriptionKey) }
    public get Marker(): string { return this.get_property_value(ProjectTypeChoice.MarkerKey) }
    public set Marker(v: string) { this.set_property_value(ProjectTypeChoice.MarkerKey, v) }
    public get RequiresMetaModel(): boolean { return this.get_property_value(ProjectTypeChoice.RequiresMetaModelKey) }
    public set RequiresMetaModel(v: boolean) { this.set_property_value(ProjectTypeChoice.RequiresMetaModelKey, v) }
    public get OffersLibraries(): boolean { return this.get_property_value(ProjectTypeChoice.OffersLibrariesKey) }
    public set OffersLibraries(v: boolean) { this.set_property_value(ProjectTypeChoice.OffersLibrariesKey, v) }
    public get SelectCommand(): ICommand | undefined { return this.get_property_value(ProjectTypeChoice.SelectCommandKey) }
    public set SelectCommand(v: ICommand | undefined) { this.set_property_value(ProjectTypeChoice.SelectCommandKey, v) }
}

export class NewProjectDialogModel extends MuralBase
{
    private static readonly MetaModelsGroupLabel = 'Meta-models'
    private static readonly LibrariesGroupLabel = 'Libraries'
    private static readonly NoMetaModelsError = 'Publish a meta-model first.'

    static readonly TypesKey = MuralBase.RegisterProperty<ObservableCollection<ProjectTypeChoice>>(
        NewProjectDialogModel, 'Types', undefined as unknown as ObservableCollection<ProjectTypeChoice>, MetaData.None)
    static readonly SelectedTypeKey = MuralBase.RegisterProperty<ProjectTypeChoice | undefined>(
        NewProjectDialogModel, 'SelectedType', undefined, MetaData.None)
    static readonly NameKey = MuralBase.RegisterProperty<string>(NewProjectDialogModel, 'Name', '', MetaData.None)
    static readonly LocationKey = MuralBase.RegisterProperty<string>(NewProjectDialogModel, 'Location', '', MetaData.None)
    // The consolidated References tree: up to two group nodes ("Meta-models",
    // "Libraries"), each holding a checkable leaf per available package. Rebuilt on
    // type selection.
    static readonly RootsKey = MuralBase.RegisterProperty<ObservableCollection<ReferenceNode>>(
        NewProjectDialogModel, 'Roots', undefined as unknown as ObservableCollection<ReferenceNode>, MetaData.None)
    static readonly ShowReferencesKey = MuralBase.RegisterProperty<boolean>(
        NewProjectDialogModel, 'ShowReferences', false, MetaData.None)
    static readonly ErrorKey = MuralBase.RegisterProperty<string>(NewProjectDialogModel, 'Error', '', MetaData.None)
    static readonly CanConfirmKey = MuralBase.RegisterProperty<boolean>(NewProjectDialogModel, 'CanConfirm', false, MetaData.None)
    static readonly BrowseCommandKey = MuralBase.RegisterProperty<ICommand>(
        NewProjectDialogModel, 'BrowseCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly ConfirmCommandKey = MuralBase.RegisterProperty<ICommand>(
        NewProjectDialogModel, 'ConfirmCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly CancelCommandKey = MuralBase.RegisterProperty<ICommand>(
        NewProjectDialogModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    // The catalogs offered to a type that references them; leaves are minted per
    // selection so re-selecting a type resets the checks.
    private readonly metaModelRefs: readonly BaseRef[]
    private readonly libraryRefs: readonly BaseRef[]
    private metaGroup?: ReferenceNode
    private libGroup?: ReferenceNode

    constructor(
        choices: readonly ProjectTypeChoice[],
        private readonly fs: FileSystemService,
        // Returns an error message to show in-dialog, or null to proceed/close.
        private readonly validate: (result: NewProjectResult) => Promise<string | null>,
        private readonly close: (result?: NewProjectResult) => void,
        // The published meta-models offered when a RequiresMetaModel type is chosen.
        metaModels: readonly BaseRef[] = [],
        // The published libraries offered when an OffersLibraries type is chosen.
        libraries: readonly BaseRef[] = [],
    )
    {
        super()
        this.metaModelRefs = metaModels
        this.libraryRefs = libraries
        const types = new ObservableCollection<ProjectTypeChoice>()
        for (const c of choices)
        {
            c.SelectCommand = new RelayCommand(() => this.select(c))
            types.Add(c)
        }
        this.set_property_value(NewProjectDialogModel.TypesKey, types)
        this.set_property_value(NewProjectDialogModel.RootsKey, new ObservableCollection<ReferenceNode>())
        this.set_property_value(NewProjectDialogModel.BrowseCommandKey, new RelayCommand(() => void this.browse()))
        this.set_property_value(NewProjectDialogModel.ConfirmCommandKey, new RelayCommand(() => void this.confirm()))
        this.set_property_value(NewProjectDialogModel.CancelCommandKey, new RelayCommand(() => this.close(undefined)))

        this.PropertyChanged(NewProjectDialogModel.NameKey).subscribe(() => this.recompute())
        this.PropertyChanged(NewProjectDialogModel.LocationKey).subscribe(() => this.recompute())

        if (choices.length > 0) this.select(choices[0])
    }

    public get Types(): ObservableCollection<ProjectTypeChoice> { return this.get_property_value(NewProjectDialogModel.TypesKey) }
    public get SelectedType(): ProjectTypeChoice | undefined { return this.get_property_value(NewProjectDialogModel.SelectedTypeKey) }
    public get Name(): string { return this.get_property_value(NewProjectDialogModel.NameKey) }
    public set Name(v: string) { this.set_property_value(NewProjectDialogModel.NameKey, v) }
    public get Location(): string { return this.get_property_value(NewProjectDialogModel.LocationKey) }
    public set Location(v: string) { this.set_property_value(NewProjectDialogModel.LocationKey, v) }
    public get Roots(): ObservableCollection<ReferenceNode> { return this.get_property_value(NewProjectDialogModel.RootsKey) }
    public get ShowReferences(): boolean { return this.get_property_value(NewProjectDialogModel.ShowReferencesKey) }
    // The leaf nodes under each group (empty when the group is not shown) — the
    // prefill checks matching leaves through these.
    public get MetaModelNodes(): readonly ReferenceNode[] { return this.metaGroup?.Children.ToArray() ?? [] }
    public get LibraryNodes(): readonly ReferenceNode[] { return this.libGroup?.Children.ToArray() ?? [] }
    // The BaseRefs of the currently-checked meta-models / libraries.
    public get SelectedMetaModels(): readonly BaseRef[] { return this.metaGroup?.SelectedRefs ?? [] }
    public get SelectedLibraries(): readonly BaseRef[] { return this.libGroup?.SelectedRefs ?? [] }
    public get Error(): string { return this.get_property_value(NewProjectDialogModel.ErrorKey) }
    public get CanConfirm(): boolean { return this.get_property_value(NewProjectDialogModel.CanConfirmKey) }
    public get BrowseCommand(): ICommand { return this.get_property_value(NewProjectDialogModel.BrowseCommandKey) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(NewProjectDialogModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(NewProjectDialogModel.CancelCommandKey) }

    // Select a type: mark it, clear the others, rebuild the References tree for the
    // type's needs, and refresh confirmability. A meta-model-requiring type with
    // nothing published surfaces a guiding error.
    private select(choice: ProjectTypeChoice): void
    {
        for (const c of this.Types.ToArray()) c.Marker = c === choice ? '●' : '○'
        this.set_property_value(NewProjectDialogModel.SelectedTypeKey, choice)
        this.rebuildReferences(choice)
        if (choice.RequiresMetaModel && this.metaModelRefs.length === 0)
            this.set_property_value(NewProjectDialogModel.ErrorKey, NewProjectDialogModel.NoMetaModelsError)
        else
            this.set_property_value(NewProjectDialogModel.ErrorKey, '')
        this.recompute()
    }

    // Mint fresh (unchecked) group + leaf nodes for the selected type, wiring each
    // leaf's check to CanConfirm. A meta-model-requiring type gets the Meta-models
    // group; an OffersLibraries type gets the Libraries group.
    private rebuildReferences(choice: ProjectTypeChoice): void
    {
        this.metaGroup = choice.RequiresMetaModel
            ? this.buildGroup(NewProjectDialogModel.MetaModelsGroupLabel, this.metaModelRefs)
            : undefined
        this.libGroup = choice.OffersLibraries
            ? this.buildGroup(NewProjectDialogModel.LibrariesGroupLabel, this.libraryRefs)
            : undefined
        const roots = this.Roots
        roots.Clear()
        if (this.metaGroup !== undefined) roots.Add(this.metaGroup)
        if (this.libGroup !== undefined) roots.Add(this.libGroup)
        this.set_property_value(NewProjectDialogModel.ShowReferencesKey, roots.Count > 0)
    }

    private buildGroup(label: string, refs: readonly BaseRef[]): ReferenceNode
    {
        const leaves = refs.map((r) => ReferenceNode.leaf(r, false))
        for (const leaf of leaves)
            leaf.PropertyChanged(ReferenceNode.IsSelectedKey).subscribe(() => this.recompute())
        return ReferenceNode.group(label, leaves)
    }

    private async browse(): Promise<void>
    {
        const folder = await this.fs.OpenFolder({ Title: 'Choose a location for the new project folder' })
        if (folder !== null) this.Location = folder
    }

    private async confirm(): Promise<void>
    {
        if (!this.CanConfirm || this.SelectedType === undefined) return
        const type = this.SelectedType
        const result: NewProjectResult = {
            type: type.Type,
            name: this.Name.trim(),
            location: this.Location,
            // A meta-model-requiring type carries the (≥1) checked meta-models.
            ...(type.RequiresMetaModel ? { metaModels: this.SelectedMetaModels } : {}),
            // An OffersLibraries type carries the (possibly empty) checked set.
            ...(type.OffersLibraries ? { libraries: this.SelectedLibraries } : {}),
        }
        const error = await this.validate(result)
        if (error !== null) { this.set_property_value(NewProjectDialogModel.ErrorKey, error); return }
        this.close(result)
    }

    private recompute(): void
    {
        // A meta-model-requiring type also needs at least one checked meta-model.
        const metaOk = this.SelectedType?.RequiresMetaModel !== true || this.SelectedMetaModels.length > 0
        const ok = this.SelectedType !== undefined
            && this.Name.trim().length > 0
            && this.Location.length > 0
            && metaOk
        this.set_property_value(NewProjectDialogModel.CanConfirmKey, ok)
        if (ok) this.set_property_value(NewProjectDialogModel.ErrorKey, '')
    }
}
