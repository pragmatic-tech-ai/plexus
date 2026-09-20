import { Observable } from '@pragmatic-tech-ai/mural/runtime'
import { InputKind, type SkillInput } from '../../../../../shared/skill-api.js'

// One collected input for a skill run (consumed by #3's runner form). Holds the
// declared shape plus a live Value + validity, raising INPC on Value/IsValid so a
// .mu form binds two-way.
export class SkillInputVm extends Observable
{
    private readonly input: SkillInput
    private _value: string | number | boolean

    constructor(input: SkillInput)
    {
        super()
        this.input = input
        this._value = input.default ?? (input.type === InputKind.Bool ? false : '')
    }

    get Key(): string { return this.input.key }
    get Label(): string { return this.input.label }
    get Type(): InputKind { return this.input.type }
    get Options(): readonly string[] { return this.input.options ?? [] }
    get Value(): string | number | boolean { return this._value }
    set Value(v: string | number | boolean)
    {
        const old = this._value
        if (old === v) return
        this._value = v
        this.RaisePropertyChanged('Value', old, v)
        this.RaisePropertyChanged('IsValid', !this.computeValid(old), this.IsValid)
    }
    get IsValid(): boolean { return this.computeValid(this._value) }

    // Control-selection flags for the form template (mutually exclusive).
    get IsBool(): boolean { return this.input.type === InputKind.Bool }
    get IsChoice(): boolean { return this.input.type === InputKind.Enum || this.input.type === InputKind.Selection }
    get IsPlain(): boolean { return !this.IsBool && !this.IsChoice }

    private computeValid(value: string | number | boolean): boolean
    {
        return this.input.required !== true || String(value).trim() !== ''
    }
}
