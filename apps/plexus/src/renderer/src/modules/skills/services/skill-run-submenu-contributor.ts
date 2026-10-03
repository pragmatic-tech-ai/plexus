import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { CommandDefinition, type CommandContext, type ICommandContributor } from '@pragmatic-tech-ai/mural/framework'
import { type HierarchyActionContext } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { FileTreeContributor } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer'
import { AgentSkillKind } from '../../../../../shared/agent-api.js'
import { SkillCatalog } from './skill-catalog.js'
import { SkillActionContributor } from './skill-action-contributor.js'
import { type Skill } from './skill.js'

// The lazy submenu behind the "Run Agent / Skill" command on a member (project) row —
// the B+C1 replacement for the old async HierarchyAction.Children.Add fill. The menu
// realizes this contributor on submenu-open (CommandMenuBuilder.RealizeChildren) and the
// rows it returns are each a `skill.run::<name>` CommandDefinition that SkillActionContributor
// resolves to a runner launch. Discovery is I/O and starts when the parent command is
// resolved (menu build); this read is synchronous, so a submenu opened before discovery
// completes shows a disabled "discovering" placeholder and surfaces the skills on reopen.
export class SkillRunSubmenuContributor extends ServiceBase implements ICommandContributor
{
    public static readonly Key = new ServiceKey<SkillRunSubmenuContributor>('SkillRunSubmenuContributor')
    private static readonly AgentPrefix = 'agent: '
    private static readonly SkillPrefix = 'skill: '
    private static readonly LoadingTitle = 'Discovering skills…'
    private static readonly EmptyTitle = 'No skills available'

    public constructor(provider: IServiceProvider) { super(provider) }

    public Contribute(_parent: CommandDefinition, context: CommandContext): readonly CommandDefinition[]
    {
        const anchor = (context as HierarchyActionContext).Anchor
        const member = FileTreeContributor.MemberOf(anchor)
        if (member?.Storage === undefined)
        {
            return [SkillActionContributor.Placeholder.EmptyRow(SkillRunSubmenuContributor.EmptyTitle)]
        }
        const catalog = this.Provider.get(SkillCatalog.Key)
        if (catalog === undefined)
        {
            return [SkillActionContributor.Placeholder.EmptyRow(SkillRunSubmenuContributor.EmptyTitle)]
        }
        const skills = catalog.forProject(member.Storage.Root)
        if (skills.length === 0)
        {
            return [SkillActionContributor.Placeholder.LoadingRow(SkillRunSubmenuContributor.LoadingTitle)]
        }
        return skills.map((s) => this.Row(s))
    }

    private Row(skill: Skill): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = `${SkillActionContributor.RunChildPrefix}${skill.Name}`
        const prefix = skill.Kind === AgentSkillKind.Agent
            ? SkillRunSubmenuContributor.AgentPrefix
            : SkillRunSubmenuContributor.SkillPrefix
        def.Title = `${prefix}${skill.Name}`
        return def
    }
}

export default SkillRunSubmenuContributor
