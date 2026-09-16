// Full-scope serialization, end-to-end in the running app. Two halves:
//
//  READ  — a corpus CLONE's diagram.diagram is rewritten so its real nodes
//          (geometric shapes, an arch container card) carry the NEW brush wire
//          format: every fill variant (linear / radial / pattern / image /
//          None), a dashed round-cap stroke, and a styled shape caption. The
//          app opens it and must deserialise each one into the right live brush.
//  WRITE — an arch node is styled through the real Format channels and saved;
//          the written file must carry the semi-transparent card fill + the
//          label style.
//
// Exhaustive per-field fidelity is proven fast in Mural's DiagramDocument
// round-trip matrix; this spec proves the same format survives the real
// Plexus load → render → save pipeline. Runs against a clone so the real
// corpus is never touched.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, rectsForCtor, clickCenter, cloneCorpus, type Launched } from './plexus-app'

// A 1×1 transparent PNG — a real image source so the ImageBrush variant loads
// cleanly (no 404 noise) while still exercising image deserialization.
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// Rewrite the clone diagram so its shapes + arch container card carry the full
// brush wire format. Returns the arch node id used for the write-path test.
function injectFullScope(archDir: string): void {
    const file = path.join(archDir, 'diagram.diagram')
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
        visuals: Record<string, Record<string, unknown>>
    }
    const data = (id: string) => doc.nodes.find((n) => n.id === id)?.data
    // n8 — linear gradient fill + dashed round-cap stroke + styled caption.
    Object.assign(data('n8')!, {
        fill: { k: 'linear', stops: [{ hex: '#ffffff', at: 0 }, { hex: '#1976d2', at: 1 }], p: [0.1, 0.2, 0.8, 0.9] },
        stroke: '#111111', strokeWidth: 2, strokeDash: [2, 2], strokeCap: 'round',
        text: { content: 'Styled', color: '#ff0000', family: 'Georgia', fontSize: 18 },
    })
    // n9 — radial gradient.
    data('n9')!.fill = { k: 'radial', stops: [{ hex: '#ffffff', at: 0 }, { hex: '#1976d2', at: 1 }], c: [0.3, 0.4], r: [0.6, 0.7] }
    // n10 — pattern.
    data('n10')!.fill = { k: 'pattern', kind: 'CrossHatch', fg: '#1976d2', bg: '#eeeeee', size: 12, angle: 30, stroke: 2 }
    // n11 — image.
    data('n11')!.fill = { k: 'image', uri: PNG_1PX, stretch: 'uniformToFill' }
    // n12 — explicit None.
    data('n12')!.fill = null
    // arch container card — linear gradient in the visuals section.
    doc.visuals['on_premises']!.fill = { k: 'linear', stops: [{ hex: '#ffffff', at: 0 }, { hex: '#10b981', at: 1 }], p: [0, 0, 1, 1] }
    fs.writeFileSync(file, JSON.stringify(doc))
}

async function canvasFigs(l: Launched) {
    return (await rectsForCtor(l.win, 'Figure')).filter((f) => f.w > 60).sort((a, b) => a.y - b.y || a.x - b.x)
}

// Read back the live brush kinds the app deserialised for each seeded node.
function readLiveBrushes(l: Launched) {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let root: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v) { root = v; break } }
        let host: any
        for (let p = root?.Services; p && !host; p = p._parent) {
            for (const [, e] of (p._cache ?? new Map())) { if ((e as any)?.constructor?.name === 'DocumentsContentHostService') { host = e; break } }
        }
        const doc = host?.ActiveDocument
        const view = doc?.ActiveView
        if (!doc || !view) return { ok: false as const, reason: 'no active doc/view' }
        const items = view.ItemsSource?.ToArray ? view.ItemsSource.ToArray() : []
        const byId = new Map<string, any>(items.map((i: any) => [i?.Id, i]))
        const fillCtor = (n: any) => n?.Fill?.constructor?.name ?? null
        const n8 = byId.get('n8')
        const arch = byId.get('on_premises')
        const card = arch ? view.Generator?.ContainerFromItem(arch) : undefined
        return {
            ok: true as const,
            n8Fill: fillCtor(n8),
            n8Dash: n8?.Stroke?.DashStyle?.Dashes?.length ?? 0,
            n8Cap: n8?.Stroke?.LineCap ?? null,
            n8Text: n8?.Text?.Content ?? null,
            n8Color: n8?.Text?.Foreground?.Color?.ToHex?.() ?? null,
            n8Family: n8?.Text?.FontFamily ?? null,
            n9Fill: fillCtor(byId.get('n9')),
            n10Fill: fillCtor(byId.get('n10')),
            n11Fill: fillCtor(byId.get('n11')),
            n12Fill: byId.get('n12')?.Fill === undefined ? 'none' : fillCtor(byId.get('n12')),
            cardFill: card?.Fill?.constructor?.name ?? null,
        }
    })
}

// Style the first arch node: label font size + a semi-transparent card fill,
// through the real Format channels, then fire the dirty-gated save. Returns the
// node's id so the disk assertion targets the exact node styled.
function styleArchAndSave(l: Launched) {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let root: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v) { root = v; break } }
        let host: any
        for (let p = root?.Services; p && !host; p = p._parent) {
            for (const [, e] of (p._cache ?? new Map())) { if ((e as any)?.constructor?.name === 'DocumentsContentHostService') { host = e; break } }
        }
        const doc = host?.ActiveDocument
        const view = doc?.ActiveView
        if (!doc || !view) return { ok: false as const, reason: 'no active doc/view' }
        const items = view.ItemsSource?.ToArray ? view.ItemsSource.ToArray() : []
        // Pick an arch node whose card is a SOLID brush (on_premises has an
        // injected gradient, so its Fill has no .Color to harvest ctors from).
        let vm: any, container: any
        for (const i of items) {
            if (i?.constructor?.name !== 'ArchNodeVM') continue
            const c = view.Generator?.ContainerFromItem(i)
            if (c?.Fill?.Color?.constructor) { vm = i; container = c; break }
        }
        if (!container) return { ok: false as const, reason: 'no solid-card arch container' }
        const initialDirty = doc.IsDirty
        view.HandleContainerClick(container, 0)
        view.SelectionFontSize = 28
        const dirtyAfterFont = doc.IsDirty
        // Semi-transparent solid card fill: alpha baked into the colour so it
        // persists regardless of the channel's Opacity handling.
        const B = container.Fill.constructor, C = container.Fill.Color.constructor
        view.SelectionFormatFill = new B(C.FromHex('#ff000080'))
        const dirtyAfterFill = doc.IsDirty
        // Prove the write path directly — persist regardless of the dirty gate.
        doc.Save?.()
        return {
            ok: true as const, id: vm.Id, fontSize: vm.LabelFontSize,
            initialDirty, dirtyAfterFont, dirtyAfterFill,
        }
    })
}

test.describe.serial('full-scope serialization survives the real app', () => {
    let l: Launched
    let restore: () => void
    let cloneRoot: string
    let archDir: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        const clone = cloneCorpus()
        cloneRoot = clone.root
        archDir = clone.archDir
        injectFullScope(archDir)                       // seed the new format BEFORE launch
        restore = seedSession(clone.projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)

        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = navs[1]!.x + navs[1]!.w + 120
        for (let i = 0; i < 22; i++) {
            if (await l.win.getByText('diagram.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300); await l.win.mouse.wheel(0, 400); await l.win.waitForTimeout(300)
        }
        let figs: Awaited<ReturnType<typeof canvasFigs>> = []
        for (let a = 0; a < 5 && figs.length === 0; a++) {
            const dd = l.win.getByText('diagram.diagram', { exact: true }).first()
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(4000)
            figs = await canvasFigs(l)
        }
        expect(figs.length, 'diagram opened').toBeGreaterThan(0)
    })

    test.afterAll(async () => {
        await l.app.close().catch(() => {})
        restore?.()
        if (cloneRoot) fs.rmSync(cloneRoot, { recursive: true, force: true })
    })

    test('READ: every seeded fill variant + stroke + caption deserialises live', async () => {
        const r = await readLiveBrushes(l)
        expect(r.ok, `reached the active document: ${JSON.stringify(r)}`).toBe(true)
        if (!r.ok) return
        expect(r.n8Fill, 'shape linear gradient').toBe('LinearGradientBrush')
        expect(r.n8Dash, 'shape dashed stroke').toBeGreaterThan(0)
        expect(r.n8Cap, 'shape round line cap').toBe('round')
        expect(r.n8Text, 'shape caption text').toBe('Styled')
        expect((r.n8Color ?? '').toLowerCase(), 'shape caption colour').toBe('#ff0000')
        expect(r.n8Family, 'shape caption family').toBe('Georgia')
        expect(r.n9Fill, 'shape radial gradient').toBe('RadialGradientBrush')
        expect(r.n10Fill, 'shape pattern').toBe('PatternBrush')
        expect(r.n11Fill, 'shape image').toBe('ImageBrush')
        expect(r.n12Fill, 'shape None fill').toBe('none')
        expect(r.cardFill, 'arch container card gradient').toBe('LinearGradientBrush')
    })

    test('WRITE: styling an arch node persists card fill + label style to disk', async () => {
        const r = await styleArchAndSave(l)
        expect(r.ok, `styled the arch node: ${JSON.stringify(r)}`).toBe(true)
        if (!r.ok) return
        expect(r.fontSize, 'label font size applied').toBe(28)
        // Diagnostic: a style edit should dirty the document (dirty-gated autosave).
        expect(r.dirtyAfterFont || r.dirtyAfterFill,
            `style edit dirtied the doc (initial=${r.initialDirty} font=${r.dirtyAfterFont} fill=${r.dirtyAfterFill})`).toBe(true)

        await l.win.waitForTimeout(2000)
        const doc = JSON.parse(fs.readFileSync(path.join(archDir, 'diagram.diagram'), 'utf8')) as {
            nodes: Array<{ id: string; data: any }>; visuals: Record<string, any>
        }
        const cardFill = (doc.visuals[r.id]?.fill ?? '').toLowerCase()
        expect(cardFill, `semi-transparent card fill saved (${cardFill})`).toBe('#ff000080')
        const rec = doc.nodes.find((n) => n.id === r.id)!
        expect(rec.data?.labelStyle?.fontSize, `labelStyle.fontSize saved (${JSON.stringify(rec.data)})`).toBe(28)
    })
})
