import { DomHost } from '@pragmatic-tech-ai/mural/basic'
import { DataContextBinding, MuralBase, MetaData, Size, type PropertyDescriptor } from '@pragmatic-tech-ai/mural/runtime'
import { SvgScene } from './svg-scene.js'
import { SvgEdits } from './svg-edits.js'
import { SvgHistory } from './svg-history.js'
import { HandleKind } from './handle-kind.js'
import { SvgStyle } from './svg-style.js'
import { SvgStyleProp } from './svg-style-prop.js'
import type { SvgFormatSink } from './svg-format-sink.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

// The document (source of truth) the host writes edits back to, plus the Format
// Shape sink it loads from the selection and the selection flag that drives the
// inspector rail. Cast target so the access is typed + greppable without reaching
// into unrelated internals.
interface SvgContentTarget { Content: string; SelectionStyle: SvgFormatSink; HasSelection: boolean }

// A box in the scene's viewBox user space.
interface Box { x: number; y: number; w: number; h: number }

// What a pointer gesture is currently doing.
enum GestureMode { None = 'none', Pan = 'pan', Move = 'move', Resize = 'resize', Marquee = 'marquee' }

// The visual sub-view of an SVG document: parses the document's markup into a
// live <svg> mounted inside the DomHost's <foreignObject> (which survives mural
// re-renders), and — Phase 2 — a self-contained direct-manipulation editor over
// it: select (click + marquee), move, resize, delete, with undo/redo. Every edit
// mutates the live scene then serialises back into the document's Content (the
// single source of truth); a guard stops that self-write from re-mounting.
export class SvgSceneHost extends DomHost
{
    // The markup to render, bound from the document's $Content.
    public static readonly ContentKey = MuralBase.RegisterProperty<string>(
        SvgSceneHost, 'Content', '', MetaData.None)
    // Whether the visual tab is the active one — gate parsing/rendering so a
    // hidden host does no work and picks up edits on re-activation.
    public static readonly IsActiveKey = MuralBase.RegisterProperty<boolean>(
        SvgSceneHost, 'IsActive', false, MetaData.None)

    private hostEl: HTMLElement | undefined
    private viewport: HTMLDivElement | undefined
    private errorBox: HTMLDivElement | undefined
    private mounted: SVGSVGElement | undefined
    private overlay: SVGSVGElement | undefined
    // True for width/height we added for rendering (stripped before serialise so
    // the saved markup stays clean).
    private sizedW = false
    private sizedH = false

    // View-only pan/zoom transient state.
    private scale = 1
    private panX = 0
    private panY = 0
    private currentVb: Box = { x: 0, y: 0, w: 100, h: 100 }   // last mounted scene's viewBox (for re-fit)
    private resizeObs: ResizeObserver | undefined
    private lastRendered = ' '   // impossible marker so the first render always runs

    // Editing state.
    private selected: SVGGraphicsElement[] = []
    private history = new SvgHistory('')
    // Markups we wrote ourselves (commit/undo), to distinguish our async binding
    // echoes from genuine external (text-tab) edits when they interleave.
    private authored = new Set<string>()
    // Whether we've wired the SelectionStyle VM's Edited callback (once).
    private styleWired = false

    public constructor()
    {
        super()
        this.set_property_value(SvgSceneHost.ContentKey, DataContextBinding(this, 'Content') as unknown as string)
        this.set_property_value(SvgSceneHost.IsActiveKey, DataContextBinding(this, 'IsVisualActive') as unknown as boolean)
    }

    public get Content(): string { return this.get_property_value(SvgSceneHost.ContentKey) }
    public get IsActive(): boolean { return this.get_property_value(SvgSceneHost.IsActiveKey) }

    protected override CreateHostElement(document: Document): HTMLElement
    {
        const host = super.CreateHostElement(document)
        host.style.position = 'relative'
        host.tabIndex = 0
        host.style.outline = 'none'
        this.hostEl = host

        const viewport = document.createElement('div')
        viewport.style.position = 'absolute'
        viewport.style.left = '0'
        viewport.style.top = '0'
        viewport.style.transformOrigin = '0 0'
        host.appendChild(viewport)
        this.viewport = viewport

        const errorBox = document.createElement('div')
        errorBox.style.position = 'absolute'
        errorBox.style.inset = '0'
        errorBox.style.display = 'none'
        errorBox.style.padding = '12px'
        errorBox.style.font = '12px/1.4 monospace'
        errorBox.style.whiteSpace = 'pre-wrap'
        host.appendChild(errorBox)
        this.errorBox = errorBox

        this.wireInput(host)
        this.wireKeyboard(host)
        // Re-fit when the canvas resizes (e.g. the inspector rail appears/hides on
        // selection, or the window resizes) so the whole drawing — and its selection
        // handles — stay within the available width. fit() only mutates the viewport
        // child's transform, so it never re-triggers this observer.
        const ro = new ResizeObserver(() => {
            if (this.mounted === undefined) return
            this.fit(this.currentVb)
            this.renderOverlay()
        })
        ro.observe(host)
        this.resizeObs = ro
        this.render()
        return host
    }

    // Stop observing canvas resizes (call when the host is torn down).
    public detach(): void { this.resizeObs?.disconnect(); this.resizeObs = undefined }

    // Self-materialise: touching HostElement the first time we're measured runs
    // CreateHostElement — same pattern as CodeEditor.
    protected override MeasureOverride(available: Size): Size
    {
        void this.HostElement
        return super.MeasureOverride(available)
    }

    protected override OnPropertyChanged(descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        if (descriptor.Name === 'Content' || descriptor.Name === 'IsActive') this.render()
    }

    // Binding-driven: the document's Content changed (initial load, a text-tab
    // edit, or our own echoed write). We key off content identity rather than
    // timing flags, because mural delivers the Content→host binding echo
    // asynchronously: any change equal to what we last rendered is our own echo
    // and is ignored; anything else is a genuine external edit — re-mount and
    // rebaseline undo history to it.
    private render(): void
    {
        if (this.viewport === undefined || this.errorBox === undefined) return
        if (!this.IsActive) return
        const markup = this.Content
        if (markup === this.lastRendered) return
        // Our own echoed write (commit/undo): the scene already reflects it —
        // adopt it as rendered and do not rebaseline history.
        if (this.authored.has(markup)) { this.authored.delete(markup); this.lastRendered = markup; return }
        this.lastRendered = markup
        this.mountMarkup(markup)
        this.history.reset(markup)
    }

    // Parse `markup` and (re)mount the scene + overlay; clears selection. Pure
    // rendering — no history side effects (callers own history).
    private mountMarkup(markup: string): void
    {
        if (this.viewport === undefined || this.errorBox === undefined) return
        const result = SvgScene.parse(markup)
        if ('error' in result)
        {
            this.clearScene()
            this.errorBox.textContent = 'SVG has a syntax error — fix it in the XML tab:\n\n' + result.error
            this.errorBox.style.display = 'block'
            return
        }
        this.errorBox.style.display = 'none'
        this.clearScene()
        const owner = this.viewport.ownerDocument ?? document
        const scene = owner.importNode(result.svg, true) as SVGSVGElement

        const vb = this.sceneViewBox(scene)
        this.currentVb = vb
        scene.style.position = 'absolute'
        scene.style.left = '0'
        scene.style.top = '0'
        this.sizedW = scene.getAttribute('width') === null
        this.sizedH = scene.getAttribute('height') === null
        if (this.sizedW) scene.setAttribute('width', String(vb.w))
        if (this.sizedH) scene.setAttribute('height', String(vb.h))
        this.viewport.appendChild(scene)
        this.mounted = scene

        const overlay = owner.createElementNS(SVG_NS, 'svg') as SVGSVGElement
        overlay.setAttribute('width', String(vb.w))
        overlay.setAttribute('height', String(vb.h))
        overlay.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`)
        overlay.style.position = 'absolute'
        overlay.style.left = '0'
        overlay.style.top = '0'
        overlay.style.overflow = 'visible'
        overlay.style.pointerEvents = 'none'
        this.viewport.appendChild(overlay)
        this.overlay = overlay

        this.selected = []
        this.fit(vb)
        this.renderOverlay()
        this.syncStyle()
    }

    private clearScene(): void
    {
        if (this.mounted !== undefined) { this.mounted.remove(); this.mounted = undefined }
        if (this.overlay !== undefined) { this.overlay.remove(); this.overlay = undefined }
        this.selected = []
    }

    // Serialise the (possibly edited) live scene from its clean markup — with our
    // render-only sizing stripped — so the saved SVG stays clean.
    private serializeScene(): string
    {
        const clone = (this.mounted as SVGSVGElement).cloneNode(true) as SVGSVGElement
        if (this.sizedW) clone.removeAttribute('width')
        if (this.sizedH) clone.removeAttribute('height')
        clone.removeAttribute('style')
        return SvgScene.serialize(clone)
    }

    // Commit an edit gesture: serialise the live scene back into the document's
    // Content (the source of truth) and record an undo snapshot. The scene already
    // reflects the edit, so we set lastRendered to the new markup first — the
    // asynchronous binding echo then compares equal and re-mounts nothing (no
    // selection loss, no history churn).
    private commit(): void
    {
        if (this.mounted === undefined) return
        const markup = this.serializeScene()
        this.lastRendered = markup
        this.authored.add(markup)
        const doc = this.DataContext as SvgContentTarget | undefined
        if (doc !== undefined) doc.Content = markup
        this.history.push(markup)
    }

    // Apply a history snapshot (undo/redo): re-mount it directly (a visible
    // revert) and write it to Content, WITHOUT rebaselining history. lastRendered
    // is set to the snapshot so the binding echo is a no-op.
    private applyHistory(markup: string): void
    {
        this.lastRendered = markup
        this.authored.add(markup)
        this.mountMarkup(markup)
        const doc = this.DataContext as SvgContentTarget | undefined
        if (doc !== undefined) doc.Content = markup
    }

    // The scene's viewBox (preferred) or a [0,0,w,h] box from width/height.
    private sceneViewBox(svg: SVGSVGElement): Box
    {
        const vb = svg.getAttribute('viewBox')
        if (vb !== null)
        {
            const p = vb.trim().split(/[ ,]+/).map(Number)
            if (p.length === 4 && p[2] > 0 && p[3] > 0) return { x: p[0], y: p[1], w: p[2], h: p[3] }
        }
        const w = parseFloat(svg.getAttribute('width') ?? '') || 100
        const h = parseFloat(svg.getAttribute('height') ?? '') || 100
        return { x: 0, y: 0, w, h }
    }

    // Scale the scene to fit the host box, centered; resets pan.
    private fit(vb: Box): void
    {
        const host = this.hostEl
        if (host === null || host === undefined) return
        const hw = host.clientWidth || 1
        const hh = host.clientHeight || 1
        this.scale = vb.w > 0 && vb.h > 0 ? Math.min(hw / vb.w, hh / vb.h) : 1
        this.panX = (hw - vb.w * this.scale) / 2
        this.panY = (hh - vb.h * this.scale) / 2
        this.applyTransform()
    }

    private applyTransform(): void
    {
        if (this.viewport === undefined) return
        this.viewport.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`
    }

    // ── Coordinate mapping ────────────────────────────────────────────────

    // Client (screen) point → scene viewBox user space, via the overlay's screen
    // CTM (which includes the viewport's CSS pan/zoom in Chromium).
    private clientToUser(clientX: number, clientY: number): { x: number; y: number } | null
    {
        if (this.overlay === undefined) return null
        const ctm = this.overlay.getScreenCTM()
        if (ctm === null) return null
        const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
        return { x: p.x, y: p.y }
    }

    // Screen→user scale (uniform) for sizing handles in constant screen px.
    private screenScale(): number
    {
        const ctm = this.overlay?.getScreenCTM()
        return ctm !== null && ctm !== undefined && ctm.a !== 0 ? ctm.a : this.scale
    }

    // An element's rendered AABB in viewBox space (getBBox mapped through its CTM).
    private elementBox(el: SVGGraphicsElement): Box
    {
        const bb = el.getBBox()
        const m = el.getCTM()
        if (m === null) return { x: bb.x, y: bb.y, w: bb.width, h: bb.height }
        const corners = [
            [bb.x, bb.y], [bb.x + bb.width, bb.y],
            [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height],
        ].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }))
        const xs = corners.map((c) => c.x)
        const ys = corners.map((c) => c.y)
        const minX = Math.min(...xs), maxX = Math.max(...xs)
        const minY = Math.min(...ys), maxY = Math.max(...ys)
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }

    // ── Overlay rendering ─────────────────────────────────────────────────

    // The 8 handle positions for a box, keyed by HandleKind.
    private handlePoints(b: Box): Array<{ kind: HandleKind; x: number; y: number }>
    {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = b.x + b.w, bot = b.y + b.h
        return [
            { kind: HandleKind.NW, x: b.x, y: b.y }, { kind: HandleKind.N, x: cx, y: b.y }, { kind: HandleKind.NE, x: r, y: b.y },
            { kind: HandleKind.W, x: b.x, y: cy }, { kind: HandleKind.E, x: r, y: cy },
            { kind: HandleKind.SW, x: b.x, y: bot }, { kind: HandleKind.S, x: cx, y: bot }, { kind: HandleKind.SE, x: r, y: bot },
        ]
    }

    private renderOverlay(): void
    {
        const overlay = this.overlay
        if (overlay === undefined) return
        while (overlay.firstChild !== null) overlay.removeChild(overlay.firstChild)
        if (this.selected.length === 0) return
        const owner = overlay.ownerDocument
        const px = 1 / this.screenScale()   // 1 screen px in user units

        for (const el of this.selected)
        {
            const b = this.elementBox(el)
            const outline = owner.createElementNS(SVG_NS, 'rect')
            outline.setAttribute('x', String(b.x)); outline.setAttribute('y', String(b.y))
            outline.setAttribute('width', String(b.w)); outline.setAttribute('height', String(b.h))
            outline.setAttribute('fill', 'none')
            outline.setAttribute('stroke', '#3b82f6')
            outline.setAttribute('stroke-width', String(1.5 * px))
            outline.setAttribute('stroke-dasharray', `${4 * px} ${3 * px}`)
            overlay.appendChild(outline)
        }

        if (this.selected.length === 1)
        {
            const b = this.elementBox(this.selected[0])
            const hs = 8 * px    // handle size in user units → ~8 screen px
            for (const h of this.handlePoints(b))
            {
                const rect = owner.createElementNS(SVG_NS, 'rect')
                rect.setAttribute('x', String(h.x - hs / 2)); rect.setAttribute('y', String(h.y - hs / 2))
                rect.setAttribute('width', String(hs)); rect.setAttribute('height', String(hs))
                rect.setAttribute('fill', '#ffffff'); rect.setAttribute('stroke', '#3b82f6')
                rect.setAttribute('stroke-width', String(1 * px))
                rect.setAttribute('data-handle', h.kind)
                ;(rect as SVGElement).style.pointerEvents = 'all'
                overlay.appendChild(rect)
            }
        }
    }

    // ── Style panel ───────────────────────────────────────────────────────

    private docTarget(): SvgContentTarget | undefined { return this.DataContext as SvgContentTarget | undefined }
    // The document's Format Shape sink (the ShapeFormatControl binds Fill/Stroke to it).
    private sink(): SvgFormatSink | undefined { return this.docTarget()?.SelectionStyle }

    // Push the current selection's paint into the sink, set the document's
    // HasSelection (drives the rail), and wire the sink's Edited callback once so
    // control edits flow back to the selected elements. Called whenever the
    // selection SET changes (not during a drag).
    private syncStyle(): void
    {
        const doc = this.docTarget()
        const sink = doc?.SelectionStyle
        if (doc === undefined || sink === undefined) return
        if (!this.styleWired)
        {
            sink.Edited = (prop) => this.applyStyleEdit(prop)
            this.styleWired = true
        }
        if (this.selected.length === 0)
        {
            sink.Load({ fill: undefined, stroke: undefined })
            doc.HasSelection = false
            return
        }
        doc.HasSelection = true
        const win = this.hostEl?.ownerDocument.defaultView
        if (win === null || win === undefined) return
        const v = SvgStyle.readComputed(this.selected[0], win)
        sink.Load({
            fill: SvgStyle.brushFromHex(v.fill ?? '#000000'),
            stroke: SvgStyle.penFromHex(v.stroke ?? '#000000', parseFloat(v.strokeWidth) || 1),
        })
    }

    // Apply a ShapeFormatControl edit to every selected element, then commit +
    // record history. Fill is a Brush; Stroke is a Pen (brush + thickness).
    private applyStyleEdit(prop: SvgStyleProp): void
    {
        const sink = this.sink()
        if (sink === undefined || this.selected.length === 0) return
        if (prop === SvgStyleProp.Fill)
        {
            const hex = SvgStyle.hexFromBrush(sink.Fill)
            if (hex !== undefined) for (const el of this.selected) SvgStyle.applyFill(el, hex)
        }
        else if (prop === SvgStyleProp.Stroke)
        {
            const pen = sink.Stroke
            const hex = SvgStyle.hexFromBrush(pen?.Brush)
            for (const el of this.selected)
            {
                if (hex !== undefined) SvgStyle.applyStroke(el, hex)
                if (pen !== undefined && Number.isFinite(pen.Thickness)) SvgStyle.applyStrokeWidth(el, pen.Thickness)
            }
        }
        this.commit()
    }

    // ── Input ─────────────────────────────────────────────────────────────

    private mode = GestureMode.None
    private start = { x: 0, y: 0 }        // gesture start in user space
    private panStart = { x: 0, y: 0 }     // gesture start in client px (pan)
    private panOrigin = { x: 0, y: 0 }
    private bases = new Map<SVGGraphicsElement, string>()  // per-element base transform
    private resizeHandle = HandleKind.SE
    private resizeBox: Box = { x: 0, y: 0, w: 0, h: 0 }
    private marqueeRect: SVGRectElement | undefined
    private moved = false

    private wireInput(host: HTMLElement): void
    {
        host.addEventListener('pointerdown', (e) => this.onPointerDown(e, host))
        host.addEventListener('pointermove', (e) => this.onPointerMove(e))
        host.addEventListener('pointerup', (e) => this.onPointerUp(e, host))
        host.addEventListener('wheel', (e) => this.onWheel(e, host), { passive: false })
    }

    private onPointerDown(e: PointerEvent, host: HTMLElement): void
    {
        if (!this.IsActive || this.mounted === undefined) return
        host.focus()
        host.setPointerCapture(e.pointerId)
        this.moved = false

        // Middle button → pan.
        if (e.button === 1)
        {
            this.mode = GestureMode.Pan
            this.panStart = { x: e.clientX, y: e.clientY }
            this.panOrigin = { x: this.panX, y: this.panY }
            e.preventDefault()
            return
        }
        if (e.button !== 0) return
        e.preventDefault()

        const target = e.target as Element
        const user = this.clientToUser(e.clientX, e.clientY)
        if (user === null) return
        this.start = user

        // A resize handle (only present when exactly one element is selected).
        const handle = target.getAttribute?.('data-handle')
        if (handle !== null && handle !== undefined && this.selected.length === 1)
        {
            this.mode = GestureMode.Resize
            this.resizeHandle = handle as HandleKind
            this.resizeBox = this.elementBox(this.selected[0])
            this.bases = new Map([[this.selected[0], this.selected[0].getAttribute('transform') ?? '']])
            return
        }

        // A scene element → select its top-level owner + start a move.
        const top = this.mounted !== undefined && target !== this.mounted
            ? SvgEdits.ownerTop(target, this.mounted)
            : null
        if (top !== null)
        {
            const el = top as SVGGraphicsElement
            if (e.shiftKey)
            {
                if (!this.selected.includes(el)) this.selected.push(el)
            }
            else if (!this.selected.includes(el))
            {
                this.selected = [el]
            }
            this.mode = GestureMode.Move
            this.bases = new Map(this.selected.map((s) => [s, s.getAttribute('transform') ?? '']))
            this.renderOverlay()
            this.syncStyle()
            return
        }

        // Empty background → clear selection + marquee.
        this.selected = []
        this.renderOverlay()
        this.syncStyle()
        this.mode = GestureMode.Marquee
        this.beginMarquee(user)
    }

    private onPointerMove(e: PointerEvent): void
    {
        if (this.mode === GestureMode.None) return
        if (this.mode === GestureMode.Pan)
        {
            this.panX = this.panOrigin.x + (e.clientX - this.panStart.x)
            this.panY = this.panOrigin.y + (e.clientY - this.panStart.y)
            this.applyTransform()
            return
        }
        const user = this.clientToUser(e.clientX, e.clientY)
        if (user === null) return
        const dx = user.x - this.start.x
        const dy = user.y - this.start.y
        if (dx !== 0 || dy !== 0) this.moved = true

        if (this.mode === GestureMode.Move)
        {
            for (const [el, base] of this.bases)
            {
                el.setAttribute('transform', base)
                SvgEdits.move(el, dx, dy)
                if (el.getAttribute('transform') === 'matrix(1,0,0,1,0,0)' && base === '') el.removeAttribute('transform')
            }
            this.renderOverlay()
        }
        else if (this.mode === GestureMode.Resize)
        {
            const el = this.selected[0]
            el.setAttribute('transform', this.bases.get(el) ?? '')
            SvgEdits.resize(el, this.resizeBox, this.resizeHandle, dx, dy)
            this.renderOverlay()
        }
        else if (this.mode === GestureMode.Marquee)
        {
            this.updateMarquee(this.start, user)
        }
    }

    private onPointerUp(e: PointerEvent, host: HTMLElement): void
    {
        host.releasePointerCapture(e.pointerId)
        const mode = this.mode
        this.mode = GestureMode.None
        if (mode === GestureMode.Move || mode === GestureMode.Resize)
        {
            if (this.moved) this.commit()
        }
        else if (mode === GestureMode.Marquee)
        {
            const user = this.clientToUser(e.clientX, e.clientY)
            if (user !== null) this.selectInMarquee(this.start, user)
            this.endMarquee()
            this.renderOverlay()
            this.syncStyle()
        }
    }

    private onWheel(e: WheelEvent, host: HTMLElement): void
    {
        if (!e.ctrlKey) return
        e.preventDefault()
        const rect = host.getBoundingClientRect()
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
        const ns = this.scale * factor
        this.panX = cx - (cx - this.panX) * (ns / this.scale)
        this.panY = cy - (cy - this.panY) * (ns / this.scale)
        this.scale = ns
        this.applyTransform()
        this.renderOverlay()
    }

    // ── Marquee ───────────────────────────────────────────────────────────

    private beginMarquee(user: { x: number; y: number }): void
    {
        if (this.overlay === undefined) return
        const r = this.overlay.ownerDocument.createElementNS(SVG_NS, 'rect')
        const px = 1 / this.screenScale()
        r.setAttribute('fill', 'rgba(59,130,246,0.12)')
        r.setAttribute('stroke', '#3b82f6')
        r.setAttribute('stroke-width', String(px))
        r.setAttribute('x', String(user.x)); r.setAttribute('y', String(user.y))
        r.setAttribute('width', '0'); r.setAttribute('height', '0')
        this.overlay.appendChild(r)
        this.marqueeRect = r
    }

    private updateMarquee(a: { x: number; y: number }, b: { x: number; y: number }): void
    {
        if (this.marqueeRect === undefined) return
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
        this.marqueeRect.setAttribute('x', String(x)); this.marqueeRect.setAttribute('y', String(y))
        this.marqueeRect.setAttribute('width', String(Math.abs(b.x - a.x)))
        this.marqueeRect.setAttribute('height', String(Math.abs(b.y - a.y)))
    }

    private endMarquee(): void
    {
        this.marqueeRect?.remove()
        this.marqueeRect = undefined
    }

    private selectInMarquee(a: { x: number; y: number }, b: { x: number; y: number }): void
    {
        if (this.mounted === undefined) return
        const m: Box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
        if (m.w < 1 && m.h < 1) return
        const hits: SVGGraphicsElement[] = []
        for (const child of Array.from(this.mounted.children))
        {
            const el = child as SVGGraphicsElement
            if (typeof el.getBBox !== 'function') continue
            const box = this.elementBox(el)
            const overlap = box.x < m.x + m.w && box.x + box.w > m.x && box.y < m.y + m.h && box.y + box.h > m.y
            if (overlap) hits.push(el)
        }
        this.selected = hits
    }

    // ── Keyboard ──────────────────────────────────────────────────────────

    // Keyboard is handled at the document level, not on the host: a focused div
    // inside a <foreignObject> does not reliably receive key events, so key events
    // land on <body> and bubble to the document. We gate on the visual tab being
    // active and focus being within our host (or unset) so only the active SVG
    // editor responds.
    private wireKeyboard(host: HTMLElement): void
    {
        const doc = host.ownerDocument
        doc.addEventListener('keydown', (e) => this.onKeyDown(e))
    }

    // A focused div inside a <foreignObject> doesn't reliably become
    // document.activeElement, so we can't gate on focus. Gate on visibility
    // instead: only the SVG document whose visual tab is currently on-screen
    // (this host has a non-zero box) owns the keyboard. A hidden tab (text view,
    // or a background document) collapses to a zero box and does not respond.
    private ownsKeyboard(): boolean
    {
        if (!this.IsActive || this.mounted === undefined || this.hostEl === undefined) return false
        if (!this.hostEl.isConnected) return false
        const r = this.hostEl.getBoundingClientRect()
        return r.width > 0 && r.height > 0
    }

    private onKeyDown(e: KeyboardEvent): void
    {
        if (!this.ownsKeyboard()) return

        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected.length > 0)
        {
            e.preventDefault()
            for (const el of this.selected) SvgEdits.remove(el)
            this.selected = []
            this.renderOverlay()
            this.syncStyle()
            this.commit()
            return
        }
        if (e.key === 'Escape')
        {
            this.selected = []
            this.renderOverlay()
            this.syncStyle()
            return
        }
        const ctrl = e.ctrlKey || e.metaKey
        if (ctrl && (e.key === 'z' || e.key === 'Z'))
        {
            e.preventDefault()
            const snap = e.shiftKey ? this.history.redo() : this.history.undo()
            if (snap !== undefined) this.applyHistory(snap)
            return
        }
        if (ctrl && (e.key === 'y' || e.key === 'Y'))
        {
            e.preventDefault()
            const snap = this.history.redo()
            if (snap !== undefined) this.applyHistory(snap)
        }
    }
}
