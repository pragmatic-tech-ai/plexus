import { test, expect } from 'vitest'
import {
    Bold, Border, Hyperlink, InlineUIContainer, Italic, List, ListItem, ListMarkerStyle,
    Paragraph, Run, Table, TableCell, TableRow, TextAlignment,
} from '@pragmatic-tech-ai/mural/basic'
import { buildFlowDocument } from '../markdown-document.js'

// Read a block's paragraph inlines as a flat array (blocks expose ToArray).
function blocks(md: string): unknown[] { return buildFlowDocument(md).Blocks.ToArray() }
function inlines(p: Paragraph): unknown[] { return p.Inlines.ToArray() }

test('plain text becomes one paragraph with a single run', () => {
    const b = blocks('hello world')
    expect(b.length).toBe(1)
    expect(b[0]).toBeInstanceOf(Paragraph)
    const parts = inlines(b[0] as Paragraph)
    expect(parts.length).toBe(1)
    expect(parts[0]).toBeInstanceOf(Run)
    expect((parts[0] as Run).Text).toBe('hello world')
})

test('bold, italic, and inline code map to the right inlines', () => {
    const parts = inlines(blocks('a **b** c *d* `e`')[0] as Paragraph)
    expect(parts.some((x) => x instanceof Bold)).toBe(true)
    expect(parts.some((x) => x instanceof Italic)).toBe(true)
    // inline code is a chip — an InlineUIContainer wrapping a (tinted) Border
    const chip = parts.find((x) => x instanceof InlineUIContainer) as InlineUIContainer | undefined
    expect(chip).toBeDefined()
    expect(chip!.Child).toBeInstanceOf(Border)
})

test('bold body is parsed recursively', () => {
    const bold = inlines(blocks('**strong `x`**')[0] as Paragraph).find((x) => x instanceof Bold) as Bold
    expect(bold).toBeInstanceOf(Bold)
    const inner = bold.Inlines.ToArray()
    expect(inner.some((x) => x instanceof InlineUIContainer)).toBe(true)
})

test('headings are larger and emphasized', () => {
    const h1 = blocks('# Title')[0] as Paragraph
    expect(h1.FontSize).toBeGreaterThan(14)
    expect(inlines(h1)[0]).toBeInstanceOf(Bold)
    const h3 = blocks('### Sub')[0] as Paragraph
    expect(h3.FontSize).toBeGreaterThanOrEqual(14)
})

test('unordered list yields a disc List of items', () => {
    const list = blocks('- one\n- two\n- three')[0] as List
    expect(list).toBeInstanceOf(List)
    expect(list.MarkerStyle).toBe(ListMarkerStyle.Disc)
    const items = list.ListItems.ToArray()
    expect(items.length).toBe(3)
    expect(items[0]).toBeInstanceOf(ListItem)
    // each item holds a Paragraph
    expect((items[0] as ListItem).Blocks.ToArray()[0]).toBeInstanceOf(Paragraph)
})

test('ordered list is decimal and honors the start number', () => {
    const list = blocks('3. third\n4. fourth')[0] as List
    expect(list.MarkerStyle).toBe(ListMarkerStyle.Decimal)
    expect(list.StartIndex).toBe(3)
    expect(list.ListItems.ToArray().length).toBe(2)
})

test('fenced code block is a monospace paragraph preserving indentation', () => {
    const p = blocks('```\nline1\n    indented\n```')[0] as Paragraph
    expect(p).toBeInstanceOf(Paragraph)
    expect(/mono/i.test(String(p.FontFamily))).toBe(true)
    // indented line keeps its leading whitespace via non-breaking spaces
    const runs = inlines(p).filter((x) => x instanceof Run) as Run[]
    expect(runs.some((r) => r.Text.startsWith(' '))).toBe(true)
})

test('a link becomes a Hyperlink carrying its uri', () => {
    const parts = inlines(blocks('see [docs](https://example.com/x)')[0] as Paragraph)
    const link = parts.find((x) => x instanceof Hyperlink) as Hyperlink | undefined
    expect(link).toBeDefined()
    expect(link!.NavigateUri).toBe('https://example.com/x')
    expect(link!.Inlines.ToArray()[0]).toBeInstanceOf(Run)
})

test('several blocks separated by blank lines each parse', () => {
    const b = blocks('# Title\n\nA paragraph.\n\n- a\n- b')
    expect(b[0]).toBeInstanceOf(Paragraph)   // heading
    expect(b[1]).toBeInstanceOf(Paragraph)   // prose
    expect(b[2]).toBeInstanceOf(List)        // list
})

test('a paragraph directly followed by a list still splits', () => {
    const b = blocks('Intro line\n- item')
    expect(b.length).toBe(2)
    expect(b[0]).toBeInstanceOf(Paragraph)
    expect(b[1]).toBeInstanceOf(List)
})

// ── GFM tables ───────────────────────────────────────────────────────────────

const TABLE = [
    '| File | Taxonomy |',
    '|------|----------|',
    '| `enums/app.todl` | application-kind |',
    '| `enums/env.todl` | environment-kind |',
].join('\n')

function firstRowCells(t: Table): TableCell[] { return t.Rows.ToArray()[0]!.Cells.ToArray() }

test('a GFM table becomes a Table with a header row and one row per body line', () => {
    const b = blocks(TABLE)
    expect(b.length).toBe(1)
    expect(b[0]).toBeInstanceOf(Table)
    const rows = (b[0] as Table).Rows.ToArray()
    expect(rows.length).toBe(3)              // header + 2 body rows
    expect(rows[0]).toBeInstanceOf(TableRow)
    expect(rows[0]!.IsHeader).toBe(true)
    expect(rows[1]!.IsHeader).toBe(false)
    expect(rows[0]!.Cells.ToArray().length).toBe(2)
})

test('header cells are bold; body cells are not', () => {
    const t = blocks(TABLE)[0] as Table
    const headerCell = firstRowCells(t)[0]!
    const headerPara = headerCell.Blocks.ToArray()[0] as Paragraph
    expect(headerPara.Inlines.ToArray()[0]).toBeInstanceOf(Bold)

    const bodyCell = t.Rows.ToArray()[1]!.Cells.ToArray()[1]!
    const bodyPara = bodyCell.Blocks.ToArray()[0] as Paragraph
    expect(bodyPara.Inlines.ToArray().some((x) => x instanceof Bold)).toBe(false)
})

test('cell content still parses inline markup (code chips)', () => {
    const t = blocks(TABLE)[0] as Table
    const cell = t.Rows.ToArray()[1]!.Cells.ToArray()[0]!    // `enums/app.todl`
    const para = cell.Blocks.ToArray()[0] as Paragraph
    const chip = para.Inlines.ToArray().find((x) => x instanceof InlineUIContainer) as InlineUIContainer | undefined
    expect(chip).toBeDefined()
    expect(chip!.Child).toBeInstanceOf(Border)
})

test('column alignment is read from the delimiter colons', () => {
    const md = [
        '| L | C | R |',
        '|:--|:-:|--:|',
        '| a | b | c |',
    ].join('\n')
    const t = blocks(md)[0] as Table
    const cells = t.Rows.ToArray()[1]!.Cells.ToArray()
    const align = (c: TableCell): TextAlignment => (c.Blocks.ToArray()[0] as Paragraph).TextAlignment
    expect(align(cells[0]!)).toBe(TextAlignment.Left)
    expect(align(cells[1]!)).toBe(TextAlignment.Center)
    expect(align(cells[2]!)).toBe(TextAlignment.Right)
})

test('tables work with or without edge pipes and after a paragraph', () => {
    const md = [
        'Here is a table:',
        'A | B',
        '--- | ---',
        '1 | 2',
    ].join('\n')
    const b = blocks(md)
    expect(b[0]).toBeInstanceOf(Paragraph)   // prose splits off
    expect(b[1]).toBeInstanceOf(Table)
    expect((b[1] as Table).Rows.ToArray()[0]!.Cells.ToArray().length).toBe(2)
})

test('a pipe-containing sentence with no delimiter row is NOT a table', () => {
    const b = blocks('use a | b to pipe output')
    expect(b[0]).toBeInstanceOf(Paragraph)
    expect(b.some((x) => x instanceof Table)).toBe(false)
})

test('unterminated markup degrades to literal text (streaming-safe)', () => {
    // an open code fence mid-stream must not throw and should render as code
    expect(() => buildFlowDocument('```\npartial')).not.toThrow()
    // a lone ** is literal, not a dropped span
    const parts = inlines(blocks('a ** b')[0] as Paragraph)
    expect(parts.every((x) => x instanceof Run)).toBe(true)
    expect((parts[0] as Run).Text).toContain('**')
})
