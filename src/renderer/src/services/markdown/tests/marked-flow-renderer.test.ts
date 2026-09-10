import { test, expect, vi } from 'vitest'
import {
    Bold, Border, FlowDocument, Hyperlink, Image, InlineUIContainer, Italic, LineBreak,
    List, ListItem, ListMarkerStyle, Paragraph, Run, Span, Table, TextAlignment,
} from '@pragmatic-tech-ai/mural/basic'
import { BitmapImage, FontStyle, TextDecorations } from '@pragmatic-tech-ai/mural/visual-engine'
import { renderMarkdown } from '../marked-flow-renderer.js'

function blocks(md: string, ctx = {}): unknown[] { return renderMarkdown(md, ctx).Blocks.ToArray() }
function inlines(p: Paragraph): unknown[] { return p.Inlines.ToArray() }
// The inlines of the first block, treating it as a Paragraph.
function firstInlines(md: string, ctx = {}): unknown[] { return inlines(blocks(md, ctx)[0] as Paragraph) }

test('renders a FlowDocument', () => {
    expect(renderMarkdown('hi')).toBeInstanceOf(FlowDocument)
})

test('heading is sized by depth and emphasised', () => {
    const h1 = blocks('# Title')[0] as Paragraph
    const h3 = blocks('### Sub')[0] as Paragraph
    expect(h1.FontSize!).toBeGreaterThan(h3.FontSize!)
    expect(inlines(h1)[0]).toBeInstanceOf(Bold)
})

test('paragraph maps bold, italic, code chip, strikethrough', () => {
    const parts = firstInlines('a **b** _i_ `c` ~~s~~')
    expect(parts.some((x) => x instanceof Bold)).toBe(true)
    expect(parts.some((x) => x instanceof Italic)).toBe(true)
    const chip = parts.find((x) => x instanceof InlineUIContainer) as InlineUIContainer | undefined
    expect(chip?.Child).toBeInstanceOf(Border)
    const del = parts.find((x) => x instanceof Span && !(x instanceof Bold) && !(x instanceof Italic)) as Span | undefined
    expect(del).toBeDefined()
    expect(del!.TextDecorations & TextDecorations.Strikethrough).toBe(TextDecorations.Strikethrough)
})

test('link becomes a Hyperlink with uri and a working click handler', () => {
    const open = vi.fn()
    const link = firstInlines('see [docs](https://x.test/p)', { openLink: open }).find((x) => x instanceof Hyperlink) as Hyperlink
    expect(link.NavigateUri).toBe('https://x.test/p')
    link.Click?.()
    expect(open).toHaveBeenCalledWith('https://x.test/p')
})

test('soft line breaks render as spaces', () => {
    const parts = firstInlines('line one\nline two')
    expect((parts[0] as Run).Text).toBe('line one line two')
})

test('unordered list is a disc List; task items get a checkbox glyph', () => {
    const list = blocks('- a\n- [ ] todo\n- [x] done')[0] as List
    expect(list).toBeInstanceOf(List)
    expect(list.MarkerStyle).toBe(ListMarkerStyle.Disc)
    const items = list.ListItems.ToArray()
    expect(items.length).toBe(3)
    const para = (md: ListItem): Paragraph => md.Blocks.ToArray()[0] as Paragraph
    const firstRun = (md: ListItem): string => (para(md).Inlines.ToArray()[0] as Run).Text
    expect(firstRun(items[1] as ListItem)).toContain('☐')
    expect(firstRun(items[2] as ListItem)).toContain('☑')
})

test('ordered list is decimal and honours the start number', () => {
    const list = blocks('3. three\n4. four')[0] as List
    expect(list.MarkerStyle).toBe(ListMarkerStyle.Decimal)
    expect(list.StartIndex).toBe(3)
    expect(list.ListItems.ToArray().length).toBe(2)
})

test('fenced code highlights into multiple coloured runs; plain mode does not', () => {
    const hp = blocks('```js\nconst x = 1\n```')[0] as Paragraph
    expect(/mono/i.test(String(hp.FontFamily))).toBe(true)
    const hlRuns = inlines(hp).filter((x) => x instanceof Run) as Run[]
    expect(hlRuns.length).toBeGreaterThan(1)                              // split by scope
    expect(hlRuns.map((r) => r.Text).join('')).toBe('const x = 1')       // round-trips source

    const plain = blocks('```js\nconst x = 1\n```', { highlight: false })[0] as Paragraph
    expect(inlines(plain).filter((x) => x instanceof Run).length).toBe(1)
})

test('multi-line code breaks lines and preserves indentation', () => {
    const p = blocks('```\na\n    b\n```', { highlight: false })[0] as Paragraph
    const parts = inlines(p)
    expect(parts.some((x) => x instanceof LineBreak)).toBe(true)
    const runs = parts.filter((x) => x instanceof Run) as Run[]
    expect(runs.some((r) => r.Text.startsWith(' '))).toBe(true)     // NBSP-preserved indent
})

test('GFM table becomes a Table with a bold header and column alignment', () => {
    const md = ['| L | R |', '|:--|--:|', '| 1 | 2 |'].join('\n')
    const t = blocks(md)[0] as Table
    expect(t).toBeInstanceOf(Table)
    const rows = t.Rows.ToArray()
    expect(rows[0]!.IsHeader).toBe(true)
    const headerPara = rows[0]!.Cells.ToArray()[0]!.Blocks.ToArray()[0] as Paragraph
    expect(headerPara.Inlines.ToArray()[0]).toBeInstanceOf(Bold)
    const bodyCells = rows[1]!.Cells.ToArray()
    const align = (i: number): TextAlignment => (bodyCells[i]!.Blocks.ToArray()[0] as Paragraph).TextAlignment
    expect(align(0)).toBe(TextAlignment.Left)
    expect(align(1)).toBe(TextAlignment.Right)
})

test('horizontal rule renders as a hairline border in a paragraph', () => {
    const p = blocks('---')[0] as Paragraph
    const box = inlines(p).find((x) => x instanceof InlineUIContainer) as InlineUIContainer
    expect(box.Child).toBeInstanceOf(Border)
    expect((box.Child as Border).Height).toBe(1)
})

test('image renders inline when an image context is given, else falls back to alt text', () => {
    const withImg = firstInlines('![diagram](a.png)', { image: { baseDir: '', measure: async () => undefined } })
    const box = withImg.find((x) => x instanceof InlineUIContainer) as InlineUIContainer
    expect(box.Child).toBeInstanceOf(Image)

    const noImg = firstInlines('![diagram](a.png)')
    expect((noImg[0] as Run).Text).toBe('[image: diagram]')
})

test('inline raw html maps whitelisted tags and nests', () => {
    const parts = firstInlines('a <b>bold</b> c')
    expect(parts.map((x) => (x as object).constructor.name)).toEqual(['Run', 'Bold', 'Run'])
    expect(((parts[1] as Bold).Inlines.ToArray()[0] as Run).Text).toBe('bold')
})

test('block raw html strips unknown tags but keeps text', () => {
    const p = blocks('<div>kept text</div>')[0] as Paragraph
    expect(p).toBeInstanceOf(Paragraph)
    expect((inlines(p)[0] as Run).Text).toBe('kept text')
})

// The rendered image for the first block, or undefined if it isn't an SVG image.
function svgImage(md: string): { w: number; h: number; uri: string } | undefined {
    const c = inlines(blocks(md)[0] as Paragraph)[0]
    if (!(c instanceof InlineUIContainer) || !(c.Child instanceof Image)) return undefined
    const src = c.Child.Source as BitmapImage
    return { w: src.NaturalSize.Width, h: src.NaturalSize.Height, uri: src.Uri }
}

test('a ```svg fence is DRAWN at its author-set size, not shown as source', () => {
    const img = svgImage('```svg\n<svg width="512" height="512" viewBox="0 0 256 256"><path d="M0 0"/></svg>\n```')
    expect(img).toBeDefined()
    expect(img!.w).toBe(512)
    expect(img!.h).toBe(512)
    expect(img!.uri.startsWith('data:image/svg+xml')).toBe(true)
})

test('a raw <svg> block is DRAWN at its author-set size (not stripped to nothing)', () => {
    const img = svgImage('<svg width="128" height="64"><rect/></svg>')
    expect(img).toEqual(expect.objectContaining({ w: 128, h: 64 }))
})

test('a non-SVG fence is still highlighted source, not an image', () => {
    const p = blocks('```js\nconst x = 1\n```')[0] as Paragraph
    expect(inlines(p).every((x) => x instanceof Run)).toBe(true)   // code runs, no image container
})

test('blockquote renders italic and muted', () => {
    const p = blocks('> quoted')[0] as Paragraph
    expect(p.FontStyle).toBe(FontStyle.Italic)
})

test('never throws on odd or partial input', () => {
    expect(() => renderMarkdown('```\nunterminated')).not.toThrow()
    expect(() => renderMarkdown('| broken | table')).not.toThrow()
    expect(() => renderMarkdown('')).not.toThrow()
})
