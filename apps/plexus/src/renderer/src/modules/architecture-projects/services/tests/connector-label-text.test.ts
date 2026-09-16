import { test, expect } from 'vitest'
import { DiagramDocument, ConnectorEndpoint, flowDocumentToPlainText, type Connector } from '@pragmatic-tech-ai/mural/framework'
import { ArchNodeVM } from '../arch-node-vm.js'
import { ConnectorLabelText } from '../connector-label-text.js'

function makeConnector(): Connector {
    const doc = new DiagramDocument()
    const a = new ArchNodeVM(); a.Id = 'A'
    const b = new ArchNodeVM(); b.Id = 'B'
    doc.Nodes.Add(a); doc.Nodes.Add(b)
    const c = doc.CreateConnector(new ConnectorEndpoint({ Node: a }), new ConnectorEndpoint({ Node: b }))
    if (c === null) throw new Error('CreateConnector returned null')
    return c
}

test('rebuildMultiline gives a multiline caption a paragraph-per-line Document that keeps its breaks', () => {
    const c = makeConnector()
    c.LabelText = 'line one\nline two\nline three'
    ConnectorLabelText.rebuildMultiline(c, 'line one\nline two\nline three')

    expect(c.Text.Document).toBeDefined()
    expect(c.Text.HasRichContent).toBe(true)
    // the rebuilt paragraphs flatten back to the same newline-separated text
    expect(flowDocumentToPlainText(c.Text.Document!)).toBe('line one\nline two\nline three')
})

test('rebuildMultiline leaves a single-line caption on the plain-Content path (no Document)', () => {
    const c = makeConnector()
    c.LabelText = 'calls'
    ConnectorLabelText.rebuildMultiline(c, 'calls')

    expect(c.Text.Document).toBeUndefined()
    expect(c.Text.HasRichContent).toBe(false)
})
