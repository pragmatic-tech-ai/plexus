// Live check: draw-to-connect on an arch diagram. Drawing a connector between two
// component nodes (which have no concept relationship between them) mints a typed
// `connector` entity in the model (default `calls`), which projects back as a
// labeled diagram connector and persists to the `.todl`. Shift+Delete removes the
// entity. Drives the real production path (view._fireConnectorCreated with genuine
// ConnectorEndpoints — exactly what the draw gesture fires) against a scratch COPY
// of the corpus, so the real corpus is never mutated.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { launchPlexus, seedSession, corpusAvailable, appErrors, type Launched } from './plexus-app'

const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'C:/Users/Eugene/Projects/plexus_tests'
const PROJECT_RELS = [
    'meta-models/tech-architecture', 'libraries/microsoft', 'libraries/aws', 'architecures/test_architecture',
]
// Two component nodes on diagram-2 with no connector between them.
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

// Whether any .todl under the arch project records a connector between the two ids
// — either the explicit `connector <id> { from; to }` block or the `a --> b`
// operator shorthand the emitter prefers (operator --> : connector (from, to)).
function connectorRecorded(copyRoot: string, a: string, b: string): boolean {
    const archDir = path.join(copyRoot, 'architecures/test_architecture')
    const block = new RegExp(`connector\\s+\\w+\\s*\\{[\\s\\S]*?\\b${a}\\b[\\s\\S]*?\\b${b}\\b[\\s\\S]*?\\}`)
    const op = new RegExp(`\\b${a}\\b\\s*-->\\s*\\b${b}\\b|\\b${b}\\b\\s*-->\\s*\\b${a}\\b`)
    return walkTodl(archDir).some((f) => { const t = fs.readFileSync(f, 'utf8'); return block.test(t) || op.test(t) })
}

// Draw a connector A→B via the real event, using a borrowed ConnectorEndpoint class.
async function draw(l: Launched, fromId: string, toId: string): Promise<{ ok: boolean; reason?: string }> {
    return l.win.evaluate(({ fromId, toId }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        const arr: any[] = diagram.ItemsSource.ToArray()
        const byId = (id: string) => arr.find((vm: any) => vm?.Id === id)
        const Ep = diagram.Connectors?.ToArray?.()[0]?.Source?.constructor
        if (!Ep) return { ok: false, reason: 'no ConnectorEndpoint class to borrow' }
        const src = byId(fromId), tgt = byId(toId)
        if (!src || !tgt) return { ok: false, reason: 'node not found' }
        diagram._fireConnectorCreated({ Source: new Ep({ Node: src }), Target: new Ep({ Node: tgt }) })
        return { ok: true }
    }, { fromId, toId })
}

// The label of the connector between the two node ids, or undefined.
async function labelBetween(l: Launched, fromId: string, toId: string): Promise<string | undefined> {
    return l.win.evaluate(({ fromId, toId }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        const idOf = (ep: any) => ep?.Node?.Id ?? ep?.UnresolvedNodeId
        for (const c of diagram.Connectors?.ToArray?.() ?? []) {
            const s = idOf(c.Source), t = idOf(c.Target)
            if ((s === fromId && t === toId) || (s === toId && t === fromId)) return c.LabelText
        }
        return undefined
    }, { fromId, toId })
}

// Shift+Delete the connector between the two nodes (fires the real delete event).
async function shiftDelete(l: Launched, fromId: string, toId: string): Promise<boolean> {
    return l.win.evaluate(({ fromId, toId }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        const idOf = (ep: any) => ep?.Node?.Id ?? ep?.UnresolvedNodeId
        const c = (diagram.Connectors?.ToArray?.() ?? []).find((x: any) => {
            const s = idOf(x.Source), t = idOf(x.Target)
            return (s === fromId && t === toId) || (s === toId && t === fromId)
        })
        if (!c) return false
        diagram._fireDeleteRequested({ Items: [], Connectors: [c], Shift: true })
        return true
    }, { fromId, toId })
}

async function hasNodes(l: Launched): Promise<boolean> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram') return (v.ItemsSource?.ToArray?.().length ?? 0) > 0
        }
        return false
    })
}

test.describe.serial('arch draw-to-connect', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-draw-connect-'))
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

    test('drawing between two components mints a labeled connector entity that persists, and Shift+Delete removes it', async () => {
        expect(await hasNodes(l), 'diagram-2 opened with nodes').toBe(true)
        expect(await labelBetween(l, A, B), 'no connector between them initially').toBeUndefined()

        // Draw → auto-mint a connector entity (component→component has no relationship).
        const drawn = await draw(l, A, B)
        expect(drawn.ok, `draw fired: ${JSON.stringify(drawn)}`).toBe(true)
        await l.win.waitForTimeout(1500)

        // Projected as a connector labeled with its type (calls) …
        expect(await labelBetween(l, A, B)).toBe('calls')

        // … and persisted to the model as a connector record.
        expect(connectorRecorded(copyRoot, A, B), 'connector record written to .todl').toBe(true)

        // Shift+Delete removes the connector entity from the model.
        expect(await shiftDelete(l, A, B)).toBe(true)
        await l.win.waitForTimeout(1500)
        expect(await labelBetween(l, A, B), 'connector removed from the diagram').toBeUndefined()
        expect(connectorRecorded(copyRoot, A, B), 'connector record removed from .todl').toBe(false)

        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
