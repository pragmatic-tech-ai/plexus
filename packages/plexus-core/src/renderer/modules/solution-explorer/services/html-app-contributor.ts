import { join } from 'node:path'
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
import type { IPreviewServer } from '../../preview-server/preview-server.js'

// Contributes the Open HTML app command to a project row: builds the html-bundle build system
// to <project>/build/ on disk (via the build-root override), then opens the resulting
// index.html in the OS browser. Action-only (Contribute yields no nodes).
export class HtmlAppContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<HtmlAppContributor>('HtmlAppContributor')

    public static readonly OpenCommandId = 'html.open'
    public static readonly ServeCommandId = 'html.serve'

    private static readonly SystemId = 'html-bundle'
    private static readonly FlavorId = 'html-bundle'
    private static readonly BuildDir = 'build'
    private static readonly IndexFile = 'index.html'
    private static readonly OpenLabel = 'Open HTML app'
    private static readonly OpenTitlePrefix = 'Opening HTML app '
    private static readonly ServeLabel = 'Serve HTML app'
    private static readonly ServeTitlePrefix = 'Serving HTML app '
    private static readonly BuildFailedPrefix = 'Build failed: '
    private static readonly NoOutputPathError = 'Build produced no output path to serve'

    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 21

    public readonly Actions: readonly CommandDefinition[]

    constructor(
        private readonly build: BuildService,
        private readonly work: BackgroundWorkService | undefined,
        private readonly fs: FileSystemService,
        private readonly previewServer?: IPreviewServer,
        private readonly openUrl: (url: string) => void = (u) => void window.open(u, '_blank', 'noopener'))
    {
        this.Actions = [
            HtmlAppContributor.command(HtmlAppContributor.OpenCommandId, HtmlAppContributor.OpenLabel, 52),
            HtmlAppContributor.command(HtmlAppContributor.ServeCommandId, HtmlAppContributor.ServeLabel, 53),
        ]
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
        const member = FileTreeContributor.MemberOf((context as HierarchyActionContext).Anchor)
        if (member === undefined) return undefined
        if (commandId === HtmlAppContributor.OpenCommandId)
        {
            return new RelayCommand(() => this.openApp(member), () => this.work !== undefined)
        }
        if (commandId === HtmlAppContributor.ServeCommandId)
        {
            return new RelayCommand(() => this.serveApp(member), () => this.work !== undefined && this.previewServer !== undefined)
        }
        return undefined
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
            const outputPath = output.Result.OutputPath
            if (outputPath === undefined)
            {
                throw new Error(HtmlAppContributor.NoOutputPathError)
            }
            await this.fs.OpenExternal(join(outputPath, HtmlAppContributor.IndexFile))
            return output
        })
    }

    private serveApp(member: SolutionMember): void
    {
        const work = this.work
        const storage = member.Storage
        const previewServer = this.previewServer
        if (work === undefined || storage === undefined || previewServer === undefined) return
        void work.run(`${HtmlAppContributor.ServeTitlePrefix}${member.Title}`, async (ctx) =>
        {
            const root = HtmlAppContributor.OutputRoot(storage)
            const output = await this.build.Build(storage, HtmlAppContributor.SystemId, HtmlAppContributor.FlavorId, new BuildProgressReporter(ctx), { OutputRootOverride: root })
            if (!output.Result.Ok)
            {
                throw new Error(`${HtmlAppContributor.BuildFailedPrefix}${BuildService.FormatErrors(output.Result.Diagnostics)}`)
            }
            const outputPath = output.Result.OutputPath
            if (outputPath === undefined)
            {
                throw new Error(HtmlAppContributor.NoOutputPathError)
            }
            const served = await previewServer.Start(outputPath)
            this.openUrl(served.Url)
            return output
        })
    }
}

export default HtmlAppContributor
