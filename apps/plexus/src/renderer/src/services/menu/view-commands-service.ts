import {
    Disposable, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IDisposable, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import {
    ContentHostService, DiagramDocument, NavigationService,
    type Diagram, type DocumentsContentHostService,
} from '@pragmatic-tech-ai/mural/framework'
import { ProblemsService } from '../../modules/problems/problems-service.js'
import { ChatSessionsService } from '../../modules/agent-chat/services/chat-sessions-service.js'

// Zoom + view-panel commands for the main menu's View menu. Zoom bridges to
// the active diagram's live camera (ZoomIn/ZoomOut/ResetZoom), resolving
// ContentHostService → ActiveDocument → ActiveView exactly like
// zoom-shortcuts.ts / EditCommandsService; enabled only while a diagram is
// active with a mounted view. Side Bar / Problems are genuine toggles (flip a
// boolean) and stay always-enabled. Agent Chat is NOT a toggle: its primary
// dock panel is permanent (ChatSessionsService.EnsurePrimary), so this command
// only ensures it exists and brings it to front — see ShowAgentChatCommand.
export class ViewCommandsService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ViewCommandsService>('ViewCommandsService')

    private static readonly ActiveDocumentPropertyName = 'ActiveDocument'

    private readonly _zoomInCommand: RelayCommand
    private readonly _zoomOutCommand: RelayCommand
    private readonly _resetZoomCommand: RelayCommand
    private readonly _zoomCommands: readonly RelayCommand[]
    private readonly _toggleSideBarCommand: ICommand
    private readonly _toggleProblemsCommand: ICommand
    private readonly _showAgentChatCommand: ICommand
    private readonly _activeDocumentSubscription: IDisposable

    public constructor(provider: IServiceProvider)
    {
        super(provider)

        this._zoomInCommand = new RelayCommand(
            () => this.ActiveView()?.ZoomIn(),
            () => this.ActiveView() !== undefined,
        )
        this._zoomOutCommand = new RelayCommand(
            () => this.ActiveView()?.ZoomOut(),
            () => this.ActiveView() !== undefined,
        )
        this._resetZoomCommand = new RelayCommand(
            () => this.ActiveView()?.ResetZoom(),
            () => this.ActiveView() !== undefined,
        )
        this._zoomCommands = [this._zoomInCommand, this._zoomOutCommand, this._resetZoomCommand]

        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        this._activeDocumentSubscription = host !== undefined
            ? host.PropertyChanged(ViewCommandsService.ActiveDocumentPropertyName).subscribe(() => this.RaiseZoomCanExecuteChanged())
            : Disposable.None

        this._toggleSideBarCommand = new RelayCommand(() => this.toggleSideBar())
        this._toggleProblemsCommand = new RelayCommand(() => this.toggleProblems())
        this._showAgentChatCommand = new RelayCommand(() => { void this.showAgentChat() })
    }

    public get ZoomInCommand(): ICommand { return this._zoomInCommand }
    public get ZoomOutCommand(): ICommand { return this._zoomOutCommand }
    public get ResetZoomCommand(): ICommand { return this._resetZoomCommand }
    public get ToggleSideBarCommand(): ICommand { return this._toggleSideBarCommand }
    public get ToggleProblemsCommand(): ICommand { return this._toggleProblemsCommand }
    public get ShowAgentChatCommand(): ICommand { return this._showAgentChatCommand }

    public dispose(): void
    {
        this._activeDocumentSubscription.dispose()
        super.dispose()
    }

    private ActiveDiagram(): DiagramDocument | undefined
    {
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        const doc = host?.ActiveDocument
        return doc instanceof DiagramDocument ? doc : undefined
    }

    private ActiveView(): Diagram | undefined
    {
        return this.ActiveDiagram()?.ActiveView
    }

    private RaiseZoomCanExecuteChanged(): void
    {
        for (const command of this._zoomCommands)
        {
            command.RaiseCanExecuteChanged()
        }
    }

    private toggleSideBar(): void
    {
        this.Provider.get(NavigationService.Key)?.ToggleSidePaneCommand.Execute()
    }

    private toggleProblems(): void
    {
        const problems = this.Provider.get(ProblemsService.Key)
        if (problems === undefined) return
        problems.IsOpen = !problems.IsOpen
    }

    // The Agent Chat dock panel is PERMANENT (ChatSessionsService.EnsurePrimary docs
    // it as "always docked... never closes"), so this command is a show/focus, not a
    // toggle: delegate to ChatSessionsService.FocusPrimary(), which mints the primary
    // on first call and brings it to front every time.
    private async showAgentChat(): Promise<void>
    {
        const chats = this.Provider.get(ChatSessionsService.Key)
        if (chats === undefined) return
        await chats.FocusPrimary()
    }
}
