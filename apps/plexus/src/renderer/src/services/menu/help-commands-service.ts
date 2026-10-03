import {
    RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { EnvironmentService } from '@pragmatic-tech-ai/plexus-core/renderer/environment/environment-service.js'
import { WindowService } from '../window/window-service.js'
import { AboutDialogVm } from './about-dialog.js'
import { ShortcutsDialogVm } from './shortcuts-dialog.js'

// Help-menu commands: About + Keyboard Shortcuts, each opening a read-only
// DialogService modal, plus Quit. This service's own `.services:` registration
// (task-6-brief.md) lands separately. All three commands are always enabled:
// Help info and Quit are available regardless of document/selection state.
export class HelpCommandsService extends ServiceBase
{
    public static readonly Key = new ServiceKey<HelpCommandsService>('HelpCommandsService')

    private static readonly AboutTitle = 'About Plexus'
    private static readonly ShortcutsTitle = 'Keyboard Shortcuts'
    private static readonly AboutDialogWidth = 380
    private static readonly ShortcutsDialogWidth = 480
    private static readonly ShortcutsDialogMaxHeight = 560

    private readonly _showAboutCommand: ICommand
    private readonly _showShortcutsCommand: ICommand
    private readonly _quitCommand: ICommand

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        this._showAboutCommand = new RelayCommand(() => { void this.showAbout() })
        this._showShortcutsCommand = new RelayCommand(() => { void this.showShortcuts() })
        this._quitCommand = new RelayCommand(() => { this.quit() })
    }

    public get ShowAboutCommand(): ICommand { return this._showAboutCommand }
    public get ShowShortcutsCommand(): ICommand { return this._showShortcutsCommand }
    public get QuitCommand(): ICommand { return this._quitCommand }

    private async showAbout(): Promise<void>
    {
        const dialogs = this.Provider.get(DialogService.Key)
        const environment = this.Provider.get(EnvironmentService.Key)
        if (dialogs === undefined || environment === undefined) return
        await dialogs.Show({
            Title:   HelpCommandsService.AboutTitle,
            Content: new AboutDialogVm(environment),
            Width:   HelpCommandsService.AboutDialogWidth,
        })
    }

    private async showShortcuts(): Promise<void>
    {
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs === undefined) return
        await dialogs.Show({
            Title:     HelpCommandsService.ShortcutsTitle,
            Content:   new ShortcutsDialogVm(),
            Width:     HelpCommandsService.ShortcutsDialogWidth,
            MaxHeight: HelpCommandsService.ShortcutsDialogMaxHeight,
        })
    }

    private quit(): void
    {
        const windowService = this.Provider.get(WindowService.Key)
        if (windowService === undefined) return
        windowService.Quit()
    }
}

export default HelpCommandsService
