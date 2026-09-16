// code-highlight.ts — turns a fenced code block into a flat list of coloured
// tokens using highlight.js, plus the scope→theme-token map the flow renderer
// paints them with.
//
// PURE and mural-free: `highlightCode` returns `{ text, scope }` spans and
// `codeScopeToToken` maps a scope to a theme token NAME (a string). The flow
// renderer owns turning those into mural Runs bound to the theme, so this module
// stays a plain string transform that unit-tests in a bare node environment.
//
// highlight.js emits HTML (`<span class="hljs-keyword">def</span>`); we re-parse
// that HTML back into tokens rather than drive its lower-level emitter API, which
// is unstable across majors. Nesting is resolved innermost-wins (the top of the
// span stack colours the text under it).
import hljs from 'highlight.js'

// One highlighted span: the literal text and the hljs scope colouring it
// (undefined = plain, uncoloured code text).
export interface HighlightToken
{
    readonly text: string
    readonly scope?: string
}

// Highlight `code` in `lang`. A known language highlights with its grammar; an
// unknown/blank language falls back to auto-detection (full-fidelity behaviour —
// most fences that omit a language are still colourable). Any highlighter error
// degrades to a single plain token so a viewer never throws on odd input.
export function highlightCode(code: string, lang?: string): HighlightToken[]
{
    try {
        const language = lang?.trim().toLowerCase()
        const html = language && hljs.getLanguage(language) !== undefined
            ? hljs.highlight(code, { language, ignoreIllegals: true }).value
            : hljs.highlightAuto(code).value
        return tokenizeHighlighted(html)
    } catch {
        return [{ text: code }]
    }
}

// Parse highlight.js HTML output into flat tokens. Maintains a scope stack so
// nested spans (e.g. a `subst` inside a `string`) colour their text with the
// innermost scope. Text between tags is HTML-unescaped; `\n` is preserved for
// the renderer to split into lines.
export function tokenizeHighlighted(html: string): HighlightToken[]
{
    const out: HighlightToken[] = []
    const stack: (string | undefined)[] = []
    const emit = (raw: string): void => {
        if (raw.length === 0) return
        out.push({ text: unescapeHtml(raw), scope: stack[stack.length - 1] })
    }

    const tag = /<span class="([^"]*)">|<\/span>/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = tag.exec(html)) !== null) {
        if (m.index > last) emit(html.slice(last, m.index))
        if (m[0].startsWith('</')) stack.pop()
        else stack.push(primaryScope(m[1]!))
        last = tag.lastIndex
    }
    if (last < html.length) emit(html.slice(last))
    return out
}

// The primary hljs scope from a class attribute: `hljs-title function_` → `title`
// (the `hljs-`-prefixed class is the semantic scope; sub-scope classes like
// `function_` refine it but we colour by the primary bucket).
function primaryScope(classAttr: string): string | undefined
{
    for (const cls of classAttr.split(/\s+/)) {
        if (cls.startsWith('hljs-')) return cls.slice(5)
    }
    return undefined
}

// hljs scope → theme token name. Buckets many scopes onto a small readable
// palette drawn from the Material theme so code colours track light/dark like the
// rest of the chrome. Unknown scope → default body colour (returned as undefined
// so the renderer uses the inherited foreground).
const SCOPE_TOKEN: Readonly<Record<string, string>> = {
    // muted — comments and docs
    comment: 'OnSurfaceVariant', quote: 'OnSurfaceVariant',
    // keywords and language machinery — the brand accent
    keyword: 'Primary', literal: 'Primary', built_in: 'Primary', type: 'Primary',
    'selector-tag': 'Primary', doctag: 'Primary', meta: 'Primary', 'meta-keyword': 'Primary',
    // strings and string-like atoms
    string: 'Tertiary', regexp: 'Tertiary', char: 'Tertiary', symbol: 'Tertiary',
    'template-tag': 'Tertiary', 'meta-string': 'Tertiary',
    // names, numbers, definitions
    number: 'Secondary', title: 'Secondary', section: 'Secondary', name: 'Secondary',
    attr: 'Secondary', attribute: 'Secondary', variable: 'Secondary',
    'template-variable': 'Secondary', params: 'Secondary', property: 'Secondary',
    // problems / removals
    deletion: 'Error',
}

// The theme token a scope paints with, or undefined for default body colour.
export function codeScopeToToken(scope: string | undefined): string | undefined
{
    if (scope === undefined) return undefined
    return SCOPE_TOKEN[scope]
}

// Reverse highlight.js's HTML escaping. `&amp;` is undone LAST so an escaped
// entity (`&amp;lt;` = literal `&lt;`) doesn't get doubly-decoded.
function unescapeHtml(s: string): string
{
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
}
