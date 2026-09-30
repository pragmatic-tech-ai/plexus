import { ServiceBase, ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { HierarchyAction, NodeKey, type IHierarchyActionContributor, type HierarchyActionContext } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { FileTreeContributor } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import { SkillCatalog } from './skill-catalog.js'
import { SkillRunner } from './skill-runner.js'
import { SkillChoiceBuilder } from '../../agent-chat/services/agent-skill-choice.js'

// The "Run Agent / Skill" action for a member (project) row — the IProjectMenuSource
// replacement on the action seam, keyed NodeKey.Project. The submenu is filled
// asynchronously (the catalog discovery is I/O): the action renders immediately with
// an observable, empty Children collection that fills in as discovery completes, so an
// empty or slow catalog leaves a usable (empty) submenu rather than a throw or a hang.
export class SkillActionContributor extends ServiceBase implements IHierarchyActionContributor
{
    public static readonly Key = new ServiceKey<SkillActionContributor>('SkillActionContributor')
    private static readonly RunLabel = 'Run Agent / Skill'

    public readonly ActionKeys = [NodeKey.Project]

    public ActionsFor(context: HierarchyActionContext): readonly HierarchyAction[]
    {
        const member = FileTreeContributor.MemberOf(context.Anchor)
        if (member?.Storage === undefined) return []
        const run = HierarchyAction.Command(SkillActionContributor.RunLabel, () => {})
        void this.fill(run, member.Storage.Root, member)
        return [run]
    }

    private async fill(run: HierarchyAction, folder: string, member: SolutionMember): Promise<void>
    {
        const catalog = this.Provider.get(SkillCatalog.Key)
        const runner = this.Provider.get(SkillRunner.Key)
        if (catalog === undefined || runner === undefined) return
        // Discovery is I/O and can reject (an unreadable project folder). A failure must
        // leave the submenu usable-and-empty, never surface as an unhandled rejection off
        // the fire-and-forget caller.
        try
        {
            await catalog.discoverAll([folder])
            const skills = catalog.forProject(folder)
            for (const c of SkillChoiceBuilder.fromSkills(skills, (s) => { void runner.run(s, folder, member.Title) }))
            {
                run.Children.Add(HierarchyAction.Command(c.Label, () => c.Command.Execute()))
            }
        }
        catch
        {
            // Empty submenu — the failure is the agent runner's to report on invocation.
        }
    }
}

export default SkillActionContributor
