import {
    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
    type ICommand,
} from '@pragmatic-tech-ai/mural/runtime'

import type { BaseBindings, BaseRef } from './base-binding.js'
import { LibraryChoice, MetaModelChoice } from './new-project-dialog-model.js'

// The "Manage References" dialog's view-model — the consolidated VS-style
// references editor for a consumer TODL project (architecture / library). It
// shows the project's current base bindings against the catalog of everything it
// COULD reference (published packages ∪ open workspace producers) and lets the
// user add/remove without leaving the dialog:
//   * Meta-model — the required singleton — is a ComboBox pre-selected to the
//     current binding; picking another entry swaps it (a workspace producer can
//     be chosen before it is published — resolution is local-first).
//   * Libraries (architecture only) — a checklist where the current references
//     start CHECKED and the addable ones start unchecked, so unchecking removes
//     and checking adds. The result is simply the checked set.
//
// It reuses MetaModelChoice / LibraryChoice (and their DataTemplates) from the
// New-Project dialog. Like every dialog VM here it is a MuralBase (not the
// lightweight Observable): it genuinely leans on the dependency-property system —
// two-way SelectedMetaModel + per-row IsSelected bindings and a CanConfirm that
// recomputes on selection change — the same shape as NewProjectDialogModel.
export class ManageReferencesDialogModel extends MuralBase
{
    static readonly MetaModelsKey = MuralBase.RegisterProperty<ObservableCollection<MetaModelChoice>>(
        ManageReferencesDialogModel, 'MetaModels', undefined as unknown as ObservableCollection<MetaModelChoice>, MetaData.None)
    static readonly SelectedMetaModelKey = MuralBase.RegisterProperty<MetaModelChoice | undefined>(
        ManageReferencesDialogModel, 'SelectedMetaModel', undefined, MetaData.None)
    static readonly ShowLibrariesKey = MuralBase.RegisterProperty<boolean>(
        ManageReferencesDialogModel, 'ShowLibraries', false, MetaData.None)
    static readonly LibrariesKey = MuralBase.RegisterProperty<ObservableCollection<LibraryChoice>>(
        ManageReferencesDialogModel, 'Libraries', undefined as unknown as ObservableCollection<LibraryChoice>, MetaData.None)
    // Guidance shown in the libraries section when there is nothing to list
    // (no library is published or open) — the checklist renders empty otherwise.
    static readonly EmptyLibrariesLabelKey = MuralBase.RegisterProperty<string>(
        ManageReferencesDialogModel, 'EmptyLibrariesLabel', '', MetaData.None)
    static readonly CanConfirmKey = MuralBase.RegisterProperty<boolean>(
        ManageReferencesDialogModel, 'CanConfirm', false, MetaData.None)
    static readonly ConfirmCommandKey = MuralBase.RegisterProperty<ICommand>(
        ManageReferencesDialogModel, 'ConfirmCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly CancelCommandKey = MuralBase.RegisterProperty<ICommand>(
        ManageReferencesDialogModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    // Whether the managed project declares a libraries list (architecture). A
    // library project omits libraries from its manifest, so the result must too.
    private readonly offersLibraries: boolean

    constructor(
        // The project's current base bindings, read from its manifest.
        current: BaseBindings,
        // Meta-models the project could reference — published ∪ open workspace
        // meta-model producers.
        availableMetaModels: readonly BaseRef[],
        // Libraries the project could reference — published ∪ open workspace
        // library producers. Ignored when the project does not offer libraries.
        availableLibraries: readonly BaseRef[],
        // Whether the project type carries a libraries list (architecture = true,
        // library = false).
        offersLibraries: boolean,
        // Resolves the edited bindings on confirm, or undefined on cancel/dismiss.
        private readonly close: (result?: BaseBindings) => void,
    )
    {
        super()
        this.offersLibraries = offersLibraries

        // Meta-models: the catalog, guaranteed to include (and pre-select) the
        // current binding even when it is no longer published/open — a stale ref
        // stays visible rather than silently vanishing.
        const metaRefs = ManageReferencesDialogModel.dedupe(
            current.metaModel !== undefined ? [current.metaModel, ...availableMetaModels] : availableMetaModels)
        const metas = new ObservableCollection<MetaModelChoice>()
        for (const ref of metaRefs) metas.Add(new MetaModelChoice(ref))
        this.set_property_value(ManageReferencesDialogModel.MetaModelsKey, metas)
        const selected = current.metaModel !== undefined
            ? metas.ToArray().find((m) => ManageReferencesDialogModel.sameRef(m.Ref, current.metaModel!))
            : metas.ToArray()[0]
        this.set_property_value(ManageReferencesDialogModel.SelectedMetaModelKey, selected)

        // Libraries (architecture only): the current refs (checked) followed by
        // the addable ones (unchecked), deduped by id@version so a ref offered by
        // both the published store and a workspace project appears once.
        this.set_property_value(ManageReferencesDialogModel.ShowLibrariesKey, offersLibraries)
        const libs = new ObservableCollection<LibraryChoice>()
        if (offersLibraries)
        {
            const currentLibs = current.libraries ?? []
            const checked = new Set(currentLibs.map((l) => ManageReferencesDialogModel.key(l)))
            for (const ref of ManageReferencesDialogModel.dedupe([...currentLibs, ...availableLibraries]))
            {
                const choice = new LibraryChoice(ref)
                choice.IsSelected = checked.has(ManageReferencesDialogModel.key(ref))
                libs.Add(choice)
            }
        }
        this.set_property_value(ManageReferencesDialogModel.LibrariesKey, libs)
        this.set_property_value(ManageReferencesDialogModel.EmptyLibrariesLabelKey,
            offersLibraries && libs.Count === 0 ? 'No libraries are published or open to reference.' : '')

        this.set_property_value(ManageReferencesDialogModel.ConfirmCommandKey,
            new RelayCommand(() => { if (this.CanConfirm) this.close(this.Result) }))
        this.set_property_value(ManageReferencesDialogModel.CancelCommandKey,
            new RelayCommand(() => this.close(undefined)))

        this.PropertyChanged(ManageReferencesDialogModel.SelectedMetaModelKey).subscribe(() => this.recompute())
        this.recompute()
    }

    public get MetaModels(): ObservableCollection<MetaModelChoice> { return this.get_property_value(ManageReferencesDialogModel.MetaModelsKey) }
    public get SelectedMetaModel(): MetaModelChoice | undefined { return this.get_property_value(ManageReferencesDialogModel.SelectedMetaModelKey) }
    public set SelectedMetaModel(v: MetaModelChoice | undefined) { this.set_property_value(ManageReferencesDialogModel.SelectedMetaModelKey, v) }
    public get ShowLibraries(): boolean { return this.get_property_value(ManageReferencesDialogModel.ShowLibrariesKey) }
    public get Libraries(): ObservableCollection<LibraryChoice> { return this.get_property_value(ManageReferencesDialogModel.LibrariesKey) }
    public get EmptyLibrariesLabel(): string { return this.get_property_value(ManageReferencesDialogModel.EmptyLibrariesLabelKey) }
    public get CanConfirm(): boolean { return this.get_property_value(ManageReferencesDialogModel.CanConfirmKey) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(ManageReferencesDialogModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(ManageReferencesDialogModel.CancelCommandKey) }

    // The edited bindings: the selected meta-model plus, for a libraries-bearing
    // project, the checked libraries. A library project omits `libraries` entirely
    // so its manifest keeps its original shape.
    public get Result(): BaseBindings
    {
        const metaModel = this.SelectedMetaModel?.Ref
        if (!this.offersLibraries) return { metaModel }
        return { metaModel, libraries: this.Libraries.ToArray().filter((l) => l.IsSelected).map((l) => l.Ref) }
    }

    private recompute(): void
    {
        this.set_property_value(ManageReferencesDialogModel.CanConfirmKey, this.SelectedMetaModel !== undefined)
    }

    private static key(ref: BaseRef): string { return `${ref.id}@${ref.version}` }

    private static sameRef(a: BaseRef, b: BaseRef): boolean { return a.id === b.id && a.version === b.version }

    // First-wins dedupe by id@version, preserving order.
    private static dedupe(refs: readonly BaseRef[]): BaseRef[]
    {
        const seen = new Set<string>()
        const out: BaseRef[] = []
        for (const ref of refs)
        {
            const k = ManageReferencesDialogModel.key(ref)
            if (seen.has(k)) continue
            seen.add(k)
            out.push(ref)
        }
        return out
    }
}
