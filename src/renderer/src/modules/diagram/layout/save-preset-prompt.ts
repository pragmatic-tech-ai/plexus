import {
    MetaData, MuralBase, ObservableCollection, RelayCommand, type ICommand,
} from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'

import { PresetScope, ScopeOption } from './preset-scope.js'

// The user's save choice: a preset name plus the scope to save it to.
export interface SavePresetChoice
{
    name:  string
    scope: PresetScope
}

// Content view-model for the "save layout preset" dialog. Rendered by
// DataTemplate[SavePresetPromptModel] (a name field, a "Save to" scope picker,
// and Cancel / Save). The host shows it through DialogService and awaits the
// SavePresetChoice: ConfirmCommand closes with { name, scope }, CancelCommand
// closes with undefined (as does a scrim/Escape dismiss). Confirm is blocked
// while the name is blank (CanConfirm drives the button's IsEnabled).
//
// The offered scopes are passed in (Global always; Project only when a project
// is active; Diagram only when a diagram is active), so the picker never lists a
// scope the caller can't persist to.
export class SavePresetPromptModel extends MuralBase
{
    public static readonly NameKey = MuralBase.RegisterProperty<string>(SavePresetPromptModel, 'Name', '', MetaData.None)
    public static readonly CanConfirmKey = MuralBase.RegisterProperty<boolean>(SavePresetPromptModel, 'CanConfirm', false, MetaData.None)
    public static readonly ScopesKey = MuralBase.RegisterProperty<ObservableCollection<ScopeOption>>(
        SavePresetPromptModel, 'Scopes', undefined as unknown as ObservableCollection<ScopeOption>, MetaData.None)
    public static readonly SelectedScopeKey = MuralBase.RegisterProperty<ScopeOption | undefined>(
        SavePresetPromptModel, 'SelectedScope', undefined, MetaData.None)
    public static readonly ConfirmCommandKey = MuralBase.RegisterProperty<ICommand>(
        SavePresetPromptModel, 'ConfirmCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly CancelCommandKey = MuralBase.RegisterProperty<ICommand>(
        SavePresetPromptModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    public constructor(
        initial: string,
        scopes: readonly PresetScope[],
        initialScope: PresetScope,
        private readonly close: (choice: SavePresetChoice | undefined) => void,
    )
    {
        super()
        this.set_property_value(SavePresetPromptModel.NameKey, initial)

        const options = new ObservableCollection<ScopeOption>()
        for (const s of scopes) options.Add(new ScopeOption(s))
        this.set_property_value(SavePresetPromptModel.ScopesKey, options)
        const selected = options.ToArray().find((o) => o.Scope === initialScope) ?? options.ToArray()[0]
        this.set_property_value(SavePresetPromptModel.SelectedScopeKey, selected)

        this.set_property_value(SavePresetPromptModel.ConfirmCommandKey, new RelayCommand(() => this.confirm()))
        this.set_property_value(SavePresetPromptModel.CancelCommandKey, new RelayCommand(() => this.close(undefined)))
        this.PropertyChanged(SavePresetPromptModel.NameKey).subscribe(() => this.recompute())
        this.recompute()
    }

    public get Name(): string { return this.get_property_value(SavePresetPromptModel.NameKey) }
    public set Name(v: string) { this.set_property_value(SavePresetPromptModel.NameKey, v) }
    public get CanConfirm(): boolean { return this.get_property_value(SavePresetPromptModel.CanConfirmKey) }
    public get Scopes(): ObservableCollection<ScopeOption> { return this.get_property_value(SavePresetPromptModel.ScopesKey) }
    public get SelectedScope(): ScopeOption | undefined { return this.get_property_value(SavePresetPromptModel.SelectedScopeKey) }
    public set SelectedScope(v: ScopeOption | undefined) { this.set_property_value(SavePresetPromptModel.SelectedScopeKey, v) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(SavePresetPromptModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(SavePresetPromptModel.CancelCommandKey) }

    private recompute(): void
    {
        this.set_property_value(SavePresetPromptModel.CanConfirmKey, this.Name.trim().length > 0)
    }

    private confirm(): void
    {
        const name = this.Name.trim()
        if (name.length === 0) return
        const scope = this.SelectedScope?.Scope ?? PresetScope.Global
        this.close({ name, scope })
    }
}

// Open the save-preset prompt as a modal dialog and resolve the chosen name +
// scope (or undefined on cancel/dismiss). `initial` pre-fills the name field
// (the currently selected preset, for a quick overwrite); `scopes` are the
// offered scopes and `initialScope` is the pre-selected one.
export function promptSavePreset(
    dialogs: DialogService,
    initial: string,
    scopes: readonly PresetScope[],
    initialScope: PresetScope,
): Promise<SavePresetChoice | undefined>
{
    const model = new SavePresetPromptModel(initial, scopes, initialScope, (choice) => dialogs.Close(choice))
    return dialogs.Show<SavePresetChoice>({ Title: 'Save layout preset', Content: model, Width: 360 })
}
