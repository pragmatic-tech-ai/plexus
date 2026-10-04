import { test, expect, vi } from 'vitest'
import { ServiceProvider, RelayCommand, Signal } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, Diagram, DiagramDocument, type IDocument } from '@pragmatic-tech-ai/mural/framework'
import { MenuItem } from '@pragmatic-tech-ai/mural/framework/surface.js'
import { EditCommandsService } from '../edit-commands-service.js'

// A real class implementing just the ContentHostService.ActiveDocument surface
// EditCommandsService consumes, with a genuine Signal so the ctor's
// subscribe-once-and-re-raise wiring is exercised for real, not mocked.
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
// disables everything, never throws" path.
class FakeNonDiagramDocument implements IDocument
{
    public readonly Id = 'notes-1'
    public readonly Title = 'Notes'
    public readonly IsDirty = false

    public Save(): void {}
}

function buildService(host: FakeDocumentsContentHostService): EditCommandsService
{
    const provider = new ServiceProvider()
    provider.registerInstance(ContentHostService.Key, host as never)
    return new EditCommandsService(provider)
}

// Settles the microtask the diagram's edit safety-net (DiagramHistory.NotifyEdited,
// scheduled via queueMicrotask) uses to auto-commit a history transaction after an
// edit made outside an explicit Begin/Commit bracket.
function flush(): Promise<void>
{
    return new Promise((resolve) => setTimeout(resolve, 0))
}

async function diagramWithOneUndoableEdit(): Promise<DiagramDocument>
{
    const doc = new DiagramDocument()
    doc.CreateNode('rectangle', 0, 0) // marks dirty + NotifyEdited internally
    await flush()
    return doc
}

test('Undo is enabled and dispatches when the active diagram has undo history', async () => {
    const doc = await diagramWithOneUndoableEdit()
    expect(doc.History.CanUndo).toBe(true)
    const svc = buildService(new FakeDocumentsContentHostService(doc))

    expect(svc.UndoCommand.CanExecute()).toBe(true)
    svc.UndoCommand.Execute()

    expect(doc.History.CanUndo).toBe(false)
    expect(doc.Nodes.Count).toBe(0)
})

test('Undo is disabled for a non-diagram active document', () => {
    const svc = buildService(new FakeDocumentsContentHostService(new FakeNonDiagramDocument()))
    expect(svc.UndoCommand.CanExecute()).toBe(false)
})

test('all commands are disabled and inert when there is no active document', () => {
    const svc = buildService(new FakeDocumentsContentHostService(undefined))

    expect(svc.UndoCommand.CanExecute()).toBe(false)
    expect(svc.RedoCommand.CanExecute()).toBe(false)
    expect(svc.CutCommand.CanExecute()).toBe(false)
    expect(svc.CopyCommand.CanExecute()).toBe(false)
    expect(svc.PasteCommand.CanExecute()).toBe(false)

    expect(() => {
        svc.UndoCommand.Execute()
        svc.RedoCommand.Execute()
        svc.CutCommand.Execute()
        svc.CopyCommand.Execute()
        svc.PasteCommand.Execute()
    }).not.toThrow()
})

test('Redo is enabled and dispatches after an undo', async () => {
    const doc = await diagramWithOneUndoableEdit()
    doc.Undo()
    expect(doc.History.CanRedo).toBe(true)
    const svc = buildService(new FakeDocumentsContentHostService(doc))

    expect(svc.RedoCommand.CanExecute()).toBe(true)
    svc.RedoCommand.Execute()

    expect(doc.History.CanRedo).toBe(false)
    expect(doc.Nodes.Count).toBe(1)
})

test('Copy reflects the active view CopyCommand CanExecute and dispatches it', () => {
    const doc = new DiagramDocument()
    const view = new Diagram()
    let hasSelection = false
    const copySpy = vi.fn()
    view.set_property_value(Diagram.CopyCommandKey, new RelayCommand(copySpy, () => hasSelection))
    doc.ActiveView = view
    const svc = buildService(new FakeDocumentsContentHostService(doc))

    expect(svc.CopyCommand.CanExecute()).toBe(false) // no selection yet

    hasSelection = true
    expect(svc.CopyCommand.CanExecute()).toBe(true)

    svc.CopyCommand.Execute()
    expect(copySpy).toHaveBeenCalledTimes(1)
})

test('Cut reflects the active view CutCommand CanExecute and dispatches it', () => {
    const doc = new DiagramDocument()
    const view = new Diagram()
    const cutSpy = vi.fn()
    view.set_property_value(Diagram.CutCommandKey, new RelayCommand(cutSpy, () => true))
    doc.ActiveView = view
    const svc = buildService(new FakeDocumentsContentHostService(doc))

    expect(svc.CutCommand.CanExecute()).toBe(true)
    svc.CutCommand.Execute()
    expect(cutSpy).toHaveBeenCalledTimes(1)
})

test('Paste is enabled whenever a diagram is active (regardless of the view PasteCommand gate) and dispatches to it', () => {
    const doc = new DiagramDocument()
    const view = new Diagram()
    const pasteSpy = vi.fn()
    view.set_property_value(Diagram.PasteCommandKey, new RelayCommand(pasteSpy))
    doc.ActiveView = view
    const svc = buildService(new FakeDocumentsContentHostService(doc))

    expect(svc.PasteCommand.CanExecute()).toBe(true)
    svc.PasteCommand.Execute()
    expect(pasteSpy).toHaveBeenCalledTimes(1)
})

test('Paste is disabled when no diagram is active', () => {
    const svc = buildService(new FakeDocumentsContentHostService(new FakeNonDiagramDocument()))
    expect(svc.PasteCommand.CanExecute()).toBe(false)
})

test('CanExecuteChanged fires on commands when the active document changes', async () => {
    const host = new FakeDocumentsContentHostService(undefined)
    const svc = buildService(host)
    const listener = vi.fn()
    svc.UndoCommand.AddCanExecuteChangedListener(listener)

    const doc = await diagramWithOneUndoableEdit()
    host.ActiveDocument = doc

    expect(listener).toHaveBeenCalled()
})

test('dispose releases the ActiveDocument subscription so later changes do not re-raise', () => {
    const host = new FakeDocumentsContentHostService(undefined)
    const svc = buildService(host)
    const listener = vi.fn()
    svc.UndoCommand.AddCanExecuteChangedListener(listener)

    svc.dispose()
    host.ActiveDocument = new FakeNonDiagramDocument()

    expect(listener).not.toHaveBeenCalled()
})

test('a MenuItem bound to UndoCommand is disabled with no active diagram, and re-enables on CanExecuteChanged', async () => {
    const host = new FakeDocumentsContentHostService(undefined)
    const svc = buildService(host)
    const item = new MenuItem()
    item.Command = svc.UndoCommand
    expect(item.IsEnabled).toBe(false)

    host.ActiveDocument = await diagramWithOneUndoableEdit()

    expect(item.IsEnabled).toBe(true)
})
