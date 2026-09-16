import {
    MetaData, MuralBase, ObservableCollection, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'

// One selectable candidate row. A MuralBase so the .mu template binds $Label / $Command.
export class ChooserRow extends MuralBase
{
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(ChooserRow, 'Label', '', MetaData.None)
    public static readonly CommandKey = MuralBase.RegisterProperty<ICommand | undefined>(ChooserRow, 'Command', undefined, MetaData.None)

    public constructor(label: string, command: ICommand)
    {
        super()
        this.set_property_value(ChooserRow.LabelKey, label)
        this.set_property_value(ChooserRow.CommandKey, command)
    }

    public get Label(): string { return this.get_property_value(ChooserRow.LabelKey) }
    public get Command(): ICommand | undefined { return this.get_property_value(ChooserRow.CommandKey) }
}

// App-scoped popup for the multi-candidate drop case: Show() lists the candidates
// and invokes onPick with the chosen one (click-away leaves it unchosen). The
// .mu chooser.resources popup binds $IsOpen / $Rows against this service.
export class DropCandidateChooserService extends ServiceBase
{
    public static readonly Key = new ServiceKey<DropCandidateChooserService>('DropCandidateChooserService')

    private _isOpen = false
    private readonly _rows = new ObservableCollection<ChooserRow>()

    public constructor(provider: IServiceProvider)
    {
        super(provider)
    }

    public get IsOpen(): boolean { return this._isOpen }
    private setIsOpen(v: boolean): void { const o = this._isOpen; if (o === v) return; this._isOpen = v; this.RaisePropertyChanged('IsOpen', o, v) }
    public get Rows(): ObservableCollection<ChooserRow> { return this._rows }

    // Generic over any candidate carrying a `label` — term-drop actions AND
    // connector-authoring actions both flow through the same popup.
    public Show<T extends { label: string }>(candidates: readonly T[], onPick: (a: T) => void): void
    {
        const rows = this.Rows
        rows.Clear()
        for (const action of candidates) {
            const row = new ChooserRow(action.label, new RelayCommand(() => { this.close(); onPick(action) }))
            rows.Add(row)
        }
        this.setIsOpen(true)
    }

    private close(): void
    {
        this.setIsOpen(false)
        this.Rows.Clear()
    }
}
