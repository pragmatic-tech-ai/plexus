import { Observable } from '@pragmatic-tech-ai/mural/runtime'
import { BindingSource, type SkillBinding } from '../../../../../shared/skill-api.js'

// One declared binding for a skill run (resolved by #3's binding-resolver).
export class SkillBindingVm extends Observable
{
    private readonly binding: SkillBinding
    constructor(binding: SkillBinding) { super(); this.binding = binding }
    get Source(): BindingSource { return this.binding.source }
    get As(): string | undefined { return this.binding.as }
}
