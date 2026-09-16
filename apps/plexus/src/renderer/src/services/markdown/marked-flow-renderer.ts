// marked-flow-renderer.ts — full-fidelity markdown → mural FlowDocument.
//
// Drives marked's lexer (GFM on: tables, strikethrough, task lists, autolinks)
// and walks the token tree into a FlowDocument a RichTextBlock lays out natively.
// Unlike the pragmatic subset parser in markdown-document.ts, this covers the
// whole CommonMark+GFM grammar and adds syntax-highlighted code (highlight.js),
// inline images (local + remote), and best-effort raw-HTML mapping.
//
// PURE except for two injected side-effect seams: opening a link and loading an
// image. Both default to no-ops so the transform stays unit-testable in bare node.
import { lexer, type Token, type Tokens } from 'marked'
import {
    Bold, FlowDocument, Hyperlink, InlineUIContainer, Italic, LineBreak, List, ListItem,
    ListMarkerStyle, Paragraph, Run, Span, Table, TableCell, TableRow, TextAlignment,
    TextElement, Border,
    type Block, type Inline,
} from '@pragmatic-tech-ai/mural/basic'
import { TextDecorations, FontStyle } from '@pragmatic-tech-ai/mural/visual-engine'
import { Thickness } from '@pragmatic-tech-ai/mural/runtime'
import { highlightCode, codeScopeToToken } from './code-highlight.js'
import { parseTag, openTagInline, HtmlTagKind } from './inline-html.js'
import { createMarkdownImage, type MarkdownImageContext } from './markdown-image.js'
import { SvgInline } from './svg-inline.js'
import { MONO, HEADING_SIZE, BASE_SIZE, BODY_LINE_HEIGHT, blockGap, bindTheme, codeChip, preserveIndent } from './flow-style.js'

// Injected context for the render. All fields optional; a bare call renders text,
// emphasis, lists, tables, and code, with links/images inert.
export interface MarkdownRenderContext
{
    // Invoked when a rendered link is clicked (default no-op).
    readonly openLink?: (uri: string) => void
    // When present, images render (local paths resolve through it); when absent,
    // an image degrades to its alt text.
    readonly image?: MarkdownImageContext
    // Syntax-highlight fenced code blocks (default true).
    readonly highlight?: boolean
}

// Parse markdown into a FlowDocument.
export function renderMarkdown(markdown: string, ctx: MarkdownRenderContext = {}): FlowDocument
{
    const doc = new FlowDocument()
    let tokens: Token[]
    try {
        tokens = lexer(markdown.replace(/\r\n?/g, '\n'))
    } catch {
        // Never throw on odd input — degrade to a single plain paragraph.
        const p = new Paragraph()
        p.AddChild(new Run(markdown))
        doc.AddChild(p)
        return doc
    }
    for (const tok of tokens) {
        for (const block of blocksFor(tok, ctx)) doc.AddChild(block)
    }
    return doc
}

// ── Block level ──────────────────────────────────────────────────────────────

// A token may yield zero blocks (space), one, or several (a blockquote's inner
// paragraphs), so this always returns an array.
function blocksFor(tok: Token, ctx: MarkdownRenderContext): Block[]
{
    switch (tok.type) {
        case 'space':      return []
        case 'heading':    return [headingBlock(tok as Tokens.Heading, ctx)]
        case 'paragraph':  return paragraphBlocks(tok as Tokens.Paragraph, ctx)
        case 'text':       return [paragraphBlock(textTokenInlines(tok), ctx)]
        case 'blockquote': return quoteBlocks(tok as Tokens.Blockquote, ctx)
        case 'list':       return [listBlock(tok as Tokens.List, ctx)]
        case 'code':       return codeBlocks(tok as Tokens.Code, ctx)
        case 'table':      return [tableBlock(tok as Tokens.Table, ctx)]
        case 'hr':         return [ruleBlock()]
        case 'html':       return htmlBlock(tok as Tokens.HTML, ctx)
        default:           return []
    }
}

function headingBlock(tok: Tokens.Heading, ctx: MarkdownRenderContext): Paragraph
{
    const p = new Paragraph()
    p.FontSize = HEADING_SIZE[tok.depth - 1] ?? BASE_SIZE
    p.Margin = new Thickness(0, tok.depth <= 2 ? 8 : 4, 0, 4)
    // Bold carries the emphasis (h5/h6 that share the base size still read as
    // headings) and composes with inline markup inside the heading.
    const bold = new Bold()
    for (const inline of renderInlines(tok.tokens, ctx)) bold.AddChild(inline)
    p.AddChild(bold)
    return p
}

function paragraphBlock(inlineTokens: Token[], ctx: MarkdownRenderContext): Paragraph
{
    const p = new Paragraph()
    p.Margin = blockGap()
    p.LineHeight = BODY_LINE_HEIGHT
    for (const inline of renderInlines(inlineTokens, ctx)) p.AddChild(inline)
    return p
}

// A blockquote renders its inner blocks indented, muted, and italic — mural's
// flow blocks can't nest a bordered container, so styling stands in for the bar.
function quoteBlocks(tok: Tokens.Blockquote, ctx: MarkdownRenderContext): Block[]
{
    const out: Block[] = []
    for (const inner of tok.tokens) {
        for (const block of blocksFor(inner, ctx)) {
            block.Margin = new Thickness(12, 0, 0, 8)
            block.FontStyle = FontStyle.Italic                          // inherited by inline runs
            bindTheme(block, TextElement.ForegroundKey, 'OnSurfaceVariant')   // muted
            out.push(block)
        }
    }
    return out.length > 0 ? out : [paragraphBlock([], ctx)]
}

function listBlock(tok: Tokens.List, ctx: MarkdownRenderContext): List
{
    const list = new List()
    list.Margin = blockGap()
    list.MarkerStyle = tok.ordered ? ListMarkerStyle.Decimal : ListMarkerStyle.Disc
    if (tok.ordered && typeof tok.start === 'number') list.StartIndex = tok.start
    for (const item of tok.items) list.AddChild(listItem(item, ctx))
    return list
}

function listItem(item: Tokens.ListItem, ctx: MarkdownRenderContext): ListItem
{
    const li = new ListItem()
    const blocks: Block[] = []
    for (const inner of item.tokens) for (const b of blocksFor(inner, ctx)) blocks.push(b)
    if (blocks.length === 0) blocks.push(paragraphBlock([], ctx))

    // A task item prefixes its first paragraph with a checkbox glyph.
    if (item.task && blocks[0] instanceof Paragraph) {
        const glyph = new Run(item.checked ? '☑ ' : '☐ ')   // ☑ / ☐
        blocks[0].Inlines.Insert(0, glyph)
    }
    for (const b of blocks) li.AddChild(b)
    return li
}

// A fenced code block. An ```svg fence whose body is an actual `<svg>` element is
// DRAWN (sized to its width/height) rather than shown as source — the agent uses
// the fence to display an image; everything else is a highlighted code paragraph.
function codeBlocks(tok: Tokens.Code, ctx: MarkdownRenderContext): Block[]
{
    if ((tok.lang ?? '').trim().toLowerCase() === 'svg' && SvgInline.looksLikeSvg(tok.text)) {
        const svg = SvgInline.extract(tok.text)
        if (svg !== undefined) return [svgImageBlock(svg)]
    }
    return [codeBlock(tok, ctx)]
}

// A fenced code block — a monospace paragraph, syntax-highlighted unless disabled.
function codeBlock(tok: Tokens.Code, ctx: MarkdownRenderContext): Paragraph
{
    const p = new Paragraph()
    p.FontFamily = MONO
    p.Margin = new Thickness(8, 2, 0, 8)
    const tokens = ctx.highlight === false ? [{ text: tok.text }] : highlightCode(tok.text, tok.lang)
    emitCodeRuns(p, tokens)
    return p
}

// A paragraph that IS a raw `<svg>` (marked emits a single-line svg as a paragraph
// of inline HTML, not an html block) is DRAWN; anything else is a normal paragraph.
function paragraphBlocks(tok: Tokens.Paragraph, ctx: MarkdownRenderContext): Block[]
{
    if (SvgInline.looksLikeSvg(tok.text)) {
        const svg = SvgInline.extract(tok.text)
        if (svg !== undefined) return [svgImageBlock(svg)]
    }
    return [paragraphBlock(tok.tokens, ctx)]
}

// Block wrapping a drawn `<svg>` (from a fence or a raw HTML block). The image
// carries its own resolved size; the paragraph just gives it block spacing.
function svgImageBlock(svg: string): Paragraph
{
    const p = new Paragraph()
    p.Margin = blockGap()
    p.AddChild(SvgInline.toImage(svg))
    return p
}

// Emit highlighted tokens as coloured Runs, breaking on '\n' (LineBreak) and
// preserving each line's leading indentation.
function emitCodeRuns(p: Paragraph, tokens: readonly { text: string; scope?: string }[]): void
{
    let atLineStart = true
    for (const tok of tokens) {
        const segments = tok.text.split('\n')
        segments.forEach((seg, i) => {
            if (i > 0) { p.AddChild(new LineBreak()); atLineStart = true }
            if (seg.length === 0) return
            const text = atLineStart ? preserveIndent(seg) : seg
            atLineStart = false
            const run = new Run(text)
            const token = codeScopeToToken(tok.scope)
            if (token !== undefined) bindTheme(run, TextElement.ForegroundKey, token)
            p.AddChild(run)
        })
    }
}

function tableBlock(tok: Tokens.Table, ctx: MarkdownRenderContext): Table
{
    const table = new Table()
    table.Margin = blockGap()
    table.LastColumnFills = true
    bindTheme(table, Table.BorderBrushKey, 'OutlineVariant')
    bindTheme(table, Table.HeaderBackgroundKey, 'SurfaceContainerHigh')

    const aligns = tok.align.map(toAlignment)
    table.AddChild(tableRow(tok.header, aligns, true, ctx))
    for (const row of tok.rows) table.AddChild(tableRow(row, aligns, false, ctx))
    return table
}

function tableRow(cells: Tokens.TableCell[], aligns: TextAlignment[], header: boolean, ctx: MarkdownRenderContext): TableRow
{
    const row = new TableRow()
    row.IsHeader = header
    cells.forEach((cell, ci) => row.AddChild(tableCell(cell, aligns[ci] ?? TextAlignment.Left, header, ctx)))
    return row
}

function tableCell(cell: Tokens.TableCell, align: TextAlignment, header: boolean, ctx: MarkdownRenderContext): TableCell
{
    const td = new TableCell()
    const p = new Paragraph()
    p.LineHeight = BODY_LINE_HEIGHT
    p.TextAlignment = align
    const parsed = renderInlines(cell.tokens, ctx)
    if (header) {
        const bold = new Bold()
        for (const inline of parsed) bold.AddChild(inline)
        p.AddChild(bold)
    } else {
        for (const inline of parsed) p.AddChild(inline)
    }
    td.AddChild(p)
    return td
}

function toAlignment(a: 'left' | 'center' | 'right' | null): TextAlignment
{
    return a === 'center' ? TextAlignment.Center : a === 'right' ? TextAlignment.Right : TextAlignment.Left
}

// A horizontal rule — a fixed-width hairline embedded in a paragraph (flow blocks
// can't host a stretching Border, so the rule is a wide fixed line).
function ruleBlock(): Paragraph
{
    const p = new Paragraph()
    p.Margin = new Thickness(0, 6, 0, 10)
    const rule = new Border()
    rule.Height = 1
    rule.Width = 640
    bindTheme(rule, Border.FillKey, 'OutlineVariant')
    p.AddChild(new InlineUIContainer(rule))
    return p
}

// Block-level raw HTML — best-effort: whitelisted tags map to inlines, the rest
// strip to text, all wrapped in a paragraph. Empty result yields no block.
function htmlBlock(tok: Tokens.HTML, ctx: MarkdownRenderContext): Block[]
{
    // A raw `<svg>…</svg>` block is DRAWN (sized to its width/height) — mural
    // renders no HTML, so without this the element strips to nothing.
    const svg = SvgInline.extract(tok.text)
    if (svg !== undefined) return [svgImageBlock(svg)]
    // Reuse the inline walker: lex the fragment's own inline tokens is overkill;
    // marked already handed us the raw string, so render it as an inline HTML run
    // sequence via the shared fragment parser.
    const inlines = htmlFragmentInlines(tok.text, ctx)
    if (inlines.length === 0) return []
    const p = new Paragraph()
    p.Margin = blockGap()
    p.LineHeight = BODY_LINE_HEIGHT
    for (const inline of inlines) p.AddChild(inline)
    return [p]
}

// ── Inline level ─────────────────────────────────────────────────────────────

// Walk inline tokens into inlines. Inline raw HTML (which marked emits as separate
// per-tag tokens) is resolved with a span stack so `<b>…</b>` nests correctly.
function renderInlines(tokens: Token[] | undefined, ctx: MarkdownRenderContext): Inline[]
{
    const root: Inline[] = []
    const stack: { name: string; add: (i: Inline) => void }[] = [{ name: '', add: (i) => root.push(i) }]
    const add = (i: Inline): void => stack[stack.length - 1]!.add(i)

    const toks = tokens ?? []
    let i = 0
    while (i < toks.length) {
        const tok = toks[i]!
        // Inline <svg> arrives as a RUN of html tokens (<svg…>, <path/>, …, </svg>)
        // with any whitespace between — reassemble it and DRAW it at its set size.
        // mural renders no HTML, so otherwise the element strips to nothing (this is
        // the icon-in-a-table-cell case). Everything else falls to the switch.
        if (tok.type === 'html' && SvgInline.looksLikeSvg((tok as Tokens.HTML).text)) {
            const run = collectInlineSvg(toks, i)
            if (run !== undefined) { add(SvgInline.toImage(run.svg)); i = run.next; continue }
        }
        switch (tok.type) {
            case 'text':
                for (const i of textTokenInlinesRendered(tok, ctx)) add(i)
                break
            case 'escape':
                add(new Run((tok as Tokens.Escape).text))
                break
            case 'strong':
                add(fill(new Bold(), (tok as Tokens.Strong).tokens, ctx))
                break
            case 'em':
                add(fill(new Italic(), (tok as Tokens.Em).tokens, ctx))
                break
            case 'del': {
                const s = new Span()
                s.TextDecorations = TextDecorations.Strikethrough
                add(fill(s, (tok as Tokens.Del).tokens, ctx))
                break
            }
            case 'codespan':
                add(codeChip((tok as Tokens.Codespan).text))
                break
            case 'link': {
                const l = tok as Tokens.Link
                const link = new Hyperlink()
                link.NavigateUri = l.href
                link.Click = (): void => ctx.openLink?.(l.href)
                for (const i of renderInlines(l.tokens, ctx)) link.AddChild(i)
                add(link)
                break
            }
            case 'image':
                add(imageInline(tok as Tokens.Image, ctx))
                break
            case 'br':
                add(new LineBreak())
                break
            case 'html':
                handleInlineHtml((tok as Tokens.HTML).text, stack, ctx)
                break
            default: {
                const text = (tok as { text?: string }).text
                if (typeof text === 'string' && text.length > 0) add(new Run(softBreak(text)))
            }
        }
        i++
    }
    return root
}

// Reassemble a complete inline `<svg>…</svg>` starting at token `start`, by
// concatenating tokens' raw text until one closes the element. Returns the svg
// source and the index just past it, or undefined if no close is found.
function collectInlineSvg(toks: readonly Token[], start: number): { svg: string; next: number } | undefined
{
    let raw = ''
    for (let j = start; j < toks.length; j++) {
        raw += (toks[j] as { raw?: string }).raw ?? ''
        if (/<\/svg\s*>/i.test((toks[j] as { raw?: string }).raw ?? '')) {
            const svg = SvgInline.extract(raw)
            return svg !== undefined ? { svg, next: j + 1 } : undefined
        }
    }
    return undefined
}

// A marked 'text' token is either a leaf (its .text) or a wrapper carrying nested
// inline .tokens. This yields the leaf/nested inlines for the RENDER path.
function textTokenInlinesRendered(tok: Token, ctx: MarkdownRenderContext): Inline[]
{
    const t = tok as Tokens.Text
    if (t.tokens !== undefined && t.tokens.length > 0) return renderInlines(t.tokens, ctx)
    return [new Run(softBreak(t.text))]
}

// The inline TOKEN list of a block-level 'text' token (list items / loose text),
// for feeding paragraphBlock.
function textTokenInlines(tok: Token): Token[]
{
    const t = tok as Tokens.Text
    return t.tokens !== undefined && t.tokens.length > 0 ? t.tokens : [{ type: 'text', raw: t.text, text: t.text } as Token]
}

function imageInline(tok: Tokens.Image, ctx: MarkdownRenderContext): Inline
{
    if (ctx.image !== undefined) return createMarkdownImage(tok.href, tok.text, ctx.image)
    const alt = tok.text.length > 0 ? tok.text : tok.href
    return new Run(`[image: ${alt}]`)
}

// Fill a span with rendered children and return it.
function fill(span: Span, tokens: Token[], ctx: MarkdownRenderContext): Span
{
    for (const i of renderInlines(tokens, ctx)) span.AddChild(i)
    return span
}

// Drive the inline-HTML span stack for one html token (a single tag).
function handleInlineHtml(raw: string, stack: { name: string; add: (i: Inline) => void }[], ctx: MarkdownRenderContext): void
{
    const tag = parseTag(raw)
    if (tag === undefined) { stack[stack.length - 1]!.add(new Run(raw)); return }
    if (tag.kind === HtmlTagKind.Void) {
        if (tag.name === 'br') stack[stack.length - 1]!.add(new LineBreak())
        return
    }
    if (tag.kind === HtmlTagKind.Open) {
        const span = openTagInline(tag, (uri) => ctx.openLink?.(uri))
        if (span !== undefined) {
            stack[stack.length - 1]!.add(span)
            stack.push({ name: tag.name, add: (i) => span.AddChild(i) })
        } else {
            const parent = stack[stack.length - 1]!
            stack.push({ name: tag.name, add: parent.add })   // stripped: children flow up
        }
        return
    }
    // Close — pop to the matching open.
    for (let k = stack.length - 1; k > 0; k -= 1) {
        if (stack[k]!.name === tag.name) { stack.length = k; break }
    }
}

// Best-effort inlines from a whole raw-html fragment (block html). Delegates to
// the same stack logic by lexing the fragment into tag/text pieces.
function htmlFragmentInlines(html: string, ctx: MarkdownRenderContext): Inline[]
{
    const root: Inline[] = []
    const stack: { name: string; add: (i: Inline) => void }[] = [{ name: '', add: (i) => root.push(i) }]
    const re = /<[^>]+>/g
    let last = 0
    let m: RegExpExecArray | null
    const addText = (raw: string): void => {
        const text = decodeEntities(raw)
        if (text.length > 0) stack[stack.length - 1]!.add(new Run(text))
    }
    while ((m = re.exec(html)) !== null) {
        if (m.index > last) addText(html.slice(last, m.index))
        if (parseTag(m[0]) !== undefined) handleInlineHtml(m[0], stack, ctx)
        else addText(m[0])
        last = re.lastIndex
    }
    if (last < html.length) addText(html.slice(last))
    return root
}

// Soft line breaks (a bare '\n' inside a text run) render as a space, per CommonMark.
function softBreak(text: string): string { return text.replace(/\n/g, ' ') }

function decodeEntities(s: string): string
{
    return s
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
}
