import { RelayCommand, ServiceBase, ServiceKey, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { FileTreeContributor } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer'
import { SkillCatalog } from './skill-catalog.js'
import { SkillRunner } from './skill-runner.js'

// The "Run Agent / Skill" command for a member (project) row — the IProjectMenuSource
// replacement on the command-dispatch seam, Context-tagged to NodeKey.Project. The submenu
// of catalog items is supplied lazily by SkillRunSubmenuContributor; this contributor
// resolves the parent header and each dynamic `skill.run::<name>` child to a runner launch.
export class SkillActionContributor extends ServiceBase implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<SkillActionContributor>('SkillActionContributor')
    public static readonly RunId = 'skill.run'
    public static readonly RunChildPrefix = 'skill.run::'
    // Disabled placeholder rows the submenu shows while discovering / when empty.
    public static readonly LoadingId = 'skill.run.loading'
    public static readonly EmptyId = 'skill.run.empty'

    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 100

    public constructor(provider: IServiceProvider) { super(provider) }

    // Action-only: the project rows come from ProjectsListingContributor.
    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        if (commandId === SkillActionContributor.LoadingId || commandId === SkillActionContributor.EmptyId)
        {
            return new RelayCommand(() => {}, () => false)
        }

        const anchor = (context as HierarchyActionContext).Anchor
        const member = FileTreeContributor.MemberOf(anchor)
        if (member?.Storage === undefined) return undefined
        const folder = member.Storage.Root

        if (commandId === SkillActionContributor.RunId)
        {
            // The parent header: starts catalog discovery (I/O) at menu-build time so the
            // lazy submenu (SkillRunSubmenuContributor) reads a populated catalog when it opens.
            const catalog = this.Provider.get(SkillCatalog.Key)
            if (catalog !== undefined) void this.Discover(catalog, folder)
            return new RelayCommand(() => {})
        }
        if (commandId.startsWith(SkillActionContributor.RunChildPrefix))
        {
            const name = commandId.slice(SkillActionContributor.RunChildPrefix.length)
            const catalog = this.Provider.get(SkillCatalog.Key)
            const runner = this.Provider.get(SkillRunner.Key)
            if (catalog === undefined || runner === undefined) return undefined
            const skill = catalog.forProject(folder).find((s) => s.Name === name)
            if (skill === undefined) return undefined
            return new RelayCommand(() => void runner.run(skill, folder, member.Title))
        }
        return undefined
    }

    // Fire-and-forget discovery. A failure (an unreadable project folder) must leave the
    // submenu usable-and-empty, never surface as an unhandled rejection off this caller.
    private async Discover(catalog: SkillCatalog, folder: string): Promise<void>
    {
        try { await catalog.discoverAll([folder]) }
        catch { /* empty submenu — the agent runner reports the failure on invocation */ }
    }
}

export default SkillActionContributor
