import { test, expect, beforeAll } from 'vitest'
import { Application } from '@pragmatic-tech-ai/mural/runtime'
import { Color, SolidColorBrush, TextAlignment } from '@pragmatic-tech-ai/mural/visual-engine'
import { DiagramDocument, DiagramSettings } from '@pragmatic-tech-ai/mural/framework'
import { serializerByType } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileDiagramStorage } from '../../../diagram/persistence/file-diagram-storage.js'
import { ArchNodeVM } from '../arch-node-vm.js'
import { registerArchNodeSerializer } from '../arch-node-serializer.js'

beforeAll(() => {
    Application.current = null
    new Application()
    // NOTE: intentionally NOT calling registerArchNodeSerializer() here — the
    // round-trip tests below rely purely on the module-import side-effect that
    // registers it. If someone removes that side-effect, those tests fail.
})

// Helper: build a FileDiagramStorage backed by an in-memory FakeStorage.
function makeStorage(): { diagStore: FileDiagramStorage; raw: FakeStorage } {
    const raw = new FakeStorage()
    const diagStore = new FileDiagramStorage('test.diagram', raw, null)
    return { diagStore, raw }
}

test('the arch serializer is registered at module-import time (no explicit call)', () => {
    // Guards the load-ordering fix: importing arch-node-serializer.js (done at
    // the top of this file, as the bootstrap does) is enough to register "arch"
    // — no ArchDiagramBindingService construction, no explicit call here. So a
    // diagram can Load() before the binding service exists and keep its arch
    // nodes (and their connectors) intact.
    expect(serializerByType('arch')).toBeDefined()
})

test('registerArchNodeSerializer registers type "arch" idempotently', () => {
    // Calling it explicitly (on top of the import-time registration) must not
    // throw or double-register.
    registerArchNodeSerializer()
    const s = serializerByType('arch')
    expect(s).toBeDefined()
    expect(s!.type).toBe('arch')
})

test('ArchNodeVM seeds IconSize from the shared shape-default-size setting', () => {
    // The arch icon renders at the same size as a geometric shape — both read
    // DiagramSettings.ShapeDefaultSize() at construction. With no settings host
    // the helper returns its compiled-in default (80).
    const vm = new ArchNodeVM()
    expect(vm.IconSize).toBe(DiagramSettings.ShapeDefaultSize())
})

test('ArchNodeVM serialized record carries type "arch" and empty data', () => {
    const { diagStore } = makeStorage()
    const doc = new DiagramDocument(diagStore)

    const vm = new ArchNodeVM()
    vm.Id = 'a1'
    doc.Nodes.Add(vm)

    doc.Save()

    const json = diagStore.GetItem('') as string
    const parsed = JSON.parse(json) as { nodes: Array<{ type: string; data: Record<string, unknown>; id: string }> }
    expect(parsed.nodes).toHaveLength(1)
    const record = parsed.nodes[0]
    expect(record.type).toBe('arch')
    expect(record.data).toEqual({})   // content-only; geometry rides the `visuals` section
    expect(record.id).toBe('a1')
})

test('ArchNodeVM round-trips id + content (geometry is the container/store concern)', () => {
    const { diagStore } = makeStorage()

    // Save a doc with one ArchNodeVM. Geometry is set on the container (or the
    // store) in production; here we assert the serializer round-trips id + the
    // geometry-free content — position round-trip is mural's store responsibility.
    const saveDoc = new DiagramDocument(diagStore)
    const vm = new ArchNodeVM()
    vm.Id = 'a1'
    saveDoc.Nodes.Add(vm)
    saveDoc.Save()

    // Load into a fresh doc backed by the same storage (snapshot is already set).
    const loadDoc = new DiagramDocument(diagStore)
    loadDoc.Load()

    expect(loadDoc.Nodes.Count).toBe(1)
    const reloaded = loadDoc.Nodes.Get(0)
    expect(reloaded).toBeInstanceOf(ArchNodeVM)
    const archVM = reloaded as ArchNodeVM
    expect(archVM.Id).toBe('a1')

    // Icon / label must NOT be persisted — binding re-derives them on open.
    expect(archVM.Label).toBe('')
    expect(archVM.Descriptor).toBeUndefined()
})

test('label text-style overrides round-trip; an unstyled node stays empty', () => {
    const { diagStore } = makeStorage()
    const saveDoc = new DiagramDocument(diagStore)

    const styled = new ArchNodeVM()
    styled.Id = 's1'
    styled.TextStyle.ApplyFontSize(20)
    styled.TextStyle.ApplyBold(true)
    styled.TextStyle.ApplyUnderline(true)
    styled.TextStyle.ApplyParagraphAlignment(TextAlignment.Right)
    styled.TextStyle.ApplyForeground(new SolidColorBrush(Color.FromHex('#ff0000')))

    const plain = new ArchNodeVM()
    plain.Id = 'p1'

    saveDoc.Nodes.Add(styled)
    saveDoc.Nodes.Add(plain)
    saveDoc.Save()

    // The unstyled node still serializes to bare {} — no drift for existing diagrams.
    const parsed = JSON.parse(diagStore.GetItem('') as string) as { nodes: Array<{ id: string; data: Record<string, unknown> }> }
    expect(parsed.nodes.find((n) => n.id === 'p1')!.data).toEqual({})
    expect(parsed.nodes.find((n) => n.id === 's1')!.data).toHaveProperty('labelStyle')

    const loadDoc = new DiagramDocument(diagStore)
    loadDoc.Load()
    const nodes: ArchNodeVM[] = []
    for (let i = 0; i < loadDoc.Nodes.Count; i++) nodes.push(loadDoc.Nodes.Get(i) as ArchNodeVM)

    const rs = nodes.find((n) => n.Id === 's1')!
    expect(rs.TextStyle.CurrentFontSize()).toBe(20)
    expect(rs.TextStyle.CurrentBold()).toBe(true)
    expect(rs.TextStyle.CurrentUnderline()).toBe(true)
    expect(rs.TextStyle.CurrentParagraphAlignment()).toBe(TextAlignment.Right)
    expect((rs.LabelForeground as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7)).toBe('#ff0000')

    // The unstyled node reloads with all overrides unset.
    const rp = nodes.find((n) => n.Id === 'p1')!
    expect(rp.LabelFontSize).toBeUndefined()
    expect(rp.TextStyle.CurrentFontSize()).toBe(12)
})

test('without serializer registration the node is dropped on reload', () => {
    // Simulate what would happen with no "arch" serializer:
    // we get the saved JSON and manipulate the type to something unregistered.
    const { diagStore } = makeStorage()
    const saveDoc = new DiagramDocument(diagStore)
    const vm = new ArchNodeVM()
    vm.Id = 'b1'
    saveDoc.Nodes.Add(vm)
    saveDoc.Save()

    // Corrupt the type in the stored JSON to simulate a missing serializer.
    const json = diagStore.GetItem('') as string
    const broken = json.replace('"type":"arch"', '"type":"unknown-x"')
    diagStore.SetItem('', broken)

    const loadDoc = new DiagramDocument(diagStore)
    loadDoc.Load()

    // The node should be dropped because "unknown-x" has no registered serializer.
    expect(loadDoc.Nodes.Count).toBe(0)
})
