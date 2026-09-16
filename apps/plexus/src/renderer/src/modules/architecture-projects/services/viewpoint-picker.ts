import {
    MetaData, MuralBase, ObservableCollection, RelayCommand, type ICommand,
} from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'

// One selectable viewpoint row in the picker.
export class PickerRow extends MuralBase
{
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(PickerRow, 'Label', '', MetaData.None)
    public static readonly IsSelectedKey = MuralBase.RegisterProperty<boolean>(PickerRow, 'IsSelected', false, MetaData.None)

    public constructor(label: string, selected: boolean)
    {
        super()
        this.set_property_value(PickerRow.LabelKey, label)
        this.set_property_value(PickerRow.IsSelectedKey, selected)
    }

    public get Label(): string { return this.get_property_value(PickerRow.LabelKey) }
    public get IsSelected(): boolean { return this.get_property_value(PickerRow.IsSelectedKey) }
    public set IsSelected(v: boolean) { this.set_property_value(PickerRow.IsSelectedKey, v) }
}

// Content view-model for the viewpoint-picker dialog. Rendered by
// DataTemplate[ViewpointPickerModel] (a checkbox list + Cancel/Confirm). The
// host shows it through DialogService and awaits the chosen ids: ConfirmCommand
// closes with the checked labels, CancelCommand closes with `undefined` (as does
// a scrim/Escape dismiss). Confirm is blocked while nothing is checked (the ≥1
// constraint), surfaced as CanConfirm for the button's IsEnabled.
export class ViewpointPickerModel extends MuralBase
{
    public static readonly RowsKey = MuralBase.RegisterProperty<ObservableCollection<PickerRow>>(
        ViewpointPickerModel, 'Rows', undefined as unknown as ObservableCollection<PickerRow>, MetaData.None)
    public static readonly CanConfirmKey = MuralBase.RegisterProperty<boolean>(ViewpointPickerModel, 'CanConfirm', false, MetaData.None)
    public static readonly ConfirmCommandKey = MuralBase.RegisterProperty<ICommand>(
        ViewpointPickerModel, 'ConfirmCommand', undefined as unknown as ICommand, MetaData.None)
    public static readonly CancelCommandKey = MuralBase.RegisterProperty<ICommand>(
        ViewpointPickerModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    // `preselected` checks a subset (edit pre-selecting the current scope);
    // undefined → every row checked (creation defaults to all).
    public constructor(
        viewpoints: string[],
        preselected: ReadonlySet<string> | undefined,
        private readonly close: (ids: string[] | undefined) => void,
    )
    {
        super()
        const rows = new ObservableCollection<PickerRow>()
        for (const v of viewpoints)
        {
            const row = new PickerRow(v, preselected === undefined ? true : preselected.has(v))
            row.PropertyChanged(PickerRow.IsSelectedKey).subscribe(() => this.recompute())
            rows.Add(row)
        }
        this.set_property_value(ViewpointPickerModel.RowsKey, rows)
        this.set_property_value(ViewpointPickerModel.ConfirmCommandKey, new RelayCommand(() => this.confirm()))
        this.set_property_value(ViewpointPickerModel.CancelCommandKey, new RelayCommand(() => this.close(undefined)))
        this.recompute()
    }

    public get Rows(): ObservableCollection<PickerRow> { return this.get_property_value(ViewpointPickerModel.RowsKey) }
    public get CanConfirm(): boolean { return this.get_property_value(ViewpointPickerModel.CanConfirmKey) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(ViewpointPickerModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(ViewpointPickerModel.CancelCommandKey) }

    private recompute(): void
    {
        this.set_property_value(ViewpointPickerModel.CanConfirmKey, this.Rows.ToArray().some((r) => r.IsSelected))
    }

    private confirm(): void
    {
        if (!this.CanConfirm) return
        this.close(this.Rows.ToArray().filter((r) => r.IsSelected).map((r) => r.Label))
    }
}

// Open the viewpoint picker as a modal dialog and resolve the chosen ids (or
// undefined on cancel/dismiss). Returns undefined when no DialogService is
// available (headless) so callers degrade gracefully.
export function pickViewpoints(
    dialogs: DialogService,
    viewpoints: string[],
    preselected?: ReadonlySet<string>,
): Promise<string[] | undefined>
{
    const model = new ViewpointPickerModel(viewpoints, preselected, (ids) => dialogs.Close(ids))
    return dialogs.Show<string[]>({ Title: 'Diagram viewpoints', Content: model, Width: 360 })
}
