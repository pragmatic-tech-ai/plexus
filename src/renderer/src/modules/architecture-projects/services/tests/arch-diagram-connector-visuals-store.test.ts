import { test, expect } from 'vitest'
import { DiagramDocument, ConnectorEndpoint, Connector } from '@pragmatic-tech-ai/mural/framework'
import { SolidColorBrush, Color, FontWeight, FontStyle, TextAlignment } from '@pragmatic-tech-ai/mural/visual-engine'
import { Panel, Point } from '@pragmatic-tech-ai/mural/runtime'
import { ArchNodeVM } from '../arch-node-vm.js'
import { captureConnectorVisual, applyConnectorVisual, writeConnectorVisual, readConnectorVisuals } from '../arch-diagram-connector-visuals-store.js'

// A real projected connector between two arch nodes (as ArchDiagramBinding.projectEdges
// builds them) so capture/apply exercise a genuine Connector + its ShapeText label.
function makeConnector(): { doc: DiagramDocument; c: Connector } {
    const doc = new DiagramDocument()
    const a = new ArchNodeVM(); a.Id = 'A'
    const b = new ArchNodeVM(); b.Id = 'B'
    doc.Nodes.Add(a); doc.Nodes.Add(b)
    const c = doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))
    if (c === null) throw new Error('CreateConnector returned null')
    return { doc, c }
}

test('captureConnectorVisual omits the label when it is unstyled and unmoved', () => {
    const { c } = makeConnector()
    expect(captureConnectorVisual(c).label).toBeUndefined()
})

test('captures label text-style, position and offset, and restores them onto a fresh connector', () => {
    const { c } = makeConnector()
    c.Text.FontSize = 20
    c.Text.FontWeight = FontWeight.Bold
    c.Text.FontStyle = FontStyle.Italic
    c.Text.Foreground = new SolidColorBrush(Color.FromHex('#ff0000'))
    c.Text.TextAlignment = TextAlignment.Right
    c.LabelPosition = 0.25
    c.Text.Offset = new Point(4, -6)

    const v = captureConnectorVisual(c)
    expect(v.label).toBeDefined()
    expect(v.label!.position).toBe(0.25)
    expect(v.label!.offsetX).toBe(4)
    expect(v.label!.offsetY).toBe(-6)
    expect(v.label!.style).toMatchObject({
        fontSize: 20, fontWeight: FontWeight.Bold, fontStyle: FontStyle.Italic,
        foreground: '#ff0000', textAlignment: TextAlignment.Right,
    })

    const { c: c2 } = makeConnector()
    applyConnectorVisual(c2, v)
    expect(c2.Text.FontSize).toBe(20)
    expect(c2.Text.FontWeight).toBe(FontWeight.Bold)
    expect(c2.Text.FontStyle).toBe(FontStyle.Italic)
    expect((c2.Text.Foreground as SolidColorBrush).Color.ToHex()).toBe('#ff0000')
    expect(c2.Text.TextAlignment).toBe(TextAlignment.Right)
    expect(c2.LabelPosition).toBe(0.25)
    expect(c2.Text.Offset.X).toBe(4)
    expect(c2.Text.Offset.Y).toBe(-6)
})

test('a label-only visual is persisted through the metadata bag (not dropped as empty)', () => {
    const { doc, c } = makeConnector()
    c.Text.FontStyle = FontStyle.Italic
    writeConnectorVisual(doc, 'A|calls|B', captureConnectorVisual(c))
    expect(readConnectorVisuals(doc)['A|calls|B']?.label?.style).toMatchObject({ fontStyle: FontStyle.Italic })
})

test('a default-behind connector stores no zIndex; a reordered one round-trips', () => {
    const { c } = makeConnector()
    // Behind-figures default → omitted (materializer re-stamps it on load).
    Panel.SetZIndex(c, Connector.DefaultZIndex)
    expect(captureConnectorVisual(c).zIndex).toBeUndefined()

    // Reordered (Bring-to-Front / Send-to-Back renumbers the stack) → stored + restored.
    Panel.SetZIndex(c, 3)
    const v = captureConnectorVisual(c)
    expect(v.zIndex).toBe(3)

    const { c: c2 } = makeConnector()
    applyConnectorVisual(c2, v)
    expect(Panel.GetZIndex(c2)).toBe(3)
})

test('a z-order-only visual is persisted through the metadata bag (not dropped as empty)', () => {
    const { doc, c } = makeConnector()
    Panel.SetZIndex(c, 2)
    writeConnectorVisual(doc, 'A|calls|B', captureConnectorVisual(c))
    expect(readConnectorVisuals(doc)['A|calls|B']?.zIndex).toBe(2)
})
