import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import { BuildService, RemoteBindMode, parseManifest, type SolutionMember } from '@pragmatic-tech-ai/todl'
import type { IStorage, ILocalFileAccess } from '@pragmatic-tech-ai/todl-runtime'
import { PROJECT_MANIFEST_FILENAME } from '../../../projects/project-factory.js'
import { FileTreeContributor } from './file-tree-contributor.js'
import { BuildProgressReporter, type ITaskProgressSink } from './build-progress-reporter.js'
import type { IContentMutations } from './content-mutations.js'
import { BackgroundWorkService } from '../../background-work/index.js'
import type { ITenantPublisher } from '../../tenant-publish/tenant-publisher.js'
import { RemoteBuildDirName, TenantPublishStatus, type TenantPublishResult } from '../../../../shared/tenant-publish-api.js'
import type { ITenantProfilePrompt } from './tenant-profile-dialog.js'

// Contributes the Publish to tenant command to a project row: builds the html-bundle-remote
// flavor to <project>/build-remote/ (renderer BuildService, like Open/Serve HTML app), then hands the
// output dir to the ITenantPublisher, whose main-process side uploads it via the protocol
// deploy method. A non-applied server status fails the task row with the server reason.
// Action-only (Contribute yields no nodes).
export class PublishTenantContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<PublishTenantContributor>('PublishTenantContributor')

    public static readonly PublishCommandId = 'tenant.publish'
    public static readonly ConfigureCommandId = 'tenant.configure'
    public static readonly PublishEnvCommandId = 'tenant.publish-env'

    private static readonly SystemId = 'html-bundle'
    private static readonly FlavorId = 'html-bundle-remote'
    // Its own dir, distinct from HtmlAppContributor build/, so publishing never clobbers the
    // local Open/Serve HTML app output (and vice versa).
    public static readonly BuildDir = RemoteBuildDirName
    private static readonly PublishLabel = 'Publish to tenant'
    private static readonly PublishEnvLabel = 'Publish to tenant (environment graph)'
    private static readonly ConfigureLabel = 'Configure tenant…'
    private static readonly TitlePrefix = 'Publishing to tenant '
    private static readonly BuildFailedPrefix = 'Build failed: '
    private static readonly NoOutputPathError = 'Build produced no output path to publish'
    private static readonly PublishFailedPrefix = 'Publish to tenant failed ('
    private static readonly PublishFailedSeparator = '): '
    private static readonly NoReason = 'no reason given'

    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 22

    public readonly Actions: readonly CommandDefinition[]

    constructor(
        private readonly buildService: BuildService,
        private readonly work: BackgroundWorkService | undefined,
        private readonly mutations: IContentMutations,
        private readonly publisher: ITenantPublisher | undefined,
        private readonly prompt: ITenantProfilePrompt | undefined = undefined)
    {
        this.Actions = [
            PublishTenantContributor.command(PublishTenantContributor.PublishCommandId, PublishTenantContributor.PublishLabel, 54),
            PublishTenantContributor.command(PublishTenantContributor.ConfigureCommandId, PublishTenantContributor.ConfigureLabel, 55),
            PublishTenantContributor.command(PublishTenantContributor.PublishEnvCommandId, PublishTenantContributor.PublishEnvLabel, 56),
        ]
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
        if (commandId === PublishTenantContributor.ConfigureCommandId)
        {
            return new RelayCommand(() => void this.configure(), () => this.publisher !== undefined && this.prompt !== undefined)
        }
        if (commandId !== PublishTenantContributor.PublishCommandId && commandId !== PublishTenantContributor.PublishEnvCommandId) return undefined
        const member = FileTreeContributor.MemberOf((context as HierarchyActionContext).Anchor)
        if (member === undefined) return undefined
        const bind = commandId === PublishTenantContributor.PublishEnvCommandId ? RemoteBindMode.Environment : RemoteBindMode.Application
        return new RelayCommand(() => this.publish(member, bind), () => this.work !== undefined && this.publisher !== undefined)
    }

    // Collects URL + token and hands them to the main-side store. The token goes straight to
    // SetProfile and is neither logged nor retained here.
    private async configure(): Promise<void>
    {
        const publisher = this.publisher
        const prompt = this.prompt
        if (publisher === undefined || prompt === undefined) return
        const input = await prompt.Prompt()
        if (input === undefined) return
        await publisher.SetProfile(input.ServerUrl, input.Token)
    }

    private publish(member: SolutionMember, bind: RemoteBindMode): void
    {
        const work = this.work
        const storage = member.Storage
        const publisher = this.publisher
        if (work === undefined || storage === undefined || publisher === undefined) return
        void work.run(`${PublishTenantContributor.TitlePrefix}${member.Title}`, async (ctx) =>
        {
            await this.mutations.EnsureMemberGenerated(member)
            const outputPath = await this.buildRemote(storage, ctx, bind)
            const result = await publisher.Publish(outputPath)
            return PublishTenantContributor.RequireApplied(result)
        })
    }

    // Builds the remote flavor into <project>/build-remote and returns its output dir. The remote
    // target AppName is the project manifest id (falling back to its name).
    private async buildRemote(storage: IStorage, ctx: ITaskProgressSink, bind: RemoteBindMode): Promise<string>
    {
        const manifest = parseManifest(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
        const options =
        {
            OutputRootOverride: (storage as unknown as ILocalFileAccess).ResolveOsPath(PublishTenantContributor.BuildDir),
            Remote: { AppName: manifest.id ?? manifest.name, Bind: bind },
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
        if (result.Status !== TenantPublishStatus.Applied)
        {
            const reason = result.Reason ?? PublishTenantContributor.NoReason
            throw new Error(`${PublishTenantContributor.PublishFailedPrefix}${result.Status}${PublishTenantContributor.PublishFailedSeparator}${reason}`)
        }
        return result
    }
}

export default PublishTenantContributor
