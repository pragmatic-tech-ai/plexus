import {
    Disposable, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IDisposable, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'
import {
    ContentHostService, DiagramDocument, NavigationService, PanelDockService,
    type Diagram, type DocumentsContentHostService, type IDockPanel,
} from '@pragmatic-tech-ai/mural/framework'
import { ProblemsService } from '../../modules/problems/problems-service.js'
import { ChatSessionsService } from '../../modules/agent-chat/services/chat-sessions-service.js'

// Zoom + panel-toggle commands for the main menu's View menu. Zoom bridges to
// the active diagram's live camera (ZoomIn/ZoomOut/ResetZoom), resolving
// ContentHostService → ActiveDocument → ActiveView exactly like
// zoom-shortcuts.ts / EditCommandsService; enabled only while a diagram is
// active with a mounted view. The three toggles (side bar / problems / agent
// chat) each flip a boolean (or dock membership) and stay always-enabled —
// toggling is valid whether the pane is currently shown or hidden.
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
    private readonly _toggleAgentChatCommand: ICommand
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
        this._toggleAgentChatCommand = new RelayCommand(() => { void this.toggleAgentChat() })
    }

    public get ZoomInCommand(): ICommand { return this._zoomInCommand }
    public get ZoomOutCommand(): ICommand { return this._zoomOutCommand }
    public get ResetZoomCommand(): ICommand { return this._resetZoomCommand }
    public get ToggleSideBarCommand(): ICommand { return this._toggleSideBarCommand }
    public get ToggleProblemsCommand(): ICommand { return this._toggleProblemsCommand }
    public get ToggleAgentChatCommand(): ICommand { return this._toggleAgentChatCommand }

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

    // The Agent Chat dock panel is opened today via ChatSessionsService.EnsurePrimary()
    // (called once at app startup — apps/plexus/src/renderer/src/main.js), which mints
    // the panel on first call and thereafter just hands back the same instance. Reusing
    // it here (rather than reaching into ChatSessionsService internals) gives us the
    // panel's stable identity without duplicating how it is minted — "the same Add
    // path" the brief asks for. Toggling then just flips its PanelDockService
    // membership: close it if docked, re-Add it if not.
    private async toggleAgentChat(): Promise<void>
    {
        const chats = this.Provider.get(ChatSessionsService.Key)
        const dock = this.Provider.get(PanelDockService.Key)
        if (chats === undefined || dock === undefined) return
        const panel = await chats.EnsurePrimary() as unknown as IDockPanel
        if (dock.Panels.IndexOf(panel) >= 0) dock.CloseById(panel.Id)
        else dock.Add(panel)
    }
}
