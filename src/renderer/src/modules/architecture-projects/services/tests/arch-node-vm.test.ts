import { test, expect, beforeAll } from 'vitest'
import { Application } from '@pragmatic-tech-ai/mural/runtime'
import { ArchNodeVM } from '../arch-node-vm.js'

beforeAll(() => {
    Application.current = null
    new Application()
})

test('default Label is empty string', () => {
    const vm = new ArchNodeVM()
    expect(vm.Label).toBe('')
})

test('default Icon is undefined', () => {
    const vm = new ArchNodeVM()
    expect(vm.Icon).toBeUndefined()
})

test('carries no geometry — the container Figure owns it', () => {
    const vm = new ArchNodeVM() as unknown as Record<string, unknown>
    // Geometry (position/size + sizing mode) moved to the container Figure +
    // the document's NodeVisualStore; the VM is content + Id only.
    for (const prop of ['Left', 'Top', 'Width', 'Height', 'SizeToContent', 'UserSized']) {
        expect(vm[prop], `${prop} must not exist on a content VM`).toBeUndefined()
    }
})

test('IconSize is seeded from the shape-default-size setting', () => {
    const vm = new ArchNodeVM()
    expect(vm.IconSize).toBeGreaterThan(0)
})

test('Label setter round-trips', () => {
    const vm = new ArchNodeVM()
    vm.Label = 'My Component'
    expect(vm.Label).toBe('My Component')
})

test('Id setter round-trips and EntityId returns Id', () => {
    const vm = new ArchNodeVM()
    vm.Id = 'entity-42'
    expect(vm.Id).toBe('entity-42')
    expect(vm.EntityId).toBe('entity-42')
})

test('EntityId equals Id (default undefined)', () => {
    const vm = new ArchNodeVM()
    expect(vm.EntityId).toBe(vm.Id)
})

// ── In-place TITLE edit lifecycle (F2 / double-click) ────────────────────────
// F2 / double-click resolves to this VM (mural's resolveEditTarget duck-types on
// BeginEdit), so an arch node edits its $Label caption instead of the container
// Figure's blank ShapeText.

test('BeginEdit seeds the buffer from Label and enters edit mode', () => {
    const vm = new ArchNodeVM()
    vm.Label = 'AI Data Sources'
    vm.BeginEdit()
    expect(vm.IsEditing).toBe(true)
    expect(vm.EditingLabel).toBe('AI Data Sources')
})

test('BeginEdit is a no-op while already editing (keeps the in-progress buffer)', () => {
    const vm = new ArchNodeVM()
    vm.Label = 'Original'
    vm.BeginEdit()
    vm.EditingLabel = 'half-typed'
    vm.BeginEdit()   // must not reseed from Label
    expect(vm.EditingLabel).toBe('half-typed')
})

test('CommitEdit fires LabelCommitted with the trimmed title and leaves edit mode; Label is NOT changed locally', () => {
    const vm = new ArchNodeVM()
    vm.Label = 'Original'
    const committed: string[] = []
    vm.AddLabelCommittedListener((t) => committed.push(t))
    vm.BeginEdit()
    vm.EditingLabel = '  Renamed  '
    vm.CommitEdit()
    expect(vm.IsEditing).toBe(false)
    expect(committed).toEqual(['Renamed'])
    // The VM does not write Label itself — the binding persists to the entity and
    // rescan re-derives it. Absent a binding, Label stays as-is.
    expect(vm.Label).toBe('Original')
})

test('CommitEdit with an unchanged title does not fire (no needless model write)', () => {
    const vm = new ArchNodeVM()
    vm.Label = 'Same'
    const committed: string[] = []
    vm.AddLabelCommittedListener((t) => committed.push(t))
    vm.BeginEdit()
    vm.EditingLabel = 'Same'
    vm.CommitEdit()
    expect(vm.IsEditing).toBe(false)
    expect(committed).toEqual([])
})

test('CommitEdit with an empty title does not fire (rename-to-blank is ignored)', () => {
    const vm = new ArchNodeVM()
    vm.Label = 'Keep'
    const committed: string[] = []
    vm.AddLabelCommittedListener((t) => committed.push(t))
    vm.BeginEdit()
    vm.EditingLabel = '   '
    vm.CommitEdit()
    expect(vm.IsEditing).toBe(false)
    expect(committed).toEqual([])
})

test('a redundant CommitEdit after committing is a no-op (guards the Enter-then-LostFocus double fire)', () => {
    const vm = new ArchNodeVM()
    vm.Label = 'Original'
    const committed: string[] = []
    vm.AddLabelCommittedListener((t) => committed.push(t))
    vm.BeginEdit()
    vm.EditingLabel = 'Renamed'
    vm.CommitEdit()
    vm.CommitEdit()   // e.g. LostFocus arriving after Enter already committed
    expect(committed).toEqual(['Renamed'])
})

test('CancelEdit leaves edit mode without firing', () => {
    const vm = new ArchNodeVM()
    vm.Label = 'Original'
    const committed: string[] = []
    vm.AddLabelCommittedListener((t) => committed.push(t))
    vm.BeginEdit()
    vm.EditingLabel = 'Discarded'
    vm.CancelEdit()
    expect(vm.IsEditing).toBe(false)
    expect(committed).toEqual([])
})

test('a removed listener is not called after unsubscribe', () => {
    const vm = new ArchNodeVM()
    vm.Label = 'Original'
    const committed: string[] = []
    const off = vm.AddLabelCommittedListener((t) => committed.push(t))
    off()
    vm.BeginEdit()
    vm.EditingLabel = 'Renamed'
    vm.CommitEdit()
    expect(committed).toEqual([])
})
