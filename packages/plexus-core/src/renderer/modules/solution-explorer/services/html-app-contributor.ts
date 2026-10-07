import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { BuildService, type SolutionMember } from '@pragmatic-tech-ai/todl'
import type { IStorage, ILocalFileAccess } from '@pragmatic-tech-ai/todl-runtime'
import { FileTreeContributor } from './file-tree-contributor.js'
import { BuildProgressReporter } from './build-progress-reporter.js'
import { BackgroundWorkService } from '../../background-work/index.js'
import type { FileSystemService } from '../../storage/file-system-service.js'

// Contributes the Open HTML app command to a project row: builds the html-bundle build system
// to <project>/build/ on disk (via the build-root override), then opens the resulting
// index.html in the OS browser. Action-only (Contribute yields no nodes).
export class HtmlAppContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<HtmlAppContributor>('HtmlAppContributor')

    public static readonly OpenCommandId = 'html.open'

    private static readonly SystemId = 'html-bundle'
    private static readonly FlavorId = 'html-bundle'
    private static readonly BuildDir = 'build'
    private static readonly IndexSuffix = '/index.html'
    private static readonly OpenLabel = 'Open HTML app'
    private static readonly OpenTitlePrefix = 'Opening HTML app '
    private static readonly BuildFailedPrefix = 'Build failed: '

    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 21

    public readonly Actions: readonly CommandDefinition[]

    constructor(
        private readonly build: BuildService,
        private readonly work: BackgroundWorkService | undefined,
        private readonly fs: FileSystemService)
    {
        this.Actions = [HtmlAppContributor.command(HtmlAppContributor.OpenCommandId, HtmlAppContributor.OpenLabel, 52)]
    }

    // <project>/build on disk, resolved through the storage's local-file access.
    public static OutputRoot(storage: IStorage): string
    {
        return (storage as unknown as ILocalFileAccess).ResolveOsPath(HtmlAppContributor.BuildDir)
    }

    private static command(id: string, title: string, order: number): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = id
        def.Title = title
        def.Order = order
        def.Context = HierarchyContext.For(NodeKey.Project)
        return def
    }

    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        if (commandId !== HtmlAppContributor.OpenCommandId) return undefined
        const member = FileTreeContributor.MemberOf((context as HierarchyActionContext).Anchor)
        if (member === undefined) return undefined
        return new RelayCommand(() => this.openApp(member), () => this.work !== undefined)
    }

    private openApp(member: SolutionMember): void
    {
        const work = this.work
        const storage = member.Storage
        if (work === undefined || storage === undefined) return
        void work.run(`${HtmlAppContributor.OpenTitlePrefix}${member.Title}`, async (ctx) =>
        {
            const root = HtmlAppContributor.OutputRoot(storage)
            const output = await this.build.Build(storage, HtmlAppContributor.SystemId, HtmlAppContributor.FlavorId, new BuildProgressReporter(ctx), { OutputRootOverride: root })
            if (!output.Result.Ok)
            {
                throw new Error(`${HtmlAppContributor.BuildFailedPrefix}${BuildService.FormatErrors(output.Result.Diagnostics)}`)
            }
            await this.fs.OpenExternal(`${output.Result.OutputPath}${HtmlAppContributor.IndexSuffix}`)
            return output
        })
    }
}

export default HtmlAppContributor
