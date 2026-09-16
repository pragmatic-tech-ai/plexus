import { MetaData, MuralBase, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import type { CatalogStrategy, CatalogParam, LayoutStageSpec } from '@pragmatic-tech-ai/fresco'

import { NumberParamVM, BoolParamVM } from './layout-param-vm.js'

// The "use the framework default for this stage" choice — selecting it leaves
// the stage unset in the PipelineConfiguration (LayoutPipeline's own default
// strategy applies).
export const DEFAULT_OPTION = '(default)'

// One row of the layout-stage builder: a stage label, a ComboBox of the
// strategies available for it (by display name), and — below — the editable
// parameters of the currently selected strategy. Selecting a strategy or
// editing a parameter re-emits the stage's value ({ className, params }, or
// undefined for "(default)") into PipelineConfiguration.layout.
export class LayoutStageVM extends MuralBase
{
    static readonly LabelKey = MuralBase.RegisterProperty<string>(
        LayoutStageVM, 'Label', '', MetaData.None)
    static readonly OptionsKey = MuralBase.RegisterProperty<ObservableCollection<string>>(
        LayoutStageVM, 'Options', undefined as unknown as ObservableCollection<string>, MetaData.None)
    static readonly SelectedKey = MuralBase.RegisterProperty<string>(
        LayoutStageVM, 'Selected', DEFAULT_OPTION, MetaData.None)
    static readonly ParamsKey = MuralBase.RegisterProperty<ObservableCollection<MuralBase>>(
        LayoutStageVM, 'Params', undefined as unknown as ObservableCollection<MuralBase>, MetaData.None)
    // Whether this stage's ComboBox is interactive. Set false to disable a
    // stage made irrelevant by another stage's choice (e.g. the Port
    // Assigner when the Edge Router does native diagram routing).
    static readonly EnabledKey = MuralBase.RegisterProperty<boolean>(
        LayoutStageVM, 'Enabled', true, MetaData.None)

    private readonly byName = new Map<string, CatalogStrategy>()
    // className -> display name, the reverse of byName's key, so LoadSpec can
    // resolve a saved spec's className back to the ComboBox option.
    private readonly byClassName = new Map<string, string>()
    private selectedClassName: string | undefined
    private paramValues: Record<string, number | boolean> = {}

    // onChange receives the stage spec ({ className, params }), or undefined for
    // the "(default)" option.
    constructor(label: string, strategies: readonly CatalogStrategy[], private readonly onChange: (spec: LayoutStageSpec | undefined) => void)
    {
        super()
        this.set_property_value(LayoutStageVM.LabelKey, label)

        const opts = new ObservableCollection<string>()
        opts.Add(DEFAULT_OPTION)
        for (const s of strategies)
        {
            opts.Add(s.name)
            this.byName.set(s.name, s)
            this.byClassName.set(s.className, s.name)
        }
        this.set_property_value(LayoutStageVM.OptionsKey, opts)
        this.set_property_value(LayoutStageVM.ParamsKey, new ObservableCollection<MuralBase>())

        this.PropertyChanged(LayoutStageVM.SelectedKey).subscribe(() => this.onSelected())
    }

    public get Label(): string { return this.get_property_value(LayoutStageVM.LabelKey) }
    public get Options(): ObservableCollection<string> { return this.get_property_value(LayoutStageVM.OptionsKey) }
    public get Selected(): string { return this.get_property_value(LayoutStageVM.SelectedKey) }
    public set Selected(v: string) { this.set_property_value(LayoutStageVM.SelectedKey, v) }
    public get Params(): ObservableCollection<MuralBase> { return this.get_property_value(LayoutStageVM.ParamsKey) }
    public get Enabled(): boolean { return this.get_property_value(LayoutStageVM.EnabledKey) }
    public set Enabled(v: boolean) { this.set_property_value(LayoutStageVM.EnabledKey, v) }

    // Re-emit the current selection into the pipeline config. Used when an
    // external change (e.g. another stage being enabled) needs this stage's
    // value re-applied without the user re-touching the ComboBox.
    public Reapply(): void
    {
        this.onSelected()
    }

    // Drive this stage from a saved spec: undefined (or an unknown className)
    // selects "(default)"; otherwise select the matching strategy — which
    // rebuilds its params at defaults — then overwrite each param row's Value
    // from the spec (each write re-emits the full { className, params }).
    public LoadSpec(spec: LayoutStageSpec | undefined): void
    {
        const name = spec === undefined ? undefined : this.byClassName.get(spec.className)
        if (name === undefined)
        {
            this.Selected = DEFAULT_OPTION
            return
        }
        this.Selected = name   // rebuilds param rows at defaults + emits
        const params = spec!.params ?? {}
        for (const row of this.Params.ToArray())
        {
            const key = (row as NumberParamVM | BoolParamVM).Key
            if (!(key in params)) continue
            const v = params[key]
            if (row instanceof NumberParamVM && typeof v === 'number') row.Value = v
            else if (row instanceof BoolParamVM && typeof v === 'boolean') row.Value = v
        }
    }

    private onSelected(): void
    {
        const strat = this.byName.get(this.Selected)
        if (strat === undefined)   // "(default)"
        {
            this.selectedClassName = undefined
            this.paramValues = {}
            this.Params.Clear()
            this.onChange(undefined)
            return
        }
        this.selectedClassName = strat.className
        this.rebuildParams(strat.parameters ?? [])
        this.emit()
    }

    private rebuildParams(params: readonly CatalogParam[]): void
    {
        this.paramValues = {}
        const rows = this.Params
        rows.Clear()
        for (const p of params)
        {
            if (p.type === 'number')
            {
                const def = typeof p.default === 'number' ? p.default : 0
                this.paramValues[p.key] = def
                rows.Add(new NumberParamVM(p.key, p.key, def, (k, v) => this.onParam(k, v)))
            }
            else if (p.type === 'boolean')
            {
                const def = typeof p.default === 'boolean' ? p.default : false
                this.paramValues[p.key] = def
                rows.Add(new BoolParamVM(p.key, p.key, def, (k, v) => this.onParam(k, v)))
            }
            // enum/string params don't occur on layout strategies; skipped.
        }
    }

    private onParam(key: string, value: number | boolean): void
    {
        this.paramValues[key] = value
        this.emit()
    }

    private emit(): void
    {
        if (this.selectedClassName === undefined) return
        this.onChange({ className: this.selectedClassName, params: { ...this.paramValues } })
    }
}
