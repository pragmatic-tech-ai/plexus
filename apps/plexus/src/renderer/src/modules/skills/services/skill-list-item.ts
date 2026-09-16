import { Observable, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { SkillScope } from '../../../../../shared/skill-api.js'
import type { Skill } from './skill.js'

// One row in the authoring panel's skill list. Wraps a Skill with a SelectCommand
// (the row-owns-its-command idiom used across the app's list panels), plus a couple
// of display-friendly getters the template binds.
export class SkillListItemVm extends Observable {
    private readonly skill: Skill
    private readonly _select: RelayCommand

    constructor(skill: Skill, onSelect: (s: Skill) => void) {
        super()
        this.skill = skill
        this._select = new RelayCommand(() => onSelect(this.skill))
    }

    get Skill(): Skill { return this.skill }
    get Title(): string { return this.skill.Title }
    get Description(): string { return this.skill.Description }
    get IsReadOnly(): boolean { return this.skill.Scope === SkillScope.Packaged }
    get IsDeprecated(): boolean { return this.skill.IsDeprecated }
    get ScopeLabel(): string {
        switch (this.skill.Scope) {
            case SkillScope.Project: return 'Project'
            case SkillScope.Global: return 'Global'
            default: return 'Packaged'
        }
    }
    get SelectCommand(): ICommand { return this._select }
}
