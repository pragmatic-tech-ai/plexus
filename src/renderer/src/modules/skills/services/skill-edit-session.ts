import { Observable } from '@pragmatic-tech-ai/mural/runtime'
import { SkillScope, type SkillProblem } from '../../../../../shared/skill-api.js'
import type { Skill } from './skill.js'
import { SkillFileCodec, type XPlexus } from './skill-file-codec.js'
import type { SkillValidator } from './skill-validator.js'
import { SkillFrontmatterFormVm } from './skill-frontmatter-form.js'

// The editable buffer a session writes through — structurally the open CodeDocument
// (Content is the whole SKILL.md the Monaco tab shows). Keeping the seam narrow
// makes the session unit-testable with a fake and guarantees a single authoritative
// copy: form edits and body edits land in the SAME buffer, saved once.
export interface EditBuffer {
    get Content(): string
    set Content(v: string)
    Save(): Promise<void>
}

// Edits one skill: binds a structured x-plexus form to the open SKILL.md buffer. A
// form field commit re-serializes only the x-plexus region back into the buffer
// (body untouched) and re-runs validation. Packaged scope is read-only.
export class SkillEditSession extends Observable {
    private readonly buffer: EditBuffer
    private readonly codec: SkillFileCodec
    private readonly validator: SkillValidator
    private readonly _form: SkillFrontmatterFormVm
    private readonly _readOnly: boolean
    private _problems: SkillProblem[]

    constructor(skill: Skill, buffer: EditBuffer, codec: SkillFileCodec, validator: SkillValidator) {
        super()
        this.buffer = buffer
        this.codec = codec
        this.validator = validator
        this._readOnly = skill.Scope === SkillScope.Packaged
        const ext = codec.readExtension(buffer.Content)
        this._form = new SkillFrontmatterFormVm(ext, this._readOnly, () => this.applyFrontmatter())
        this._problems = validator.validate(ext)
    }

    get Form(): SkillFrontmatterFormVm { return this._form }
    get Problems(): readonly SkillProblem[] { return this._problems }
    get IsReadOnly(): boolean { return this._readOnly }
    get HasProblems(): boolean { return this._problems.length > 0 }

    save(): Promise<void> { return this.buffer.Save() }

    // Merge the form's current x-plexus into the shared buffer, touching only that
    // region; an empty block removes x-plexus entirely (stays a plain Claude skill).
    private applyFrontmatter(): void {
        const ext = this._form.toExtension()
        this.buffer.Content = this.codec.writeExtension(this.buffer.Content, this.isEmpty(ext) ? undefined : ext)
        const prev = this._problems
        this._problems = this.validator.validate(ext)
        this.RaisePropertyChanged('Problems', prev, this._problems)
        this.RaisePropertyChanged('HasProblems', prev.length > 0, this._problems.length > 0)
    }

    private isEmpty(ext: XPlexus): boolean {
        return ext.title === undefined && ext.category === undefined && ext.icon === undefined
            && ext.model === undefined && ext.tags.length === 0 && ext.allowedTools.length === 0
            && ext.requiresProjectType.length === 0 && ext.deprecation === undefined
            && ext.inputs.length === 0 && ext.bindings.length === 0 && ext.outputs.length === 0
    }
}
