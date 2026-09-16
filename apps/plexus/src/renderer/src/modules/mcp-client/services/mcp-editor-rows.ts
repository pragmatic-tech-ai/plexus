import { Observable, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { ValueSourceKind, type ValueSource } from '../../../../../shared/mcp-client-api.js'

// One env-var / header entry in the editor: a name plus a value that is either a
// literal or a reference to an OS env var (so secrets need not sit in the JSON).
export class KeyValueRow extends Observable
{
    public readonly SourceKinds: readonly ValueSourceKind[] = [ValueSourceKind.Literal, ValueSourceKind.Env]
    public readonly RemoveCommand: ICommand

    private _name = ''
    private _sourceKind: ValueSourceKind = ValueSourceKind.Literal
    private _value = ''

    constructor(onRemove: (row: KeyValueRow) => void, name = '', sourceKind: ValueSourceKind = ValueSourceKind.Literal, value = '')
    {
        super()
        this._name = name
        this._sourceKind = sourceKind
        this._value = value
        this.RemoveCommand = new RelayCommand(() => onRemove(this))
    }

    public get Name(): string { return this._name }
    public set Name(v: string) { const o = this._name; if (o === v) return; this._name = v; this.RaisePropertyChanged('Name', o, v) }

    public get SourceKind(): ValueSourceKind { return this._sourceKind }
    public set SourceKind(v: ValueSourceKind)
    {
        const o = this._sourceKind; if (o === v) return
        this._sourceKind = v; this.RaisePropertyChanged('SourceKind', o, v)
        this.RaisePropertyChanged('IsEnv', !this.IsEnv, this.IsEnv)
    }
    public get IsEnv(): boolean { return this._sourceKind === ValueSourceKind.Env }

    public get Value(): string { return this._value }
    public set Value(v: string) { const o = this._value; if (o === v) return; this._value = v; this.RaisePropertyChanged('Value', o, v) }

    public toSource(): ValueSource { return { kind: this._sourceKind, value: this._value } }

    public static from(onRemove: (row: KeyValueRow) => void, name: string, source: ValueSource): KeyValueRow
    {
        return new KeyValueRow(onRemove, name, source.kind, source.value)
    }
}

// One discovered tool in the per-tool gating checklist.
export class ToolToggle extends Observable
{
    private _checked: boolean

    constructor(public readonly Name: string, checked = false)
    {
        super()
        this._checked = checked
    }

    public get Checked(): boolean { return this._checked }
    public set Checked(v: boolean) { const o = this._checked; if (o === v) return; this._checked = v; this.RaisePropertyChanged('Checked', o, v) }
}
