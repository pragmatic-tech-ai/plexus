import {
    MetaData,
    MuralBase,
    ObservableCollection,
    RelayCommand,
    type ICommand,
} from '@pragmatic-tech-ai/mural/runtime'

import type { BaseBindings, BaseRef } from './base-binding.js'
import { ReferenceNode } from './reference-node.js'

// The "Manage References" dialog's view-model — the consolidated VS-style
// references editor for a consumer TODL project (architecture / library). It
// shows the project's current base bindings against the catalog of everything it
// COULD reference (published packages ∪ open workspace producers) in one
// "References" TreeView, and lets the user add/remove without leaving the dialog:
//   * Meta-models — a checklist where the current bindings start CHECKED and the
//     addable ones start unchecked; a project may bind any number, and a workspace
//     producer can be checked before it is published (resolution is local-first).
//   * Libraries (architecture only) — the same checklist shape. Unchecking removes,
//     checking adds; the result is simply the checked set.
//
// It renders through the shared ReferenceNode tree (DataTemplate reused from the
// New-Project dialog). Like every dialog VM here it is a MuralBase (not the
// lightweight Observable): it genuinely leans on the dependency-property system —
// per-row IsSelected bindings and a CanConfirm that recomputes on selection change.
export class ManageReferencesDialogModel extends MuralBase
{
    private static readonly MetaModelsGroupLabel = 'Meta-models'
    private static readonly LibrariesGroupLabel = 'Libraries'

    static readonly RootsKey = MuralBase.RegisterProperty<ObservableCollection<ReferenceNode>>(
        ManageReferencesDialogModel, 'Roots', undefined as unknown as ObservableCollection<ReferenceNode>, MetaData.None)
    static readonly ShowLibrariesKey = MuralBase.RegisterProperty<boolean>(
        ManageReferencesDialogModel, 'ShowLibraries', false, MetaData.None)
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
    private readonly metaGroup: ReferenceNode
    private readonly libGroup?: ReferenceNode

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
        this.set_property_value(ManageReferencesDialogModel.ShowLibrariesKey, offersLibraries)

        const roots = new ObservableCollection<ReferenceNode>()

        // Meta-models: the current bindings (checked) followed by the addable ones
        // (unchecked), deduped by id@version so a stale current ref stays visible +
        // checked rather than silently vanishing.
        this.metaGroup = this.buildGroup(
            ManageReferencesDialogModel.MetaModelsGroupLabel, current.metaModels ?? [], availableMetaModels)
        roots.Add(this.metaGroup)

        // Libraries (architecture only): same checklist shape.
        if (offersLibraries)
        {
            this.libGroup = this.buildGroup(
                ManageReferencesDialogModel.LibrariesGroupLabel, current.libraries ?? [], availableLibraries)
            roots.Add(this.libGroup)
            this.set_property_value(ManageReferencesDialogModel.EmptyLibrariesLabelKey,
                this.libGroup.Children.Count === 0 ? 'No libraries are published or open to reference.' : '')
        }
        this.set_property_value(ManageReferencesDialogModel.RootsKey, roots)

        this.set_property_value(ManageReferencesDialogModel.ConfirmCommandKey,
            new RelayCommand(() => { if (this.CanConfirm) this.close(this.Result) }))
        this.set_property_value(ManageReferencesDialogModel.CancelCommandKey,
            new RelayCommand(() => this.close(undefined)))

        this.recompute()
    }

    public get Roots(): ObservableCollection<ReferenceNode> { return this.get_property_value(ManageReferencesDialogModel.RootsKey) }
    public get ShowLibraries(): boolean { return this.get_property_value(ManageReferencesDialogModel.ShowLibrariesKey) }
    public get EmptyLibrariesLabel(): string { return this.get_property_value(ManageReferencesDialogModel.EmptyLibrariesLabelKey) }
    public get CanConfirm(): boolean { return this.get_property_value(ManageReferencesDialogModel.CanConfirmKey) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(ManageReferencesDialogModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(ManageReferencesDialogModel.CancelCommandKey) }

    // The edited bindings: the checked meta-models plus, for a libraries-bearing
    // project, the checked libraries. A library project omits `libraries` entirely
    // so its manifest keeps its original shape.
    public get Result(): BaseBindings
    {
        const metaModels = [...this.metaGroup.SelectedRefs]
        if (!this.offersLibraries) return { metaModels }
        return { metaModels, libraries: [...(this.libGroup?.SelectedRefs ?? [])] }
    }

    // A group whose current refs come first (checked) then the addable ones
    // (unchecked), deduped by id@version. Each leaf's check recomputes CanConfirm.
    private buildGroup(label: string, current: readonly BaseRef[], available: readonly BaseRef[]): ReferenceNode
    {
        const checked = new Set(current.map((r) => ManageReferencesDialogModel.key(r)))
        const leaves = ManageReferencesDialogModel.dedupe([...current, ...available])
            .map((ref) => ReferenceNode.leaf(ref, checked.has(ManageReferencesDialogModel.key(ref))))
        for (const leaf of leaves)
            leaf.PropertyChanged(ReferenceNode.IsSelectedKey).subscribe(() => this.recompute())
        return ReferenceNode.group(label, leaves)
    }

    private recompute(): void
    {
        // A consumer project must bind at least one meta-model.
        this.set_property_value(ManageReferencesDialogModel.CanConfirmKey, this.metaGroup.SelectedRefs.length > 0)
    }

    private static key(ref: BaseRef): string { return `${ref.id}@${ref.version}` }

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
