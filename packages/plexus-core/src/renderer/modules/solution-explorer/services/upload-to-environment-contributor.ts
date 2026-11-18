import { RelayCommand, ServiceKey, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import {
    NodeContribution, NodeKey,
    type IHierarchyContributor, type HierarchyContribution, type HierarchyItem,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { HierarchyContext } from '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-context.js'
import { CommandDefinition, DialogService, type CommandContext } from '@pragmatic-tech-ai/mural/framework'
import type { Solution } from '@pragmatic-tech-ai/todl'
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

    public readonly ParentKeys = [NodeKey.Solution]
    public readonly Order = 24

    public readonly Actions: readonly CommandDefinition[]

    constructor(
        private readonly solution: Solution,
        private readonly enumerator: SolutionTreeEnumerator | undefined,
        private readonly builder: SolutionPackageBuilder | undefined,
        private readonly work: BackgroundWorkService | undefined,
        private readonly contributor: IUploadContributor | undefined,
        private readonly dialogs: DialogService | undefined,
        private readonly picker: ITargetPicker | undefined = undefined)
    {
        const def = new CommandDefinition()
        def.Id = UploadToEnvironmentContributor.UploadCommandId
        def.Title = UploadToEnvironmentContributor.UploadLabel
        def.Order = 57
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
        const solution = this.solution
        const builder = this.builder
        void work.run(`${UploadToEnvironmentContributor.TitlePrefix}${solution.Name}${UploadToEnvironmentContributor.InEnvironment}${target.Name}`, async (_ctx): Promise<number> =>
        {
            const tree = await enumerator.Enumerate(solution)
            let contribution: UploadContribution | undefined
            if (graphName !== undefined && builder !== undefined)
            {
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
