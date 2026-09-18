import { ServiceBase, ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import { ProjectMenuChoice, ProjectTreeHostKey, type IProjectMenuSource } from '@pragmatic-tech-ai/plexus-core/renderer/projects'
import type { OpenProject } from '@pragmatic-tech-ai/plexus-core/renderer/projects/open-project.js'
import { SkillCatalog } from './skill-catalog.js'
import { SkillRunner } from './skill-runner.js'
import { SkillChoiceBuilder } from '../../agent-chat/services/agent-skill-choice.js'
import { ProjectType } from '../../../../../shared/skill-api.js'

// App-side IProjectMenuSource: builds the "Run Agent / Skill" rows from the
// project's .claude catalog, each choice launching a background run via
// SkillRunner. Registered under ProjectMenuSourceKey (see app.mu).
export class SkillProjectMenuSource extends ServiceBase implements IProjectMenuSource
{
    public static readonly Key = new ServiceKey<SkillProjectMenuSource>('SkillProjectMenuSource')

    public async MenuFor(op: OpenProject): Promise<readonly ProjectMenuChoice[]>
    {
        const catalog = this.Provider.get(SkillCatalog.Key)
        const runner = this.Provider.get(SkillRunner.Key)
        if (catalog === undefined || runner === undefined) return []
        // Discover across every open project (plus op, in case it isn't in the tree
        // host's list yet), then narrow to op's own skills so the union catalog
        // doesn't leak other projects' project-scoped skills into this menu.
        const openFolders = this.Provider.get(ProjectTreeHostKey)?.OpenProjects.ToArray().map((o) => o.Folder) ?? []
        const dirs = [...new Set([...openFolders, op.Folder])]
        await catalog.discoverAll(dirs)
        const pt = this.projectTypeOf(op)
        const own = catalog.forProject(op.Folder)
        const skills = pt === undefined ? own : own.filter((s) => s.appliesToProjectType(pt))
        // The runner collects typed inputs + resolves bindings before handing off to
        // ChatSessionsService.RunAgentSkill.
        const choices = SkillChoiceBuilder.fromSkills(skills, (s) => { void runner.run(s, op.Folder, op.Name) })
        return choices.map((c) => new ProjectMenuChoice(c.Label, c.Command))
    }

    // Best-effort project-type classification for the requiresProjectType gate.
    // Only the arch case is unambiguous today (it requires a meta-model base);
    // when the type can't be determined we return undefined and the menu shows
    // every skill (the gate is advisory UX, not a hard boundary).
    private projectTypeOf(op: OpenProject): ProjectType | undefined
    {
        return op.Factory.requiresMetaModel === true ? ProjectType.Architecture : undefined
    }
}

export default SkillProjectMenuSource
