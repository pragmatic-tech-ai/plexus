import { MuralBase, ObservableCollection, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import type { SkillInputFormVm } from './skill-input-form.js'
import type { SkillInputVm } from './skill-input.js'

// Modal-dialog host for a skill input form. DialogService.Content requires a
// MuralBase, so this thin wrapper adapts the Observable SkillInputFormVm (which
// stays presentation-agnostic + reusable by the inline host). It proxies the
// form's members so the modal template (DataType = SkillInputDialogVm) binds them
// directly ($Inputs / $ConfirmCommand / $CancelCommand) — no nested paths. The Run
// button auto-disables via ConfirmCommand.CanExecute (gated on form validity).
export class SkillInputDialogVm extends MuralBase
{
    private readonly _form: SkillInputFormVm
    private readonly _title: string
    constructor(form: SkillInputFormVm, title: string) { super(); this._form = form; this._title = title }
    public get Title(): string { return this._title }
    public get Inputs(): ObservableCollection<SkillInputVm> { return this._form.Inputs }
    public get ConfirmCommand(): ICommand { return this._form.ConfirmCommand }
    public get CancelCommand(): ICommand { return this._form.CancelCommand }
}
