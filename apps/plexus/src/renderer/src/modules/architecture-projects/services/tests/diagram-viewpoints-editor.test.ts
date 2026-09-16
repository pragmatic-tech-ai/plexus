import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService, type IDocument } from '@pragmatic-tech-ai/mural/framework'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { DiagramViewpointsEditor } from '../diagram-viewpoints-editor.js'
import type { LeavingNode } from '../viewpoint-scope-reconcile.js'

const doc = {} as IDocument

// A DialogService whose Show resolves each queued result in turn (call 1 = the
// picker, call 2 = the confirmation), so a test scripts the user's answers.
function fakeDialogs(results: unknown[]): DialogService {
    let i = 0
    return { Show: async () => results[i++], Close: () => {} } as unknown as DialogService
}

interface BindingOverrides {
    modelForDocument?: () => unknown
    scopeForDocument?: () => Set<string> | undefined
    nodesLeavingScope?: () => LeavingNode[]
    setDocumentScope?: (doc: IDocument, vps: string[]) => Promise<void>
}
function fakeBinding(over: BindingOverrides = {}): ArchDiagramBindingService {
    return {
        modelForDocument: () => ({ viewpoints: () => [{ id: 'A' }, { id: 'B' }] }),
        scopeForDocument: () => new Set(['A', 'B']),
        nodesLeavingScope: () => [],
        setDocumentScope: async () => {},
        ...over,
    } as unknown as ArchDiagramBindingService
}

function editorWith(dialogs: DialogService, binding: ArchDiagramBindingService): DiagramViewpointsEditor {
    const provider = new ServiceProvider()
    provider.registerInstance(DialogService.Key, dialogs)
    provider.registerInstance(ArchDiagramBindingService.Key, binding)
    return new DiagramViewpointsEditor(provider)
}

test('picking with nothing leaving commits the scope without a confirmation', async () => {
    const calls: string[][] = []
    const dialogs = fakeDialogs([['A']])   // only the picker is shown
    await editorWith(dialogs, fakeBinding({ setDocumentScope: async (_d, v) => { calls.push(v) } })).edit(doc)
    expect(calls).toEqual([['A']])
})

test('narrowing that drops nodes commits only after the confirmation is accepted', async () => {
    const calls: string[][] = []
    const leaving = [{ id: 'db1', label: 'DB', node: {} }] as unknown as LeavingNode[]
    const dialogs = fakeDialogs([['A'], true])   // picker → confirm(true)
    await editorWith(dialogs, fakeBinding({ nodesLeavingScope: () => leaving, setDocumentScope: async (_d, v) => { calls.push(v) } })).edit(doc)
    expect(calls).toEqual([['A']])
})

test('declining the confirmation leaves the scope unchanged', async () => {
    const calls: string[][] = []
    const leaving = [{ id: 'db1', label: 'DB', node: {} }] as unknown as LeavingNode[]
    const dialogs = fakeDialogs([['A'], false])   // picker → confirm(false)
    await editorWith(dialogs, fakeBinding({ nodesLeavingScope: () => leaving, setDocumentScope: async (_d, v) => { calls.push(v) } })).edit(doc)
    expect(calls).toEqual([])
})

test('cancelling the picker is a no-op', async () => {
    const calls: string[][] = []
    const dialogs = fakeDialogs([undefined])   // picker cancelled
    await editorWith(dialogs, fakeBinding({ setDocumentScope: async (_d, v) => { calls.push(v) } })).edit(doc)
    expect(calls).toEqual([])
})

test('a document that is not arch-bound is a no-op', async () => {
    const calls: string[][] = []
    const dialogs = fakeDialogs([['A']])
    await editorWith(dialogs, fakeBinding({ modelForDocument: () => undefined, setDocumentScope: async (_d, v) => { calls.push(v) } })).edit(doc)
    expect(calls).toEqual([])
})

test('canEdit reflects whether the document is arch-bound', () => {
    const dialogs = fakeDialogs([])
    expect(editorWith(dialogs, fakeBinding()).canEdit(doc)).toBe(true)
    expect(editorWith(dialogs, fakeBinding({ modelForDocument: () => undefined })).canEdit(doc)).toBe(false)
})
