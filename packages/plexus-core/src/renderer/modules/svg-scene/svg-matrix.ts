// A 2D affine transform [a c e ; b d f ; 0 0 1] — the SVG `matrix(a,b,c,d,e,f)`
// convention. Pure math (no DOM): parse an element's transform attribute,
// compose translate/scale, and format back. Move/resize gestures build a matrix
// here and the host writes toString() to the element's `transform`.
export class SvgMatrix
{
    public constructor(
        public readonly a: number, public readonly b: number,
        public readonly c: number, public readonly d: number,
        public readonly e: number, public readonly f: number,
    ) {}

    public static identity(): SvgMatrix { return new SvgMatrix(1, 0, 0, 1, 0, 0) }
    public static translate(dx: number, dy: number): SvgMatrix { return new SvgMatrix(1, 0, 0, 1, dx, dy) }

    // Scale by (sx,sy) about pivot (px,py): translate(px,py)·scale·translate(-px,-py).
    public static scaleAbout(sx: number, sy: number, px: number, py: number): SvgMatrix
    {
        return new SvgMatrix(sx, 0, 0, sy, px - sx * px, py - sy * py)
    }

    // this · other (apply `other` first, then `this`).
    public multiply(o: SvgMatrix): SvgMatrix
    {
        return new SvgMatrix(
            this.a * o.a + this.c * o.b,
            this.b * o.a + this.d * o.b,
            this.a * o.c + this.c * o.d,
            this.b * o.c + this.d * o.d,
            this.a * o.e + this.c * o.f + this.e,
            this.b * o.e + this.d * o.f + this.f,
        )
    }

    public apply(x: number, y: number): { x: number; y: number }
    {
        return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f }
    }

    public toString(): string { return `matrix(${this.a},${this.b},${this.c},${this.d},${this.e},${this.f})` }

    // Parse a `transform` attribute. Supports the forms our own edits emit plus
    // common author forms (translate, scale, matrix); anything else → identity so
    // an edit still composes safely (worst case, a complex author transform is
    // treated as its untransformed base — acceptable for v1 move/resize).
    public static parse(transform: string): SvgMatrix
    {
        const t = transform.trim()
        let m = SvgMatrix.identity()
        const re = /(translate|scale|matrix)\s*\(([^)]*)\)/g
        let hit: RegExpExecArray | null
        while ((hit = re.exec(t)) !== null)
        {
            const n = hit[2].split(/[ ,]+/).map(Number).filter((v) => !Number.isNaN(v))
            if (hit[1] === 'translate') m = m.multiply(SvgMatrix.translate(n[0] ?? 0, n[1] ?? 0))
            else if (hit[1] === 'scale') m = m.multiply(new SvgMatrix(n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0))
            else if (hit[1] === 'matrix' && n.length === 6) m = m.multiply(new SvgMatrix(n[0], n[1], n[2], n[3], n[4], n[5]))
        }
        return m
    }
}
