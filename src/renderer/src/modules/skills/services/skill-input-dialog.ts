import { MuralBase } from '@pragmatic-tech-ai/mural/runtime'
import type { SkillInputFormVm } from './skill-input-form.js'

// Modal-dialog host for a skill input form. DialogService.Content requires a
// MuralBase, so this thin wrapper adapts the Observable SkillInputFormVm (which
// stays presentation-agnostic + reusable by the inline host). The modal template
// (DataType = SkillInputDialogVm) binds $Form.Inputs / $Form.ConfirmCommand / etc.
export class SkillInputDialogVm extends MuralBase {
    private readonly _form: SkillInputFormVm
    private readonly _title: string
    constructor(form: SkillInputFormVm, title: string) { super(); this._form = form; this._title = title }
    public get Form(): SkillInputFormVm { return this._form }
    public get Title(): string { return this._title }
}
