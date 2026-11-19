import { MetaData, MuralBase } from '@pragmatic-tech-ai/mural/runtime'

// One editable parameter of a selected layout strategy. Two concrete VMs —
// number and boolean — each with its own DataType-matched template (SpinEdit /
// Switch). Editing the value calls back into the owning LayoutStageVM, which
// re-emits the stage's { className, params } into the pipeline configuration.
//
// Separate classes (rather than one VM with a type flag) so the .mu can pick
// the editor by DataType instead of a trigger.

export class NumberParamVM extends MuralBase
{
    static readonly LabelKey = MuralBase.RegisterProperty<string>(NumberParamVM, 'Label', '', MetaData.None)
    static readonly ValueKey = MuralBase.RegisterProperty<number>(NumberParamVM, 'Value', 0, MetaData.None)

    constructor(public readonly Key: string, label: string, def: number, private readonly onChange: (key: string, value: number) => void)
    {
        super()
        this.set_property_value(NumberParamVM.LabelKey, label)
        this.set_property_value(NumberParamVM.ValueKey, def)
        this.PropertyChanged(NumberParamVM.ValueKey).subscribe(() => this.onChange(this.Key, this.Value))
    }

    public get Label(): string { return this.get_property_value(NumberParamVM.LabelKey) }
    public get Value(): number { return this.get_property_value(NumberParamVM.ValueKey) }
    public set Value(v: number) { this.set_property_value(NumberParamVM.ValueKey, v) }
}

export class BoolParamVM extends MuralBase
{
    static readonly LabelKey = MuralBase.RegisterProperty<string>(BoolParamVM, 'Label', '', MetaData.None)
    static readonly ValueKey = MuralBase.RegisterProperty<boolean>(BoolParamVM, 'Value', false, MetaData.None)

    constructor(public readonly Key: string, label: string, def: boolean, private readonly onChange: (key: string, value: boolean) => void)
    {
        super()
        this.set_property_value(BoolParamVM.LabelKey, label)
        this.set_property_value(BoolParamVM.ValueKey, def)
        this.PropertyChanged(BoolParamVM.ValueKey).subscribe(() => this.onChange(this.Key, this.Value))
    }

    public get Label(): string { return this.get_property_value(BoolParamVM.LabelKey) }
    public get Value(): boolean { return this.get_property_value(BoolParamVM.ValueKey) }
    public set Value(v: boolean) { this.set_property_value(BoolParamVM.ValueKey, v) }
}
