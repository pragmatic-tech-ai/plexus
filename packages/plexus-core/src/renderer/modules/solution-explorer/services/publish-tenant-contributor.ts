import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { BuildService, parseManifest, type SolutionMember } from '@pragmatic-tech-ai/todl'
import type { IStorage, ILocalFileAccess } from '@pragmatic-tech-ai/todl-runtime'
import { PROJECT_MANIFEST_FILENAME } from '../../../projects/project-factory.js'
import { FileTreeContributor } from './file-tree-contributor.js'
import { BuildProgressReporter, type ITaskProgressSink } from './build-progress-reporter.js'
import type { IContentMutations } from './content-mutations.js'
import { BackgroundWorkService } from '../../background-work/index.js'
import type { ITenantPublisher, TenantPublishResult } from '../../tenant-publish/tenant-publisher.js'

// Contributes the Publish to tenant command to a project row: builds the html-bundle-remote
// flavor to <project>/build/ (renderer BuildService, like Open/Serve HTML app), then hands the
// output dir to the ITenantPublisher, whose main-process side uploads it via the protocol
// deploy method. A non-applied server status fails the task row with the server reason.
// Action-only (Contribute yields no nodes).
export class PublishTenantContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<PublishTenantContributor>('PublishTenantContributor')

    public static readonly PublishCommandId = 'tenant.publish'

    private static readonly SystemId = 'html-bundle'
    private static readonly FlavorId = 'html-bundle-remote'
    private static readonly BuildDir = 'build'
    private static readonly PublishLabel = 'Publish to tenant'
    private static readonly TitlePrefix = 'Publishing to tenant '
    private static readonly BuildFailedPrefix = 'Build failed: '
    private static readonly NoOutputPathError = 'Build produced no output path to publish'
    private static readonly PublishFailedPrefix = 'Publish to tenant failed ('
    private static readonly PublishFailedSeparator = '): '
    private static readonly NoReason = 'no reason given'
    private static readonly AppliedStatus = 'applied'

    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 22

    public readonly Actions: readonly CommandDefinition[]

    constructor(
        private readonly buildService: BuildService,
        private readonly work: BackgroundWorkService | undefined,
        private readonly mutations: IContentMutations,
        private readonly publisher: ITenantPublisher | undefined)
    {
        this.Actions = [PublishTenantContributor.command()]
    }

    private static command(): CommandDefinition
    {
        const def = new CommandDefinition()
        def.Id = PublishTenantContributor.PublishCommandId
        def.Title = PublishTenantContributor.PublishLabel
        def.Order = 54
        def.Context = HierarchyContext.For(NodeKey.Project)
        return def
    }

    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        if (commandId !== PublishTenantContributor.PublishCommandId) return undefined
        const member = FileTreeContributor.MemberOf((context as HierarchyActionContext).Anchor)
        if (member === undefined) return undefined
        return new RelayCommand(() => this.publish(member), () => this.work !== undefined && this.publisher !== undefined)
    }

    private publish(member: SolutionMember): void
    {
        const work = this.work
        const storage = member.Storage
        const publisher = this.publisher
        if (work === undefined || storage === undefined || publisher === undefined) return
        void work.run(`${PublishTenantContributor.TitlePrefix}${member.Title}`, async (ctx) =>
        {
            await this.mutations.EnsureMemberGenerated(member)
            const outputPath = await this.buildRemote(storage, ctx)
            const result = await publisher.Publish(outputPath)
            return PublishTenantContributor.RequireApplied(result)
        })
    }

    // Builds the remote flavor into <project>/build and returns its output dir. The remote
    // target AppName is the project manifest id (falling back to its name).
    private async buildRemote(storage: IStorage, ctx: ITaskProgressSink): Promise<string>
    {
        const manifest = parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
        const options =
        {
            OutputRootOverride: (storage as unknown as ILocalFileAccess).ResolveOsPath(PublishTenantContributor.BuildDir),
            Remote: { AppName: manifest.id ?? manifest.name },
        }
        const result = await this.buildService.Build(storage, PublishTenantContributor.SystemId, PublishTenantContributor.FlavorId, new BuildProgressReporter(ctx), options)
        if (!result.Result.Ok)
        {
            throw new Error(`${PublishTenantContributor.BuildFailedPrefix}${BuildService.FormatErrors(result.Result.Diagnostics)}`)
        }
        if (result.Result.OutputPath === undefined) throw new Error(PublishTenantContributor.NoOutputPathError)
        return result.Result.OutputPath
    }

    private static RequireApplied(result: TenantPublishResult): TenantPublishResult
    {
        if (result.Status !== PublishTenantContributor.AppliedStatus)
        {
            const reason = result.Reason ?? PublishTenantContributor.NoReason
            throw new Error(`${PublishTenantContributor.PublishFailedPrefix}${result.Status}${PublishTenantContributor.PublishFailedSeparator}${reason}`)
        }
        return result
    }
}

export default PublishTenantContributor
