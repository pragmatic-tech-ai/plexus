import { Observable, ObservableCollection, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    InputKind, BindingSource, OutputKind, ProjectType,
    type SkillInput, type SkillBinding, type SkillOutput,
} from '../../../../../shared/skill-api.js'
import { XPlexuses, type XPlexus } from './skill-file-codec.js'

// One editable input row. Comma-joined OptionsText keeps the Enum options in a
// single TextBox for v1; DefaultText holds the default as text (SkillInput.default
// accepts a string). Each setter raises INPC and calls back so the session
// re-serializes + re-validates.
export class SkillInputRowVm extends Observable
{
    private _key: string; private _label: string; private _type: InputKind
    private _optionsText: string; private _required: boolean; private _defaultText: string
    private readonly onChange: () => void
    private readonly _remove: RelayCommand

    constructor(seed: SkillInput, onChange: () => void, onRemove: (r: SkillInputRowVm) => void)
    {
        super()
        this._key = seed.key; this._label = seed.label; this._type = seed.type
        this._optionsText = (seed.options ?? []).join(', '); this._required = seed.required === true
        this._defaultText = seed.default === undefined ? '' : String(seed.default)
        this.onChange = onChange
        this._remove = new RelayCommand(() => onRemove(this))
    }

    get Kinds(): InputKind[] { return Object.values(InputKind) }
    get Key(): string { return this._key }
    set Key(v: string) { if (v === this._key) return; this._key = v; this.changed('Key') }
    get Label(): string { return this._label }
    set Label(v: string) { if (v === this._label) return; this._label = v; this.changed('Label') }
    get Type(): InputKind { return this._type }
    set Type(v: InputKind) { if (v === this._type) return; this._type = v; this.changed('Type') }
    get OptionsText(): string { return this._optionsText }
    set OptionsText(v: string) { if (v === this._optionsText) return; this._optionsText = v; this.changed('OptionsText') }
    get Required(): boolean { return this._required }
    set Required(v: boolean) { if (v === this._required) return; this._required = v; this.changed('Required') }
    get DefaultText(): string { return this._defaultText }
    set DefaultText(v: string) { if (v === this._defaultText) return; this._defaultText = v; this.changed('DefaultText') }
    get RemoveCommand(): ICommand { return this._remove }

    toInput(): SkillInput
    {
        const options = this._optionsText.split(',').map(s => s.trim()).filter(s => s !== '')
        return { key: this._key.trim(), label: this._label.trim(), type: this._type,
            options, required: this._required, default: this._defaultText === '' ? undefined : this._defaultText }
    }

    private changed(name: string): void { this.RaisePropertyChanged(name, undefined, undefined); this.onChange() }
}

// One editable binding row.
export class SkillBindingRowVm extends Observable
{
    private _source: BindingSource; private _as: string
    private readonly onChange: () => void
    private readonly _remove: RelayCommand

    constructor(seed: SkillBinding, onChange: () => void, onRemove: (r: SkillBindingRowVm) => void)
    {
        super()
        this._source = seed.source; this._as = seed.as ?? ''
        this.onChange = onChange
        this._remove = new RelayCommand(() => onRemove(this))
    }

    get Sources(): BindingSource[] { return Object.values(BindingSource) }
    get Source(): BindingSource { return this._source }
    set Source(v: BindingSource) { if (v === this._source) return; this._source = v; this.changed('Source') }
    get As(): string { return this._as }
    set As(v: string) { if (v === this._as) return; this._as = v; this.changed('As') }
    get RemoveCommand(): ICommand { return this._remove }

    toBinding(): SkillBinding { return { source: this._source, as: this._as.trim() === '' ? undefined : this._as.trim() } }

    private changed(name: string): void { this.RaisePropertyChanged(name, undefined, undefined); this.onChange() }
}

// One editable output row.
export class SkillOutputRowVm extends Observable
{
    private _kind: OutputKind; private _target: string
    private readonly onChange: () => void
    private readonly _remove: RelayCommand

    constructor(seed: SkillOutput, onChange: () => void, onRemove: (r: SkillOutputRowVm) => void)
    {
        super()
        this._kind = seed.kind; this._target = seed.target ?? ''
        this.onChange = onChange
        this._remove = new RelayCommand(() => onRemove(this))
    }

    get Kinds(): OutputKind[] { return Object.values(OutputKind) }
    get Kind(): OutputKind { return this._kind }
    set Kind(v: OutputKind) { if (v === this._kind) return; this._kind = v; this.changed('Kind') }
    get Target(): string { return this._target }
    set Target(v: string) { if (v === this._target) return; this._target = v; this.changed('Target') }
    get RemoveCommand(): ICommand { return this._remove }

    toOutput(): SkillOutput { return { kind: this._kind, target: this._target.trim() === '' ? undefined : this._target.trim() } }

    private changed(name: string): void { this.RaisePropertyChanged(name, undefined, undefined); this.onChange() }
}

// Structured editor over one x-plexus block. Scalars edit directly; facet lists
// (tags / allowedTools / requiresProjectType) are comma-joined text for v1;
// inputs/bindings/outputs are add/removeable row collections. Every edit calls
// onChange so the owning session re-serializes the shared buffer + re-validates.
// Read-only (packaged scope) makes every setter and Add command a no-op.
export class SkillFrontmatterFormVm extends Observable
{
    public readonly Inputs = new ObservableCollection<SkillInputRowVm>()
    public readonly Bindings = new ObservableCollection<SkillBindingRowVm>()
    public readonly Outputs = new ObservableCollection<SkillOutputRowVm>()

    private readonly _readOnly: boolean
    private readonly onChange: () => void
    private readonly _version: number | undefined
    private readonly _unknownVersion: boolean

    private _title: string; private _category: string; private _icon: string; private _model: string
    private _tagsText: string; private _allowedToolsText: string; private _requiresText: string
    private _deprecationNote: string; private _deprecationReplacedBy: string

    private readonly _addInput: RelayCommand
    private readonly _addBinding: RelayCommand
    private readonly _addOutput: RelayCommand

    constructor(ext: XPlexus, readOnly: boolean, onChange: () => void)
    {
        super()
        this._readOnly = readOnly
        this.onChange = onChange
        this._version = ext.version
        this._unknownVersion = ext.unknownVersion === true
        this._title = ext.title ?? ''; this._category = ext.category ?? ''
        this._icon = ext.icon ?? ''; this._model = ext.model ?? ''
        this._tagsText = ext.tags.join(', '); this._allowedToolsText = ext.allowedTools.join(', ')
        this._requiresText = ext.requiresProjectType.join(', ')
        this._deprecationNote = ext.deprecation?.note ?? ''
        this._deprecationReplacedBy = ext.deprecation?.replacedBy ?? ''
        for (const i of ext.inputs) this.Inputs.Add(this.makeInputRow(i))
        for (const b of ext.bindings) this.Bindings.Add(this.makeBindingRow(b))
        for (const o of ext.outputs) this.Outputs.Add(this.makeOutputRow(o))
        const gate = (): boolean => !this._readOnly
        this._addInput = new RelayCommand(() => this.addInput(), gate)
        this._addBinding = new RelayCommand(() => this.addBinding(), gate)
        this._addOutput = new RelayCommand(() => this.addOutput(), gate)
    }

    get IsReadOnly(): boolean { return this._readOnly }
    // Inverse of IsReadOnly, for binding control IsEnabled in the template.
    get IsEditable(): boolean { return !this._readOnly }
    // A block authored with a schema this Plexus doesn't understand — shown but not edited.
    get IsUnknownVersion(): boolean { return this._unknownVersion }

    get Title(): string { return this._title }
    set Title(v: string) { this.setScalar('Title', v, () => { this._title = v }, this._title) }
    get Category(): string { return this._category }
    set Category(v: string) { this.setScalar('Category', v, () => { this._category = v }, this._category) }
    get Icon(): string { return this._icon }
    set Icon(v: string) { this.setScalar('Icon', v, () => { this._icon = v }, this._icon) }
    get Model(): string { return this._model }
    set Model(v: string) { this.setScalar('Model', v, () => { this._model = v }, this._model) }
    get TagsText(): string { return this._tagsText }
    set TagsText(v: string) { this.setScalar('TagsText', v, () => { this._tagsText = v }, this._tagsText) }
    get AllowedToolsText(): string { return this._allowedToolsText }
    set AllowedToolsText(v: string) { this.setScalar('AllowedToolsText', v, () => { this._allowedToolsText = v }, this._allowedToolsText) }
    get RequiresProjectTypeText(): string { return this._requiresText }
    set RequiresProjectTypeText(v: string) { this.setScalar('RequiresProjectTypeText', v, () => { this._requiresText = v }, this._requiresText) }
    get DeprecationNote(): string { return this._deprecationNote }
    set DeprecationNote(v: string) { this.setScalar('DeprecationNote', v, () => { this._deprecationNote = v }, this._deprecationNote) }
    get DeprecationReplacedBy(): string { return this._deprecationReplacedBy }
    set DeprecationReplacedBy(v: string) { this.setScalar('DeprecationReplacedBy', v, () => { this._deprecationReplacedBy = v }, this._deprecationReplacedBy) }

    get AddInputCommand(): ICommand { return this._addInput }
    get AddBindingCommand(): ICommand { return this._addBinding }
    get AddOutputCommand(): ICommand { return this._addOutput }

    removeInput(row: SkillInputRowVm): void { if (this._readOnly) return; this.Inputs.Remove(row); this.onChange() }
    removeBinding(row: SkillBindingRowVm): void { if (this._readOnly) return; this.Bindings.Remove(row); this.onChange() }
    removeOutput(row: SkillOutputRowVm): void { if (this._readOnly) return; this.Outputs.Remove(row); this.onChange() }

    // Collect the current form state back into a structured x-plexus object. version
    // defaults to 1 for a known/blank block; an unknown version is preserved as-is.
    toExtension(): XPlexus
    {
        const ext = XPlexuses.empty()
        ext.version = this._unknownVersion ? this._version : 1
        ext.unknownVersion = this._unknownVersion
        ext.title = this.trimmed(this._title)
        ext.category = this.trimmed(this._category)
        ext.icon = this.trimmed(this._icon)
        ext.model = this.trimmed(this._model)
        ext.tags = this.csv(this._tagsText)
        ext.allowedTools = this.csv(this._allowedToolsText)
        ext.requiresProjectType = this.csv(this._requiresText)
            .map(t => this.projectType(t)).filter((t): t is ProjectType => t !== undefined)
        const note = this.trimmed(this._deprecationNote); const rep = this.trimmed(this._deprecationReplacedBy)
        ext.deprecation = (note === undefined && rep === undefined) ? undefined : { note, replacedBy: rep }
        for (let i = 0; i < this.Inputs.Count; i++) { const r = this.Inputs.Get(i); if (r !== undefined) ext.inputs.push(r.toInput()) }
        for (let i = 0; i < this.Bindings.Count; i++) { const r = this.Bindings.Get(i); if (r !== undefined) ext.bindings.push(r.toBinding()) }
        for (let i = 0; i < this.Outputs.Count; i++) { const r = this.Outputs.Get(i); if (r !== undefined) ext.outputs.push(r.toOutput()) }
        return ext
    }

    private setScalar(name: string, v: string, assign: () => void, current: string): void
    {
        if (this._readOnly || v === current) return
        assign()
        this.RaisePropertyChanged(name, undefined, v)
        this.onChange()
    }

    private addInput(): void { if (this._readOnly) return; this.Inputs.Add(this.makeInputRow({ key: '', label: '', type: InputKind.Text })); this.onChange() }
    private addBinding(): void { if (this._readOnly) return; this.Bindings.Add(this.makeBindingRow({ source: BindingSource.CurrentProject })); this.onChange() }
    private addOutput(): void { if (this._readOnly) return; this.Outputs.Add(this.makeOutputRow({ kind: OutputKind.Conversation })); this.onChange() }

    private makeInputRow(seed: SkillInput): SkillInputRowVm { return new SkillInputRowVm(seed, this.onChange, r => this.removeInput(r)) }
    private makeBindingRow(seed: SkillBinding): SkillBindingRowVm { return new SkillBindingRowVm(seed, this.onChange, r => this.removeBinding(r)) }
    private makeOutputRow(seed: SkillOutput): SkillOutputRowVm { return new SkillOutputRowVm(seed, this.onChange, r => this.removeOutput(r)) }

    private trimmed(v: string): string | undefined { const t = v.trim(); return t === '' ? undefined : t }
    private csv(v: string): string[] { return v.split(',').map(s => s.trim()).filter(s => s !== '') }
    private projectType(token: string): ProjectType | undefined
    {
        for (const key of Object.keys(ProjectType))
        {
            const value = (ProjectType as Record<string, string>)[key]
            if (key === token || value === token) return value as ProjectType
        }
        return undefined
    }
}
