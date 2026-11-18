import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, DialogService, type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import type { Solution, SolutionManagerService } from '@pragmatic-tech-ai/todl'
import type { IPromptService } from '@pragmatic-tech-ai/todl-runtime'
import { BackgroundWorkService } from '../../background-work/index.js'
import type { IUploadContributor } from '../../upload/upload-contributor.js'
import type { SolutionTreeEnumerator } from '../../upload/solution-tree-enumerator.js'
import type { SolutionPackageBuilder } from '../../graph-contribute/solution-package-builder.js'
import type { UploadContribution } from '../../../../shared/upload-api.js'
import { TargetIdentity, type TargetRef } from '../../../../shared/account-api.js'
import { InfoDialog } from './info-dialog.js'
import { TargetPickerFlow, type ITargetPicker } from './target-dialog.js'

// Contributes the "Upload to dev environment…" command to the Solution root row. Mirrors
// ContributeToGraphContributor: the target picker chooses the environment (+ graph), the renderer
// enumerates the active local solution's tree and builds its packages, then IUploadContributor.Upload
// sends both through the main process (no credential reaches the renderer). Failures throw inside the
// background task and fail that row with their sentence.
export class UploadToEnvironmentContributor implements IHierarchyContributor
{
    public static readonly Key = new ServiceKey<UploadToEnvironmentContributor>('UploadToEnvironmentContributor')

    public static readonly UploadCommandId = 'environment.upload'

    private static readonly UploadLabel = 'Upload to dev environment…'
    private static readonly TitlePrefix = 'Uploading '
    private static readonly InEnvironment = ' to '
    private static readonly UploadFailedTitle = 'Upload to dev environment failed'
    private static readonly UploadedTitle = 'Uploaded to dev environment'
    private static readonly FilesSeparator = ' - files uploaded: '
    private static readonly NoBuilder = 'A graph was chosen but the solution cannot be built here, so the graph cannot be recomposed.'
    private static readonly SaveFirstMessage = 'This solution has not been saved to a folder yet, so there is nothing to upload. Save it to a folder now?'
    private static readonly SaveFirstLabel = 'Save'
    // Distinct from the neighbouring contributors (build 51, html 52-53, publish 54, contribute-to-graph 56 / row 23).
    private static readonly RowOrder = 24
    private static readonly CommandOrder = 57

    public readonly ParentKeys = [NodeKey.Solution]
    public readonly Order = UploadToEnvironmentContributor.RowOrder

    public readonly Actions: readonly CommandDefinition[]

    public constructor(
        private readonly solution: Solution,
        private readonly enumerator: SolutionTreeEnumerator | undefined,
        private readonly builder: SolutionPackageBuilder | undefined,
        private readonly work: BackgroundWorkService | undefined,
        private readonly contributor: IUploadContributor | undefined,
        private readonly dialogs: DialogService | undefined,
        private readonly picker: ITargetPicker | undefined = undefined,
        private readonly manager: SolutionManagerService | undefined = undefined,
        private readonly prompts: IPromptService | undefined = undefined)
    {
        const def = new CommandDefinition()
        def.Id = UploadToEnvironmentContributor.UploadCommandId
        def.Title = UploadToEnvironmentContributor.UploadLabel
        def.Order = UploadToEnvironmentContributor.CommandOrder
        def.Context = HierarchyContext.For(NodeKey.Solution)
        this.Actions = [def]
    }

    public Contribute(_parent: HierarchyItem): HierarchyContribution
    {
        return new NodeContribution([])
    }

    public Resolve(commandId: string, _context: CommandContext): ICommand | undefined
    {
        if (commandId !== UploadToEnvironmentContributor.UploadCommandId) return undefined
        return new RelayCommand(() => void this.upload(), () => this.enumerator !== undefined && this.contributor !== undefined && this.work !== undefined && this.picker !== undefined)
    }

    private async upload(): Promise<void>
    {
        const enumerator = this.enumerator
        const contributor = this.contributor
        const work = this.work
        const picker = this.picker
        if (enumerator === undefined || contributor === undefined || work === undefined || picker === undefined) return
        const solution = await this.EnsureSaved()
        if (solution === undefined) return
        let target: TargetRef
        let graphName: string | undefined
        try
        {
            const choice = await TargetPickerFlow.Choose(picker)
            if (choice === undefined) return
            target = TargetIdentity.RefOf(choice)
            graphName = choice.GraphName
        }
        catch (e)
        {
            this.surface(UploadToEnvironmentContributor.UploadFailedTitle, e)
            return
        }
        const builder = this.builder
        try
        {
            this.start(work, enumerator, contributor, builder, solution, target, graphName)
        }
        catch (e)
        {
            this.surface(UploadToEnvironmentContributor.UploadFailedTitle, e)
        }
    }

    // When the active solution has no on-disk location yet, offer to save it (the enumerator
    // needs a root). On confirm the engine's Save picks a folder and re-activates a ROOTED
    // solution — a NEW instance — which is returned for the upload; a decline or a cancelled
    // folder pick returns undefined (abort). With no save seam wired (a headless host) the
    // solution is returned as-is, so the enumerator surfaces its own "nothing to upload" error.
    public async EnsureSaved(): Promise<Solution | undefined>
    {
        if (this.solution.HasLocation) return this.solution
        if (this.manager === undefined || this.prompts === undefined) return this.solution
        const confirmed = await this.prompts.Confirm(UploadToEnvironmentContributor.SaveFirstMessage, UploadToEnvironmentContributor.SaveFirstLabel)
        if (!confirmed) return undefined
        await this.manager.Save()
        const active = this.manager.ActiveSolution
        return active !== undefined && active.HasLocation ? active : undefined
    }

    // Starts the background task. Kept apart so a synchronous throw from work.run surfaces like the picker's failures.
    private start(work: BackgroundWorkService, enumerator: SolutionTreeEnumerator, contributor: IUploadContributor, builder: SolutionPackageBuilder | undefined, solution: Solution, target: TargetRef, graphName: string | undefined): void
    {
        void work.run(`${UploadToEnvironmentContributor.TitlePrefix}${solution.Name}${UploadToEnvironmentContributor.InEnvironment}${target.Name}`, async (_ctx): Promise<number> =>
        {
            const tree = await enumerator.Enumerate(solution)
            let contribution: UploadContribution | undefined
            if (graphName !== undefined)
            {
                if (builder === undefined) throw new Error(UploadToEnvironmentContributor.NoBuilder)
                contribution = { GraphName: graphName, SolutionId: solution.Name, Packages: [...await builder.Build()] }
            }
            await contributor.Upload(target, solution.Name, tree, contribution)
            return tree.length
        }).done.then(
            (count) =>
            {
                if (this.dialogs !== undefined)
                {
                    void InfoDialog.Show(this.dialogs, UploadToEnvironmentContributor.UploadedTitle, `${target.Name}${UploadToEnvironmentContributor.FilesSeparator}${count}`)
                }
            },
            () => { /* failure is already shown in the background task row */ },
        )
    }

    private surface(title: string, error: unknown): void
    {
        const dialogs = this.dialogs
        if (dialogs === undefined) return
        void InfoDialog.Show(dialogs, title, error instanceof Error ? error.message : String(error))
    }
}

export default UploadToEnvironmentContributor
