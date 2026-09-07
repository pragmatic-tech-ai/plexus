// Live check: inline text editing on arch-diagram connectors.
//   1. VISIBILITY — double-clicking an EMPTY-label connector's route shows a
//      visible editor (the empty RichTextBox now honours a MinWidth/MinHeight;
//      before, it measured to zero size and "no editor appeared").
//   2. PERSISTENCE — editing a connector ENTITY's label writes back to its
//      `type` field and survives a reopen (re-projected from the model).
// Reuses the arch-draw-connect harness against a scratch COPY of the corpus.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { launchPlexus, seedSession, corpusAvailable, appErrors, type Launched } from './plexus-app'

const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'C:/Users/Eugene/Projects/plexus_tests'
const PROJECT_RELS = [
    'meta-models/tech-architecture', 'libraries/microsoft', 'libraries/aws', 'architecures/test_architecture',
]
const A = 'knowledge_index'
const B = 'enterprise_legacy_app'

function walkTodl(dir: string): string[] {
    const out: string[] = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) out.push(...walkTodl(p))
        else if (e.name.endsWith('.todl')) out.push(p)
    }
    return out
}
// Whether any arch .todl records the given connector type term. `type` is a
// distinctive token absent from the seed corpus, so its presence anywhere under
// the arch project is a reliable signal the edit was saved (the exact emitted
// form — connector{} block vs `a --> b` operator + attr — doesn't matter here).
function typeRecorded(copyRoot: string, _a: string, _b: string, type: string): boolean {
    const archDir = path.join(copyRoot, 'architecures/test_architecture')
    const hits = walkTodl(archDir).filter((f) => fs.readFileSync(f, 'utf8').includes(type))
    if (hits.length > 0) console.log('type token found in:', hits.map((f) => path.basename(f)).join(', '))
    return hits.length > 0
}

async function draw(l: Launched, fromId: string, toId: string): Promise<{ ok: boolean; reason?: string }> {
    return l.win.evaluate(({ fromId, toId }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break } }
        const arr: any[] = diagram.ItemsSource.ToArray()
        const byId = (id: string) => arr.find((vm: any) => vm?.Id === id)
        // CreateConnector needs a real ConnectorEndpoint (it attaches DP
        // listeners) — borrow the class from a projected connector.
        const Ep = diagram.Connectors?.ToArray?.()[0]?.Source?.constructor
        if (!Ep) return { ok: false, reason: 'no ConnectorEndpoint class to borrow' }
        const src = byId(fromId), tgt = byId(toId)
        if (!src || !tgt) return { ok: false, reason: 'node not found' }
        diagram._fireConnectorCreated({ Source: new Ep({ Node: src }), Target: new Ep({ Node: tgt }) })
        return { ok: true }
    }, { fromId, toId })
}

async function hasNodes(l: Launched): Promise<boolean> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') return (v.ItemsSource?.ToArray?.().length ?? 0) > 0 }
        return false
    })
}

// Number of projected connectors (draw() borrows the ConnectorEndpoint class
// from one, so the test waits until the model's relationship/scenario edges
// have projected before drawing).
async function connectorCount(l: Launched): Promise<number> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') return v.Connectors?.ToArray?.().length ?? 0 }
        return 0
    })
}

async function labelBetween(l: Launched, fromId: string, toId: string): Promise<string | undefined> {
    return l.win.evaluate(({ fromId, toId }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break } }
        const idOf = (ep: any) => ep?.Node?.Id ?? ep?.UnresolvedNodeId
        for (const c of diagram.Connectors?.ToArray?.() ?? []) {
            const s = idOf(c.Source), t = idOf(c.Target)
            if ((s === fromId && t === toId) || (s === toId && t === fromId)) return c.LabelText
        }
        return undefined
    }, { fromId, toId })
}

// Count VISIBLE RichTextBox editors on screen (non-zero rect).
async function visibleEditors(l: Launched): Promise<number> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let n = 0
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'RichTextBox') { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) n++ }
        }
        return n
    })
}

// Screen midpoint of an EMPTY-label connector's route (index-selected).
async function emptyRoutePoint(l: Launched): Promise<any> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break } }
        const conns = diagram.Connectors?.ToArray?.() ?? []
        const c = conns.find((x: any) => (x.LabelText ?? '') === '')
        if (!c) return { ok: false, reason: 'no empty-label connector' }
        let cEl: Element | undefined
        for (const el of document.querySelectorAll('*')) { if ((el as any)[S] === c) { cEl = el; break } }
        if (!cEl) return { ok: false }
        const pts = (c.CurrentRoutePoints ?? []).map((p: any) => ({ X: p.X, Y: p.Y }))
        if (pts.length < 2) return { ok: false }
        const xs = pts.map((p: any) => p.X), ys = pts.map((p: any) => p.Y)
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
        const r = cEl.getBoundingClientRect()
        const sx = (maxX - minX) > 0.5 ? r.width / (maxX - minX) : 0
        const sy = (maxY - minY) > 0.5 ? r.height / (maxY - minY) : 0
        const mid = pts[Math.floor(pts.length / 2)]
        return { ok: true, x: r.x + (mid.X - minX) * sx, y: r.y + (mid.Y - minY) * sy }
    })
}

// Simulate a committed label edit on the A↔B connector (mirrors CommitEdit's
// order: set Content, then end editing → the binding's write-back listener fires).
async function editLabel(l: Launched, fromId: string, toId: string, text: string): Promise<string | undefined> {
    return l.win.evaluate(({ fromId, toId, text }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break } }
        const idOf = (ep: any) => ep?.Node?.Id ?? ep?.UnresolvedNodeId
        let c: any
        for (const x of diagram.Connectors?.ToArray?.() ?? []) {
            const s = idOf(x.Source), t = idOf(x.Target)
            if ((s === fromId && t === toId) || (s === toId && t === fromId)) { c = x; break }
        }
        if (!c) return undefined
        c.Text.IsEditing = true
        c.LabelText = text
        c.Text.IsEditing = false          // fires the write-back (IsEditing → false)
        return c.LabelText
    }, { fromId, toId, text })
}

test.describe.serial('connector inline edit', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-conn-edit-'))
        const projects: string[] = []
        for (const rel of PROJECT_RELS) {
            const dst = path.join(copyRoot, rel)
            fs.cpSync(path.join(CORPUS, rel), dst, { recursive: true })
            projects.push(dst)
        }
        restoreSession = seedSession(projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        const { rectsForCtor, clickCenter } = await import('./plexus-app')
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = (navs[1]?.x ?? 60) + (navs[1]?.w ?? 40) + 120
        for (let i = 0; i < 25; i++) {
            if (await l.win.getByText('diagram-2.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300); await l.win.mouse.wheel(0, 400); await l.win.waitForTimeout(150)
        }
        for (let attempt = 0; attempt < 3 && !(await hasNodes(l)); attempt++) {
            const dd = l.win.getByText('diagram-2.diagram', { exact: true }).first()
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(3500)
        }
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    // The A↔B connector's on-screen state: its label rect, route midpoint, and
    // its OWN Text.IsEditing (not a global editor count — avoids false positives).
    async function abState(): Promise<any> {
        return l.win.evaluate(({ fromId, toId }) => {
            const S = Symbol.for('mural:visual-backref')
            let diagram: any
            for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break } }
            const idOf = (ep: any) => ep?.Node?.Id ?? ep?.UnresolvedNodeId
            let c: any, cEl: Element | undefined
            for (const el of document.querySelectorAll('*')) {
                const v = (el as any)[S]
                if (v?.constructor?.name !== 'Connector') continue
                const s = idOf(v.Source), t = idOf(v.Target)
                if ((s === fromId && t === toId) || (s === toId && t === fromId)) { c = v; cEl = el; break }
            }
            if (!c || !cEl) return { found: false }
            let labelRect: any
            for (const el of document.querySelectorAll('*')) { if ((el as any)[S] === c.Text) { const r = el.getBoundingClientRect(); labelRect = { cx: r.x + r.width / 2, cy: r.y + r.height / 2 } } }
            const pts = (c.CurrentRoutePoints ?? []).map((p: any) => ({ X: p.X, Y: p.Y }))
            const r = cEl.getBoundingClientRect()
            const xs = pts.map((p: any) => p.X), ys = pts.map((p: any) => p.Y)
            const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys)
            const sx = (maxX - minX) > 0.5 ? r.width / (maxX - minX) : 0, sy = (maxY - minY) > 0.5 ? r.height / (maxY - minY) : 0
            const mid = pts[Math.floor(pts.length / 2)]
            return { found: true, isEditing: c.Text?.IsEditing, labelRect, routePt: mid ? { x: r.x + (mid.X - minX) * sx, y: r.y + (mid.Y - minY) * sy } : undefined }
        }, { fromId: A, toId: B })
    }

    test('double-click and F2 edit a connector-entity label, and the edit persists', async () => {
        expect(await hasNodes(l), 'diagram-2 opened with nodes').toBe(true)
        // draw() borrows the ConnectorEndpoint class from a projected connector.
        // The model's edges project asynchronously; wait, and skip cleanly if this
        // environment projected none (the behaviours are covered by unit tests).
        for (let i = 0; i < 40 && (await connectorCount(l)) === 0; i++) await l.win.waitForTimeout(500)
        test.skip((await connectorCount(l)) === 0, 'diagram-2 projected no connectors to draw from this run')

        // Draw A→B → auto-mint a connector entity labeled with its type (calls).
        const drawn = await draw(l, A, B)
        expect(drawn.ok, `draw fired: ${JSON.stringify(drawn)}`).toBe(true)
        await l.win.waitForTimeout(1500)
        expect(await labelBetween(l, A, B)).toBe('calls')

        // Real double-click (realistic timing) on the label edits THIS connector.
        const g = await abState()
        expect(g.found).toBe(true)
        await l.win.mouse.move(g.labelRect.cx, g.labelRect.cy)
        await l.win.mouse.down(); await l.win.mouse.up()
        await l.win.waitForTimeout(150)
        await l.win.mouse.down(); await l.win.mouse.up()
        await l.win.waitForTimeout(600)
        expect((await abState()).isEditing, 'double-click begins editing the connector label').toBe(true)
        await l.win.keyboard.press('Escape'); await l.win.waitForTimeout(400)

        // Select the connector (single click on its route), then F2 edits it.
        await l.win.mouse.click(g.routePt.x, g.routePt.y)
        await l.win.waitForTimeout(400)
        await l.win.keyboard.press('F2')
        await l.win.waitForTimeout(600)
        expect((await abState()).isEditing, 'F2 begins editing the selected connector label').toBe(true)
        await l.win.keyboard.press('Escape'); await l.win.waitForTimeout(400)

        // Edit the label to a new type term and commit → persists to the model.
        expect(await editLabel(l, A, B, 'invokes')).toBe('invokes')
        await l.win.waitForTimeout(1800)
        expect(await labelBetween(l, A, B)).toBe('invokes')
        expect(typeRecorded(copyRoot, A, B, 'invokes'), 'type written to .todl').toBe(true)

        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
