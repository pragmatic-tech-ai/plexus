import { MuralBase, Observable, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { SkillScope } from '../../../../../shared/skill-api.js'
import { SkillTemplateKind, type NewSkillRequest } from './skill-scaffolder.js'

// One open project offered as a scaffold target in the New Skill dialog. `Label`
// (the folder name) drives the ComboBox display via toString, matching the
// MetaModelChoice/LibraryChoice convention used elsewhere.
export class ProjectChoice extends Observable
{
    private readonly _label: string
    private readonly _path: string
    constructor(label: string, path: string) { super(); this._label = label; this._path = path }
    get Label(): string { return this._label }
    get Path(): string { return this._path }
    toString(): string { return this._label }
}

// Reusable, presentation-agnostic new-skill form. The host supplies onDone, which
// closes the dialog with the collected request (or undefined on cancel). Name is
// required — Create is gated on it. Scope/Template are chosen from the enum lists.
// Projects (the open workspace) is the target picker, relevant only for Project scope.
export class SkillNewFormVm extends Observable
{
    private _name = ''
    private _description = ''
    private _scope: SkillScope
    private _template: SkillTemplateKind = SkillTemplateKind.Superset
    private readonly _projects: ProjectChoice[]
    private _selectedProject?: ProjectChoice
    private readonly onDone: (result: NewSkillRequest | undefined) => void
    private readonly _confirm: RelayCommand
    private readonly _cancel: RelayCommand

    constructor(defaultScope: SkillScope, projects: ProjectChoice[], onDone: (result: NewSkillRequest | undefined) => void)
    {
        super()
        this._scope = defaultScope
        this._projects = projects
        this._selectedProject = projects[0]
        this.onDone = onDone
        this._confirm = new RelayCommand(() => this.confirm(), () => this._name.trim() !== '')
        this._cancel = new RelayCommand(() => this.onDone(undefined))
    }

    // Only the two writable scopes are offered; packaged skills are authored via
    // their owning package's publish.
    get Scopes(): SkillScope[] { return [SkillScope.Project, SkillScope.Global] }
    get Templates(): SkillTemplateKind[] { return [SkillTemplateKind.Blank, SkillTemplateKind.Superset] }
    get Projects(): readonly ProjectChoice[] { return this._projects }

    // The project picker is meaningful only when scope = Project and more than one
    // project is open (a single project needs no choice).
    get ShowProjectPicker(): boolean { return this._scope === SkillScope.Project && this._projects.length > 1 }

    get Name(): string { return this._name }
    set Name(v: string) { if (v === this._name) return; this._name = v; this.RaisePropertyChanged('Name', undefined, v); this._confirm.RaiseCanExecuteChanged() }
    get Description(): string { return this._description }
    set Description(v: string) { if (v === this._description) return; this._description = v; this.RaisePropertyChanged('Description', undefined, v) }
    get Scope(): SkillScope { return this._scope }
    set Scope(v: SkillScope) { if (v === this._scope) return; this._scope = v; this.RaisePropertyChanged('Scope', undefined, v); this.RaisePropertyChanged('ShowProjectPicker', undefined, this.ShowProjectPicker) }
    get Template(): SkillTemplateKind { return this._template }
    set Template(v: SkillTemplateKind) { if (v === this._template) return; this._template = v; this.RaisePropertyChanged('Template', undefined, v) }
    get SelectedProject(): ProjectChoice | undefined { return this._selectedProject }
    set SelectedProject(v: ProjectChoice | undefined) { if (v === this._selectedProject) return; this._selectedProject = v; this.RaisePropertyChanged('SelectedProject', undefined, v) }

    get ConfirmCommand(): ICommand { return this._confirm }
    get CancelCommand(): ICommand { return this._cancel }

    private confirm(): void
    {
        if (this._name.trim() === '') return
        const projectDir = this._scope === SkillScope.Project ? this._selectedProject?.Path : undefined
        this.onDone({ name: this._name.trim(), description: this._description.trim(), scope: this._scope, template: this._template, projectDir })
    }
}

// MuralBase host for the new-skill form — DialogService.Content requires a
// MuralBase, so this thin wrapper adapts the reusable Observable form. The modal
// template (DataType = SkillNewDialogVm) binds $Form's fields and the commands.
export class SkillNewDialogVm extends MuralBase
{
    private readonly _form: SkillNewFormVm
    constructor(form: SkillNewFormVm) { super(); this._form = form }
    get Form(): SkillNewFormVm { return this._form }
    get ConfirmCommand(): ICommand { return this._form.ConfirmCommand }
    get CancelCommand(): ICommand { return this._form.CancelCommand }
}
