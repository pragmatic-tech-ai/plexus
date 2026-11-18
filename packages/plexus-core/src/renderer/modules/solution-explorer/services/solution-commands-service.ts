// solution-commands-service.ts — the Save / Save As / Rename commands for the active
// solution, over the todl engine's existing SolutionManagerService ops. Save() drives
// the engine's Save (which prompts for a folder when the solution is untitled and writes
// in place when rooted); Save As always picks a new folder; Rename gathers a new name via
// the prompt seam and renames (the engine renames <old>.pksln -> <new>.pksln when rooted).
// This class adds only the UI commands and failure feedback; no engine logic lives here.
import { ServiceBase, ServiceKey, RelayCommand, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { SolutionManagerService } from '@pragmatic-tech-ai/todl'
import type { IPromptService } from '@pragmatic-tech-ai/todl-runtime'
import { FileSystemService } from '../../storage/index.js'
import { InfoDialog } from './info-dialog.js'

export class SolutionCommandsService extends ServiceBase
{
    public static readonly Key = new ServiceKey<SolutionCommandsService>('SolutionCommandsService')

    private static readonly SaveFailedTitle = 'Save solution'
    private static readonly RenameFailedTitle = 'Rename solution'
    private static readonly SaveAsFolderTitle = 'Save solution to folder…'
    private static readonly RenameLabel = 'Solution name'

    private readonly _saveCommand: ICommand
    private readonly _saveAsCommand: ICommand
    private readonly _renameCommand: ICommand

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this._saveCommand = new RelayCommand(() => void this.Save(), () => this.HasActiveSolution())
        this._saveAsCommand = new RelayCommand(() => void this.SaveAs(), () => this.HasActiveSolution())
        this._renameCommand = new RelayCommand(() => void this.Rename(), () => this.HasActiveSolution())
    }

    public get SaveCommand(): ICommand { return this._saveCommand }
    public get SaveAsCommand(): ICommand { return this._saveAsCommand }
    public get RenameCommand(): ICommand { return this._renameCommand }

    private get manager(): SolutionManagerService { return this.Provider.getRequired(SolutionManagerService.Key) }
    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get prompts(): IPromptService { return this.Provider.getRequired(SolutionManagerService.PromptServiceKey) }
    private get dialogs(): DialogService { return this.Provider.getRequired(DialogService.Key) }

    private HasActiveSolution(): boolean
    {
        return this.manager.ActiveSolution !== undefined
    }

    // Save: the engine prompts for a folder when the solution is untitled, and writes in
    // place when it already has one.
    public async Save(): Promise<void>
    {
        try
        {
            await this.manager.Save()
        }
        catch (e)
        {
            await this.Inform(SolutionCommandsService.SaveFailedTitle, e)
        }
    }

    // Save As: always pick a new folder, then write the solution there.
    public async SaveAs(): Promise<void>
    {
        try
        {
            const folder = await this.fs.OpenFolder({ Title: SolutionCommandsService.SaveAsFolderTitle })
            if (folder === null)
            {
                return
            }
            await this.manager.SaveAs(folder)
        }
        catch (e)
        {
            await this.Inform(SolutionCommandsService.SaveFailedTitle, e)
        }
    }

    // Rename: prompt for a new name (seeded with the current one) and rename; a cancelled,
    // blank, or unchanged name is a no-op.
    public async Rename(): Promise<void>
    {
        const solution = this.manager.ActiveSolution
        if (solution === undefined)
        {
            return
        }
        try
        {
            const name = await this.prompts.PromptText(SolutionCommandsService.RenameLabel, solution.Name)
            if (name === undefined || name.trim() === '' || name === solution.Name)
            {
                return
            }
            await this.manager.Rename(name)
        }
        catch (e)
        {
            await this.Inform(SolutionCommandsService.RenameFailedTitle, e)
        }
    }

    private Inform(title: string, error: unknown): Promise<void>
    {
        return InfoDialog.Show(this.dialogs, title, error instanceof Error ? error.message : String(error))
    }
}

export default SolutionCommandsService
