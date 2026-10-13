import { SvgMatrix } from './svg-matrix.js'
import { HandleKind } from './handle-kind.js'

// Applies edit gestures to a live scene element by composing an owned SvgMatrix
// onto its existing `transform` attribute. Pure enough to unit-test: the math is
// deterministic and the only DOM touch is get/setAttribute + remove.
export class SvgEdits
{
    // Prepend `delta` to the element's current transform and write it back.
    private static prepend(el: Element, delta: SvgMatrix): void
    {
        const base = SvgMatrix.parse(el.getAttribute('transform') ?? '')
        el.setAttribute('transform', delta.multiply(base).toString())
    }

    // Translate by (dx,dy) in user units.
    public static move(el: Element, dx: number, dy: number): void
    {
        SvgEdits.prepend(el, SvgMatrix.translate(dx, dy))
    }

    // Scale about the fixed (opposite) corner/edge for `handle`, given the current
    // box and the drag delta (dx,dy) in user units. Edge handles scale one axis.
    public static resize(el: Element, box: { x: number; y: number; w: number; h: number }, handle: HandleKind, dx: number, dy: number): void
    {
        const west = handle === HandleKind.W || handle === HandleKind.NW || handle === HandleKind.SW
        const east = handle === HandleKind.E || handle === HandleKind.NE || handle === HandleKind.SE
        const north = handle === HandleKind.N || handle === HandleKind.NE || handle === HandleKind.NW
        const south = handle === HandleKind.S || handle === HandleKind.SE || handle === HandleKind.SW

        let sx = 1, px = box.x
        if (east) { sx = box.w === 0 ? 1 : (box.w + dx) / box.w; px = box.x }
        else if (west) { sx = box.w === 0 ? 1 : (box.w - dx) / box.w; px = box.x + box.w }

        let sy = 1, py = box.y
        if (south) { sy = box.h === 0 ? 1 : (box.h + dy) / box.h; py = box.y }
        else if (north) { sy = box.h === 0 ? 1 : (box.h - dy) / box.h; py = box.y + box.h }

        SvgEdits.prepend(el, SvgMatrix.scaleAbout(sx, sy, px, py))
    }

    public static remove(el: Element): void { el.remove() }

    // The editable unit for a hit element: its ancestor that is a direct child of
    // `root` (top-level shape/group). Returns null if the hit is the root itself.
    public static ownerTop(el: Element, root: Element): Element | null
    {
        let cur: Element | null = el
        while (cur !== null && cur !== root && cur.parentNode !== root)
        {
            cur = cur.parentNode as Element | null
        }
        return cur !== null && cur !== root && cur.parentNode === root ? cur : null
    }
}
