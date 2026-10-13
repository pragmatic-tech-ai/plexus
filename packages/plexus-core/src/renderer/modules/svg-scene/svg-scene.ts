// The parse outcome: either the live root element, or a human-readable error
// message (malformed markup) the visual view surfaces instead of rendering.
export type SvgParseResult = { svg: SVGSVGElement } | { error: string }

// Parses/serialises SVG markup for the SVG document. The markup string is the
// document's source of truth; this class is the only place that crosses between
// that string and the live DOM the visual view manipulates. Static methods: it
// holds no state (project rule: methods on the type they belong to).
export class SvgScene
{
    private static readonly SVG_MIME = 'image/svg+xml'

    // Parse markup into a detached SVGSVGElement, or report a parse error.
    // DOMParser emits a <parsererror> element (in the result document) for
    // malformed input rather than throwing, so we detect that explicitly.
    public static parse(markup: string): SvgParseResult
    {
        const doc = new DOMParser().parseFromString(markup, SvgScene.SVG_MIME)
        const problem = doc.querySelector('parsererror')
        if (problem !== null)
        {
            return { error: problem.textContent?.trim() || 'Invalid SVG markup.' }
        }
        const root = doc.documentElement
        if (root === null || root.tagName.toLowerCase() !== 'svg')
        {
            return { error: 'Root element is not <svg>.' }
        }
        return { svg: root as unknown as SVGSVGElement }
    }

    // Serialise a (possibly edited) scene element back to markup for the source
    // of truth / text tab. XMLSerializer preserves untouched subtrees verbatim.
    public static serialize(svg: SVGSVGElement): string
    {
        return new XMLSerializer().serializeToString(svg)
    }
}
