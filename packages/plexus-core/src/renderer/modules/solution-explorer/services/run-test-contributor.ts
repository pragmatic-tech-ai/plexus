import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem, type HierarchyActionContext,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import type { IBuildService, SolutionMember } from '@pragmatic-tech-ai/todl'
import { FileTreeContributor } from './file-tree-contributor.js'
import type { IContentMutations } from './content-mutations.js'
import { BackgroundWorkService } from '../../background-work/index.js'
import type { IEnvironmentRunTester } from '../../environment-run-test/environment-run-tester.js'
import { EnvironmentPublishStatus } from '../../../../shared/environment-publish-api.js'
import type { RunTestResult } from '../../../../shared/run-test-api.js'
import { TargetIdentity, type TargetChoice } from '../../../../shared/account-api.js'
import { TargetPickerFlow, type ITargetPicker } from './target-dialog.js'
import { PublishToEnvironmentContributor } from './publish-to-environment-contributor.js'

// Contributes the Run/Test in environment command to a project row: asks the environment picker for
// the dev environment, builds the html-bundle-remote flavor (the same build Publish uses), hands the
// output to the IEnvironmentRunTester (whose main-process side loads it into that environment's own
// runtime through the run-test relay) and, once the server applied it, opens the served-app URL in the
// system browser. A non-applied status fails the task row with the server reason and opens nothing.
// Action-only (Contribute yields no nodes).
export class RunTestContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<RunTestContributor>('RunTestContributor')

    public static readonly RunTestCommandId = 'environment.run-test'

    private static readonly RunTestLabel = 'Run/Test in environment'
    private static readonly TitlePrefix = 'Running '
    private static readonly OnEnvironment = ' on '
    private static readonly RunFailedPrefix = 'Run/Test failed ('
    private static readonly RunFailedSeparator = '): '
    private static readonly NoReason = 'no reason given'
    private static readonly WindowTarget = '_blank'
    private static readonly WindowFeatures = 'noopener'

    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 24

    public readonly Actions: readonly CommandDefinition[]

    // openUrl is the app's existing open-a-URL seam (window.open; the main process routes it to the
    // system browser through setWindowOpenHandler), as HtmlAppContributor uses it.
    constructor(
        private readonly buildService: IBuildService,
        private readonly work: BackgroundWorkService | undefined,
        private readonly mutations: IContentMutations,
        private readonly runner: IEnvironmentRunTester | undefined,
        private readonly picker: ITargetPicker | undefined = undefined,
        private readonly openUrl: (url: string) => void = (u) => void window.open(u, RunTestContributor.WindowTarget, RunTestContributor.WindowFeatures))
    {
        const def = new CommandDefinition()
        def.Id = RunTestContributor.RunTestCommandId
        def.Title = RunTestContributor.RunTestLabel
        def.Order = 55
        def.Context = HierarchyContext.For(NodeKey.Project)
        this.Actions = [def]
    }

    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, context: CommandContext): ICommand | undefined
    {
        if (commandId !== RunTestContributor.RunTestCommandId) return undefined
        const member = FileTreeContributor.MemberOf((context as HierarchyActionContext).Anchor)
        if (member === undefined) return undefined
        return new RelayCommand(() => void this.run(member), () => this.work !== undefined && this.runner !== undefined && this.picker !== undefined)
    }

    // Picks the environment first (a cancel runs nothing; a picker failure fails a task row, never an
    // unhandled rejection), then builds, loads and opens under a background task.
    private async run(member: SolutionMember): Promise<void>
    {
        const work = this.work
        const storage = member.Storage
        const runner = this.runner
        const picker = this.picker
        if (work === undefined || storage === undefined || runner === undefined || picker === undefined) return
        let choice: TargetChoice | undefined
        try
        {
            choice = await TargetPickerFlow.Choose(picker)
        }
        catch (e)
        {
            void work.run(`${RunTestContributor.TitlePrefix}${member.Title}`, () => Promise.reject(e))
            return
        }
        if (choice === undefined) return
        const target = TargetIdentity.RefOf(choice)
        const title = `${RunTestContributor.TitlePrefix}${member.Title}${RunTestContributor.OnEnvironment}${target.Name}`
        void work.run(title, async (ctx) =>
        {
            await this.mutations.EnsureMemberGenerated(member)
            const outputPath = await PublishToEnvironmentContributor.BuildRemote(this.buildService, storage, ctx)
            const result = RunTestContributor.RequireApplied(await runner.Run(target, outputPath))
            this.openUrl(result.AppUrl)
            return result
        })
    }

    private static RequireApplied(result: RunTestResult): RunTestResult
    {
        if (result.Status !== EnvironmentPublishStatus.Applied)
        {
            const reason = result.Reason ?? RunTestContributor.NoReason
            throw new Error(`${RunTestContributor.RunFailedPrefix}${result.Status}${RunTestContributor.RunFailedSeparator}${reason}`)
        }
        return result
    }
}

export default RunTestContributor
