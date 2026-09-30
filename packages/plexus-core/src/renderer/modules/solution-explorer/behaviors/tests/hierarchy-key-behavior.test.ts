import { describe, it, expect } from 'vitest'
import { Key } from '@pragmatic-tech-ai/mural/runtime'
import { HierarchyKeyBehavior } from '../hierarchy-key-behavior.js'

// A fake anchor row recording its edit-lifecycle calls.
function fakeAnchor(isEditing = false)
{
    const calls: string[] = []
    return {
        calls, IsEditing: isEditing,
        BeginEdit() { calls.push('begin') },
        CommitEdit() { calls.push('commit') },
        CancelEdit() { calls.push('cancel') },
    }
}

// A fake host+tree DataContext + a fake visual that captures the KeyDown listener.
function harness(anchor: ReturnType<typeof fakeAnchor>, selection: unknown[] = [])
{
    const deleted: unknown[] = []
    const dc = {
        Tree: { Anchor: anchor, Selection: { ToArray: () => selection } },
        Delete: (vm: unknown) => { deleted.push(vm) },
    }
    let onKey: ((a: unknown) => void) | undefined
    const visual = {
        DataContext: dc,
        AddRoutedEventListener: (name: string, fn: (a: unknown) => void) => { if (name === 'KeyDown') onKey = fn },
        RemoveRoutedEventListener: () => {},
    }
    const b = new HierarchyKeyBehavior()
    b.OnAttached(visual as never)
    const press = (key: Key) => { const args = { Key: key, Handled: false }; onKey!(args); return args }
    return { press, deleted }
}

describe('HierarchyKeyBehavior', () =>
{
    it('F2 begins edit on the anchor', () =>
    {
        const anchor = fakeAnchor()
        const { press } = harness(anchor)
        const args = press(Key.F2)
        expect(anchor.calls).toEqual(['begin'])
        expect(args.Handled).toBe(true)
    })

    it('Return commits and Escape cancels while editing', () =>
    {
        const anchor = fakeAnchor(true)
        const { press } = harness(anchor)
        press(Key.Return)
        press(Key.Escape)
        expect(anchor.calls).toEqual(['commit', 'cancel'])
    })

    it('Delete calls host.Delete ONCE with the anchor (the host deletes the whole selection under one confirm)', () =>
    {
        const anchor = fakeAnchor()
        const { press, deleted } = harness(anchor, [{}, {}])
        const args = press(Key.Delete)
        expect(deleted).toEqual([anchor])   // a single call; the host expands to the live selection
        expect(args.Handled).toBe(true)
    })

    it('Delete is inert while a rename editor is open', () =>
    {
        const { press, deleted } = harness(fakeAnchor(true), [{}])
        press(Key.Delete)
        expect(deleted).toEqual([])
    })
})
