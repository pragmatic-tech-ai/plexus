import { Brush, Color, Pen, SolidColorBrush } from '@pragmatic-tech-ai/mural/visual-engine'

// Maps between SVG paint attributes (strings) and the Format Shape sink's mural
// values (Brush for fill, Pen for stroke). Colour parsing + brush/pen conversion
// are pure (unit-tested); the read-from-live-element path uses getComputedStyle
// (host-side, e2e-covered) so named/inherited colours resolve. Writes are plain
// setAttribute — the source of truth stays the markup.
export class SvgStyle
{
    // Parse a CSS colour (#rgb, #rrggbb, rgb()/rgba()) to #rrggbb; 'none'/''/
    // 'transparent' → undefined (no paint the editor can represent).
    public static parseColorToHex(css: string): string | undefined
    {
        const s = css.trim().toLowerCase()
        if (s === '' || s === 'none' || s === 'transparent') return undefined
        if (s.startsWith('#'))
        {
            const h = s.slice(1)
            if (h.length === 3) return '#' + h.split('').map((c) => c + c).join('')
            if (h.length === 6) return '#' + h
            return undefined
        }
        const m = s.match(/rgba?\(([^)]+)\)/)
        if (m !== null)
        {
            const parts = m[1].split(',').map((p) => parseFloat(p.trim()))
            if (parts.length >= 3)
            {
                const hex = parts.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
                return '#' + hex.join('')
            }
        }
        return undefined
    }

    // ── Brush / Pen conversion (the Format Shape sink's value types) ────────

    // A solid brush from a hex colour (for ShapeFormatControl.Fill).
    public static brushFromHex(hex: string): SolidColorBrush { return new SolidColorBrush(Color.FromHex(hex)) }

    // The hex of a solid brush, or undefined for none/other brush kinds.
    public static hexFromBrush(b: Brush | undefined): string | undefined
    {
        return b instanceof SolidColorBrush ? b.Color.ToHex() : undefined
    }

    // A pen (brush + thickness) from a stroke hex + width (for ShapeFormatControl.Stroke).
    public static penFromHex(hex: string, thickness: number): Pen
    {
        return new Pen(SvgStyle.brushFromHex(hex), thickness)
    }

    // ── Attribute writes ────────────────────────────────────────────────────

    public static applyFill(el: Element, hex: string): void { el.setAttribute('fill', hex) }
    public static applyStroke(el: Element, hex: string): void { el.setAttribute('stroke', hex) }
    public static applyStrokeWidth(el: Element, n: number): void { el.setAttribute('stroke-width', String(n)) }
    public static applyOpacity(el: Element, n: number): void
    {
        el.setAttribute('opacity', String(Math.max(0, Math.min(1, n))))
    }

    // Read the element's effective paint via computed style (resolves named
    // colours, inheritance). `win` is the host window (getComputedStyle source).
    public static readComputed(el: Element, win: Window): { fill?: string; stroke?: string; strokeWidth: string; opacity: string }
    {
        const cs = win.getComputedStyle(el)
        return {
            fill: SvgStyle.parseColorToHex(cs.fill ?? ''),
            stroke: SvgStyle.parseColorToHex(cs.stroke ?? ''),
            strokeWidth: (parseFloat(cs.strokeWidth ?? '') || 0).toString(),
            opacity: (parseFloat(cs.opacity ?? '') || 1).toString(),
        }
    }
}
