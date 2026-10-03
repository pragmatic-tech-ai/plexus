import { test, expect, vi } from 'vitest'
import { ServiceProvider, Signal } from '@pragmatic-tech-ai/mural/runtime'
import {
    ContentHostService, Diagram, DiagramDocument, NavigationService, PanelDockService,
    type IDockPanel, type IDocument,
} from '@pragmatic-tech-ai/mural/framework'
import { ProblemsService } from '../../../modules/problems/problems-service.js'
import { ChatSessionsService } from '../../../modules/agent-chat/services/chat-sessions-service.js'
import { ViewCommandsService } from '../view-commands-service.js'

// A real class implementing just the ContentHostService.ActiveDocument surface
// ViewCommandsService consumes, with a genuine Signal so the ctor's
// subscribe-once-and-re-raise wiring is exercised for real, not mocked. Mirrors
// edit-commands-service.test.ts's fake of the same name.
class FakeDocumentsContentHostService
{
    private readonly _changed = new Signal<{ property: string }>()
    private _activeDocument: IDocument | undefined

    public constructor(activeDocument: IDocument | undefined)
    {
        this._activeDocument = activeDocument
    }

    public get ActiveDocument(): IDocument | undefined { return this._activeDocument }

    public set ActiveDocument(doc: IDocument | undefined)
    {
        this._activeDocument = doc
        this._changed.emit({ property: 'ActiveDocument' })
    }

    public PropertyChanged(_name: string): Signal<{ property: string }>
    {
        return this._changed
    }
}

// A document that is not a diagram — exercises the "non-diagram active document
// disables zoom, never throws" path.
class FakeNonDiagramDocument implements IDocument
{
    public readonly Id = 'notes-1'
    public readonly Title = 'Notes'
    public readonly IsDirty = false

    public Save(): void {}
}

// A minimal stand-in for ChatSessionsService: ViewCommandsService only calls
// FocusPrimary() — ensure the permanent "Agent Chat" dock panel exists, then
// select it — mirroring the real service's EnsurePrimary-then-SelectedPanel
// behavior against a real PanelDockService so the ensure+select is genuinely
// exercised, not just asserted by call count.
class FakeChatSessionsService
{
    public readonly panel: IDockPanel = { Id: 'agent-chat-primary', Title: 'Agent Chat' }
    public ensureCalls = 0

    public constructor(private readonly dock: PanelDockService) {}

    public async FocusPrimary(): Promise<IDockPanel>
    {
        this.ensureCalls += 1
        if (this.dock.Panels.IndexOf(this.panel) < 0) this.dock.Add(this.panel)
        this.dock.SelectedPanel = this.panel
        return this.panel
    }
}

interface Harness
{
    svc: ViewCommandsService
    host: FakeDocumentsContentHostService
    navigation: NavigationService
    problems: ProblemsService
    dock: PanelDockService
    chats: FakeChatSessionsService
}

function buildService(activeDocument: IDocument | undefined): Harness
{
    const provider = new ServiceProvider()
    const host = new FakeDocumentsContentHostService(activeDocument)
    provider.registerInstance(ContentHostService.Key, host as never)

    const navigation = new NavigationService(provider)
    provider.registerInstance(NavigationService.Key, navigation)

    const problems = new ProblemsService(provider)
    provider.registerInstance(ProblemsService.Key, problems)

    const dock = new PanelDockService(provider)
    provider.registerInstance(PanelDockService.Key, dock)

    const chats = new FakeChatSessionsService(dock)
    provider.registerInstance(ChatSessionsService.Key, chats as never)

    const svc = new ViewCommandsService(provider)
    return { svc, host, navigation, problems, dock, chats }
}

// Settles the microtask ViewCommandsService's async ShowAgentChatCommand
// (await FocusPrimary()) runs on.
function flush(): Promise<void>
{
    return new Promise((resolve) => setTimeout(resolve, 0))
}

test('zoom commands are enabled and dispatch to the active diagram view when a diagram is active', () => {
    const doc = new DiagramDocument()
    const view = new Diagram()
    const zoomIn = vi.spyOn(view, 'ZoomIn').mockImplementation(() => {})
    const zoomOut = vi.spyOn(view, 'ZoomOut').mockImplementation(() => {})
    const resetZoom = vi.spyOn(view, 'ResetZoom').mockImplementation(() => {})
    doc.ActiveView = view
    const { svc } = buildService(doc)

    expect(svc.ZoomInCommand.CanExecute()).toBe(true)
    expect(svc.ZoomOutCommand.CanExecute()).toBe(true)
    expect(svc.ResetZoomCommand.CanExecute()).toBe(true)

    svc.ZoomInCommand.Execute()
    svc.ZoomOutCommand.Execute()
    svc.ResetZoomCommand.Execute()

    expect(zoomIn).toHaveBeenCalledTimes(1)
    expect(zoomOut).toHaveBeenCalledTimes(1)
    expect(resetZoom).toHaveBeenCalledTimes(1)
})

test('zoom commands are disabled for a non-diagram active document', () => {
    const { svc } = buildService(new FakeNonDiagramDocument())
    expect(svc.ZoomInCommand.CanExecute()).toBe(false)
    expect(svc.ZoomOutCommand.CanExecute()).toBe(false)
    expect(svc.ResetZoomCommand.CanExecute()).toBe(false)
    expect(() => {
        svc.ZoomInCommand.Execute()
        svc.ZoomOutCommand.Execute()
        svc.ResetZoomCommand.Execute()
    }).not.toThrow()
})

test('zoom commands are disabled when there is no active document', () => {
    const { svc } = buildService(undefined)
    expect(svc.ZoomInCommand.CanExecute()).toBe(false)
    expect(svc.ZoomOutCommand.CanExecute()).toBe(false)
    expect(svc.ResetZoomCommand.CanExecute()).toBe(false)
})

test('zoom commands are disabled when a diagram is active but has no live view yet', () => {
    const { svc } = buildService(new DiagramDocument())
    expect(svc.ZoomInCommand.CanExecute()).toBe(false)
})

test('zoom CanExecuteChanged fires when the active document changes', () => {
    const { svc, host } = buildService(undefined)
    const listener = vi.fn()
    svc.ZoomInCommand.AddCanExecuteChangedListener(listener)

    const doc = new DiagramDocument()
    doc.ActiveView = new Diagram()
    host.ActiveDocument = doc

    expect(listener).toHaveBeenCalled()
    expect(svc.ZoomInCommand.CanExecute()).toBe(true)
})

test('dispose releases the ActiveDocument subscription so later changes do not re-raise', () => {
    const { svc, host } = buildService(undefined)
    const listener = vi.fn()
    svc.ZoomInCommand.AddCanExecuteChangedListener(listener)

    svc.dispose()
    host.ActiveDocument = new FakeNonDiagramDocument()

    expect(listener).not.toHaveBeenCalled()
})

test('ToggleSideBarCommand flips the side pane visibility both ways', () => {
    const { svc, navigation } = buildService(undefined)
    expect(navigation.SidePaneVisible).toBe(true)

    svc.ToggleSideBarCommand.Execute()
    expect(navigation.SidePaneVisible).toBe(false)

    svc.ToggleSideBarCommand.Execute()
    expect(navigation.SidePaneVisible).toBe(true)
})

test('ToggleProblemsCommand flips Problems.IsOpen both ways', () => {
    const { svc, problems } = buildService(undefined)
    expect(problems.IsOpen).toBe(false)

    svc.ToggleProblemsCommand.Execute()
    expect(problems.IsOpen).toBe(true)

    svc.ToggleProblemsCommand.Execute()
    expect(problems.IsOpen).toBe(false)
})

test('ShowAgentChatCommand ensures and selects the primary panel when it is absent', async () => {
    const { svc, dock, chats } = buildService(undefined)
    expect(dock.Panels.IndexOf(chats.panel)).toBe(-1)

    svc.ShowAgentChatCommand.Execute()
    await flush()

    expect(chats.ensureCalls).toBe(1)
    expect(dock.Panels.IndexOf(chats.panel)).toBeGreaterThanOrEqual(0)
    expect(dock.SelectedPanel).toBe(chats.panel)
})

test('ShowAgentChatCommand selects (never closes) the primary panel when it is already present', async () => {
    const { svc, dock, chats } = buildService(undefined)
    dock.Add(chats.panel)
    expect(dock.Panels.IndexOf(chats.panel)).toBeGreaterThanOrEqual(0)

    svc.ShowAgentChatCommand.Execute()
    await flush()

    expect(dock.Panels.ToArray().filter((p) => p === chats.panel)).toHaveLength(1)
    expect(dock.SelectedPanel).toBe(chats.panel)
})
