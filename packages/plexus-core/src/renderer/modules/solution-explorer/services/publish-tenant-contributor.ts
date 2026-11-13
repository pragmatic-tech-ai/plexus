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
import type { ITenantPublisher } from '../../tenant-publish/tenant-publisher.js'
import { RemoteBuildDirName, TenantPublishStatus, type TenantPublishResult } from '../../../../shared/tenant-publish-api.js'
import { TargetIdentity, type TargetChoice } from '../../../../shared/account-api.js'
import { TargetPickerFlow, type ITargetPicker } from './target-dialog.js'

// Contributes the Publish to tenant command to a project row: asks the environment picker
// (PublishTargetDialog) for the target Runtime environment,
// builds the html-bundle-remote flavor to <project>/build-remote/ (renderer BuildService, like
// Open/Serve HTML app), then hands the target (name + source) + output dir to the ITenantPublisher, whose
// main-process side uploads it through the relay of the target's source (console or platform) via the protocol deploy method. A
// non-applied server status fails the task row with the server reason.
// Action-only (Contribute yields no nodes).
export class PublishTenantContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<PublishTenantContributor>('PublishTenantContributor')

    public static readonly PublishCommandId = 'tenant.publish'

    private static readonly SystemId = 'html-bundle'
    private static readonly FlavorId = 'html-bundle-remote'
    // Its own dir, distinct from HtmlAppContributor build/, so publishing never clobbers the
    // local Open/Serve HTML app output (and vice versa).
    public static readonly BuildDir = RemoteBuildDirName
    private static readonly PublishLabel = 'Publish to tenant'
    private static readonly TitlePrefix = 'Publishing '
    private static readonly ToEnvironment = ' to '
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
        private readonly picker: ITargetPicker | undefined = undefined)
    {
        this.Actions = [
            PublishTenantContributor.command(PublishTenantContributor.PublishCommandId, PublishTenantContributor.PublishLabel, 54),
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
        if (commandId !== PublishTenantContributor.PublishCommandId) return undefined
        const member = FileTreeContributor.MemberOf((context as HierarchyActionContext).Anchor)
        if (member === undefined) return undefined
        return new RelayCommand(() => void this.publish(member),() => this.work !== undefined && this.publisher !== undefined && this.picker !== undefined)
    }

    // Asks the picker for the environment first (signing in first when the maker asks to, see
    // TargetPickerFlow; a cancel publishes nothing), then builds and
    // uploads under a background task so a build / sign-in / refusal failure fails that row with its
    // sentence. A picker failure fails a task row too (this contributor has no dialog surface), so
    // it is never an unhandled rejection.
    private async publish(member: SolutionMember): Promise<void>
    {
        const work = this.work
        const storage = member.Storage
        const publisher = this.publisher
        const picker = this.picker
        if (work === undefined || storage === undefined || publisher === undefined || picker === undefined) return
        let choice: TargetChoice | undefined
        try
        {
            choice = await TargetPickerFlow.Choose(picker)
        }
        catch (e)
        {
            void work.run(`${PublishTenantContributor.TitlePrefix}${member.Title}`, () => Promise.reject(e))
            return
        }
        if (choice === undefined) return
        const target = TargetIdentity.RefOf(choice)
        const title = `${PublishTenantContributor.TitlePrefix}${member.Title}${PublishTenantContributor.ToEnvironment}${target.Name}`
        void work.run(title, async (ctx) =>
        {
            await this.mutations.EnsureMemberGenerated(member)
            const outputPath = await this.buildRemote(storage, ctx)
            const result = await publisher.Publish(target, outputPath)
            return PublishTenantContributor.RequireApplied(result)
        })
    }

    // Builds the remote flavor into <project>/build-remote and returns its output dir. The remote
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
        if (result.Status !== TenantPublishStatus.Applied)
        {
            const reason = result.Reason ?? PublishTenantContributor.NoReason
            throw new Error(`${PublishTenantContributor.PublishFailedPrefix}${result.Status}${PublishTenantContributor.PublishFailedSeparator}${reason}`)
        }
        return result
    }
}

export default PublishTenantContributor
