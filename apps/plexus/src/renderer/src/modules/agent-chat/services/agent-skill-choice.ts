// One row in the project's "Run Agent / Skill" submenu: a label + the command that
// launches that catalog item. Mirrors NewItemChoice (the "Add New" submenu row).
import { MetaData, MuralBase, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import { AgentSkillKind, type CatalogItem, type ProjectCatalog } from '../../../../../shared/agent-api.js'
import type { Skill } from '../../skills/services/skill.js'

export class AgentSkillChoice extends MuralBase
{
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(AgentSkillChoice, 'Label', '', MetaData.None)
    public static readonly CommandKey = MuralBase.RegisterProperty<ICommand>(
        AgentSkillChoice, 'Command', undefined as unknown as ICommand, MetaData.None)

    constructor(label: string, run: () => void)
    {
        super()
        this.set_property_value(AgentSkillChoice.LabelKey, label)
        this.set_property_value(AgentSkillChoice.CommandKey, new RelayCommand(run))
    }

    public get Label(): string { return this.get_property_value(AgentSkillChoice.LabelKey) }
    public get Command(): ICommand { return this.get_property_value(AgentSkillChoice.CommandKey) }
}

// One choice per catalog item — agents first, then skills — each running `run(item)`.
// Legacy ProjectCatalog path, retained for back-compat; the SkillCatalog path below
// supersedes it in the project-explorer wiring.
export function buildAgentSkillChoices(catalog: ProjectCatalog, run: (item: CatalogItem) => void): AgentSkillChoice[]
{
    const items = [...catalog.agents, ...catalog.skills]
    return items.map((item) => new AgentSkillChoice(
        `${item.kind === AgentSkillKind.Agent ? 'agent' : 'skill'}: ${item.name}`,
        () => run(item),
    ))
}

// Builds submenu choices from catalog Skills (house-style class over the legacy free
// function). Label mirrors the old "skill: name" / "agent: name" convention.
export class SkillChoiceBuilder
{
    static fromSkills(skills: readonly Skill[], run: (s: Skill) => void): AgentSkillChoice[]
    {
        return skills.map(s => new AgentSkillChoice(
            `${s.Kind === AgentSkillKind.Agent ? 'agent' : 'skill'}: ${s.Name}`,
            () => run(s),
        ))
    }
}

export default AgentSkillChoice
