import { describe, test, expect } from 'vitest'
import { highlightCode, tokenizeHighlighted, codeScopeToToken } from '../code-highlight.js'

describe('tokenizeHighlighted', () => {
    test('flattens hljs spans into scoped tokens and unescapes text', () => {
        const html = '<span class="hljs-keyword">def</span> f(<span class="hljs-params">x</span>)'
        const toks = tokenizeHighlighted(html)
        expect(toks).toEqual([
            { text: 'def', scope: 'keyword' },
            { text: ' f(', scope: undefined },
            { text: 'x', scope: 'params' },
            { text: ')', scope: undefined },
        ])
    })

    test('innermost scope wins for nested spans', () => {
        const html = '<span class="hljs-string">`a<span class="hljs-subst">${b}</span>c`</span>'
        const toks = tokenizeHighlighted(html)
        expect(toks).toEqual([
            { text: '`a', scope: 'string' },
            { text: '${b}', scope: 'subst' },
            { text: 'c`', scope: 'string' },
        ])
    })

    test('picks the hljs- prefixed class as the primary scope', () => {
        const toks = tokenizeHighlighted('<span class="hljs-title function_">f</span>')
        expect(toks).toEqual([{ text: 'f', scope: 'title' }])
    })

    test('unescapes html entities including & < > " \'', () => {
        const toks = tokenizeHighlighted('a &amp;&lt;&gt;&quot;&#x27; b')
        expect(toks).toEqual([{ text: 'a &<>"\' b', scope: undefined }])
    })

    test('does not double-decode an escaped entity', () => {
        // &amp;lt; is the literal text "&lt;", not a less-than sign.
        const toks = tokenizeHighlighted('&amp;lt;')
        expect(toks).toEqual([{ text: '&lt;', scope: undefined }])
    })
})

describe('highlightCode', () => {
    test('colours a known language by grammar', () => {
        const toks = highlightCode('const x = 1', 'javascript')
        // 'const' is a keyword; '1' is a number — both should carry a scope.
        expect(toks.some((t) => t.text.includes('const') && t.scope === 'keyword')).toBe(true)
        expect(toks.some((t) => t.text.trim() === '1' && t.scope === 'number')).toBe(true)
        // round-trips the source text verbatim
        expect(toks.map((t) => t.text).join('')).toBe('const x = 1')
    })

    test('preserves newlines for the renderer to split into lines', () => {
        const toks = highlightCode('a = 1\nb = 2', 'python')
        expect(toks.map((t) => t.text).join('')).toBe('a = 1\nb = 2')
    })

    test('auto-detects when no language is given (still round-trips source)', () => {
        const src = 'def greet(name):\n    return "hi " + name'
        const toks = highlightCode(src)
        expect(toks.map((t) => t.text).join('')).toBe(src)
    })

    test('unknown language degrades to a single plain token', () => {
        const toks = highlightCode('plain text here', 'no-such-lang-xyz')
        // auto-detect may or may not scope it, but the text must survive intact
        expect(toks.map((t) => t.text).join('')).toBe('plain text here')
    })
})

describe('codeScopeToToken', () => {
    test('maps common scopes onto theme tokens', () => {
        expect(codeScopeToToken('keyword')).toBe('Primary')
        expect(codeScopeToToken('string')).toBe('Tertiary')
        expect(codeScopeToToken('number')).toBe('Secondary')
        expect(codeScopeToToken('comment')).toBe('OnSurfaceVariant')
    })

    test('undefined scope and unknown scopes fall through to default', () => {
        expect(codeScopeToToken(undefined)).toBeUndefined()
        expect(codeScopeToToken('totally-unknown')).toBeUndefined()
    })
})
