import { describe, test, expect, vi } from 'vitest'
import { Bold, Hyperlink, Italic, LineBreak, Run, Span } from '@pragmatic-tech-ai/mural/basic'
import { parseTag, HtmlTagKind, isWhitelistedTag, htmlFragmentToInlines } from '../inline-html.js'

const noop = (): void => {}

describe('parseTag', () => {
    test('parses open, close, and void forms', () => {
        expect(parseTag('<b>')).toMatchObject({ kind: HtmlTagKind.Open, name: 'b' })
        expect(parseTag('</b>')).toMatchObject({ kind: HtmlTagKind.Close, name: 'b' })
        expect(parseTag('<br>')).toMatchObject({ kind: HtmlTagKind.Void, name: 'br' })
        expect(parseTag('<br/>')).toMatchObject({ kind: HtmlTagKind.Void, name: 'br' })
    })

    test('lower-cases the tag name and reads attributes', () => {
        const tag = parseTag('<A HREF="https://x.test" title=\'t\'>')
        expect(tag).toMatchObject({ kind: HtmlTagKind.Open, name: 'a' })
        expect(tag!.attrs['href']).toBe('https://x.test')
        expect(tag!.attrs['title']).toBe('t')
    })

    test('a self-closing whitelisted-looking form is Void', () => {
        expect(parseTag('<img src="x"/>')).toMatchObject({ kind: HtmlTagKind.Void, name: 'img' })
    })

    test('returns undefined for non-tags', () => {
        expect(parseTag('not a tag')).toBeUndefined()
        expect(parseTag('< >')).toBeUndefined()
    })
})

describe('isWhitelistedTag', () => {
    test('accepts the whitelist and rejects the rest', () => {
        for (const t of ['b', 'strong', 'i', 'em', 'a', 'code', 'br']) expect(isWhitelistedTag(t)).toBe(true)
        for (const t of ['div', 'span', 'script', 'table']) expect(isWhitelistedTag(t)).toBe(false)
    })
})

describe('htmlFragmentToInlines', () => {
    test('maps <b>/<strong> to Bold with inner text', () => {
        const out = htmlFragmentToInlines('<b>hi</b>', noop)
        expect(out.length).toBe(1)
        expect(out[0]).toBeInstanceOf(Bold)
        expect((out[0] as Bold).Inlines.ToArray()[0]).toBeInstanceOf(Run)
        expect(((out[0] as Bold).Inlines.ToArray()[0] as Run).Text).toBe('hi')
    })

    test('maps <i>/<em> to Italic', () => {
        expect(htmlFragmentToInlines('<em>x</em>', noop)[0]).toBeInstanceOf(Italic)
        expect(htmlFragmentToInlines('<i>x</i>', noop)[0]).toBeInstanceOf(Italic)
    })

    test('maps <a href> to a Hyperlink carrying the uri and click handler', () => {
        const open = vi.fn()
        const out = htmlFragmentToInlines('<a href="https://x.test/p">go</a>', open)
        const link = out[0] as Hyperlink
        expect(link).toBeInstanceOf(Hyperlink)
        expect(link.NavigateUri).toBe('https://x.test/p')
        link.Click?.()
        expect(open).toHaveBeenCalledWith('https://x.test/p')
    })

    test('maps <br> to a LineBreak', () => {
        const out = htmlFragmentToInlines('a<br>b', noop)
        expect(out.map((x) => x.constructor.name)).toEqual(['Run', 'LineBreak', 'Run'])
        expect(out[1]).toBeInstanceOf(LineBreak)
    })

    test('maps <code> to a monospace Span', () => {
        const out = htmlFragmentToInlines('<code>x=1</code>', noop)
        expect(out[0]).toBeInstanceOf(Span)
        expect(/mono/i.test(String((out[0] as Span).FontFamily))).toBe(true)
    })

    test('strips a non-whitelisted tag but keeps its inner text', () => {
        const out = htmlFragmentToInlines('<div>kept</div>', noop)
        expect(out.length).toBe(1)
        expect(out[0]).toBeInstanceOf(Run)
        expect((out[0] as Run).Text).toBe('kept')
    })

    test('nests whitelisted tags and keeps text through a stripped wrapper', () => {
        const out = htmlFragmentToInlines('<div>a <b>bold</b> c</div>', noop)
        // stripped <div> flows children into root: Run('a '), Bold, Run(' c')
        expect(out.map((x) => x.constructor.name)).toEqual(['Run', 'Bold', 'Run'])
        expect((out[0] as Run).Text).toBe('a ')
        expect(((out[1] as Bold).Inlines.ToArray()[0] as Run).Text).toBe('bold')
    })

    test('decodes html entities in text', () => {
        const out = htmlFragmentToInlines('a &amp; b &lt;c&gt;', noop)
        expect((out[0] as Run).Text).toBe('a & b <c>')
    })
})
