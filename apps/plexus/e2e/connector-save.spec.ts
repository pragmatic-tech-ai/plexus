// Comprehensive dirty + save coverage for diagram CONNECTORS on an arch diagram.
//
// Bug under investigation: "the diagram does not save the changes related to
// connectors." Arch-diagram connectors are model-derived (IsDerived) — drawing
// one mints a `connector` entity (or a concept ref) and calls model.save(),
// which writes the .todl; the visual connector re-projects from the model on
// open. So persistence flows through the .todl, NOT the .diagram file.
//
// We drive the REAL production path (view._fireConnectorCreated with genuine
// ConnectorEndpoints) against a scratch COPY of plexus_test_projects, then check:
//   1. the document's IsDirty flag flips on a connector draw/delete (dirty mech),
//   2. the connector record lands in the .todl on disk (save mech),
//   3. the connector survives an in-session close + reopen (re-projection),
//   4. the connector survives a full app RELAUNCH (disk round-trip).
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { launchPlexus, seedSession, appErrors, rectsForCtor, clickCenter, type Launched } from './plexus-app'

// Point the corpus at the in-repo test projects (the external corpus is absent).
const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'c:/Users/Eugene/Projects/architecture-agent/plexus_test_projects'
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

// Whether any .todl under the arch project records a connector between the ids.
function connectorRecorded(copyRoot: string, a: string, b: string): boolean {
    const archDir = path.join(copyRoot, 'architecures/test_architecture')
    const block = new RegExp(`connector\\s+\\w+\\s*\\{[\\s\\S]*?\\b${a}\\b[\\s\\S]*?\\b${b}\\b[\\s\\S]*?\\}`)
    const op = new RegExp(`\\b${a}\\b\\s*-->\\s*\\b${b}\\b|\\b${b}\\b\\s*-->\\s*\\b${a}\\b`)
    return walkTodl(archDir).some((f) => { const t = fs.readFileSync(f, 'utf8'); return block.test(t) || op.test(t) })
}

async function draw(l: Launched, fromId: string, toId: string): Promise<{ ok: boolean; reason?: string }> {
    return l.win.evaluate(({ fromId, toId }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        if (!diagram) return { ok: false, reason: 'no Diagram view' }
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

async function labelBetween(l: Launched, fromId: string, toId: string): Promise<string | undefined> {
    return l.win.evaluate(({ fromId, toId }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        if (!diagram) return undefined
        const idOf = (ep: any) => ep?.Node?.Id ?? ep?.UnresolvedNodeId
        for (const c of diagram.Connectors?.ToArray?.() ?? []) {
            const s = idOf(c.Source), t = idOf(c.Target)
            if ((s === fromId && t === toId) || (s === toId && t === fromId)) return c.LabelText
        }
        return undefined
    }, { fromId, toId })
}

// The active DiagramDocument's IsDirty (the Diagram view's DataContext IS the doc).
async function docIsDirty(l: Launched): Promise<boolean | undefined> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        const doc = diagram?.DataContext
        return typeof doc?.IsDirty === 'boolean' ? doc.IsDirty : undefined
    })
}

// Whether a node with the given entity id is present on the diagram.
async function hasNode(l: Launched, id: string): Promise<boolean> {
    return l.win.evaluate((id) => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram')
                return (v.ItemsSource?.ToArray?.() ?? []).some((vm: any) => vm?.Id === id)
        }
        return false
    }, id)
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

// Open diagram-2 via the project explorer, verifying it truly opened by a
// diagram-2-SPECIFIC node (endpoint A), retrying the double-click until it lands.
// (A generic hasNodes guard is unreliable: another diagram may already be open.)
async function openDiagram2(l: Launched): Promise<boolean> {
    const navs = await rectsForCtor(l.win, 'NavigationItem')
    if (navs[1]) await clickCenter(l.win, navs[1])
    await l.win.waitForTimeout(1200)
    const scrollX = (navs[1]?.x ?? 60) + (navs[1]?.w ?? 40) + 120
    for (let attempt = 0; attempt < 6; attempt++) {
        if (await hasNode(l, A)) return true
        // Scroll the tree until the file row is present, then double-click it.
        for (let i = 0; i < 25; i++) {
            if (await l.win.getByText('diagram-2.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300); await l.win.mouse.wheel(0, 400); await l.win.waitForTimeout(150)
        }
        const dd = l.win.getByText('diagram-2.diagram', { exact: true }).first()
        await dd.scrollIntoViewIfNeeded().catch(() => {})
        await dd.dblclick({ timeout: 4000 }).catch(() => {})
        await l.win.waitForTimeout(3500)
    }
    return await hasNode(l, A)
}

// Reliably CLOSE then REOPEN the active diagram tab, the way a user does it —
// close via the content host, reopen via ProjectExplorer.OpenFileInProject
// (folder + project-relative path off the doc's FileDiagramStorage). This is the
// EXACT in-session tab close+reopen path; the explorer double-click is flaky
// after a close, so we drive the service method the double-click ultimately calls.
// Close every open document (clean slate).
async function closeAllDocs(l: Launched): Promise<string[]> {
    const ids = await l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let host: any
        for (const el of document.querySelectorAll('*')) {
            const dc = (el as any)[S]?.DataContext
            if (dc && typeof dc.CloseById === 'function' && dc.OpenDocuments) { host = dc; break }
        }
        if (!host) return []
        const ids = host.OpenDocuments.ToArray().map((d: any) => d.Id)
        for (const id of ids) host.CloseById(id)
        return ids
    })
    await l.win.waitForTimeout(1200)
    return ids
}

// Open one diagram file programmatically via OpenFileInProject (folder = the
// test_architecture project's RootPath).
async function openDiagramFile(l: Launched, relPath: string): Promise<any> {
    const r = await l.win.evaluate(async (relPath) => {
        const S = Symbol.for('mural:visual-backref')
        let explorer: any
        for (const el of document.querySelectorAll('*')) {
            const dc = (el as any)[S]?.DataContext
            if (dc && typeof dc.OpenFileInProject === 'function') { explorer = dc; break }
        }
        if (!explorer) return { ok: false, reason: 'no explorer' }
        const proj = explorer.OpenProjects.ToArray().find((p: any) => (p?.Folder ?? '').toLowerCase().includes('test_architecture'))
        if (!proj) return { ok: false, reason: 'no arch project' }
        await explorer.OpenFileInProject(proj.Folder, relPath, 0, 0)
        return { ok: true, folder: proj.Folder }
    }, relPath)
    await l.win.waitForTimeout(3500)
    return r
}

async function closeAndReopenActive(l: Launched, fileHint: string): Promise<any> {
    const r = await l.win.evaluate(async (fileHint) => {
        const S = Symbol.for('mural:visual-backref')
        let host: any, explorer: any
        for (const el of document.querySelectorAll('*')) {
            const dc = (el as any)[S]?.DataContext
            if (!host && dc && typeof dc.CloseById === 'function' && dc.OpenDocuments) host = dc
            if (!explorer && dc && typeof dc.OpenFileInProject === 'function') explorer = dc
        }
        if (!host) return { ok: false, reason: 'no content host' }
        if (!explorer) return { ok: false, reason: 'no explorer service' }
        // The open doc whose FileDiagramStorage path is the target diagram file.
        const openDocs = host.OpenDocuments.ToArray()
        const target = openDocs.find((d: any) => (d?.Storage?.Path ?? '').includes(fileHint))
        if (!target) return { ok: false, reason: 'target not open', openPaths: openDocs.map((d: any) => d?.Storage?.Path) }
        const relPath = target.Storage.Path
        // Project folder = the OpenProject whose RootPath matches this storage.
        const projects = explorer.OpenProjects.ToArray()
        const proj = projects.find((p: any) => (p?.Folder ?? '').toLowerCase().includes('test_architecture'))
        const folder = proj?.Folder
        if (!folder) return { ok: false, reason: 'no project folder', projectFolders: projects.map((p: any) => p?.Folder) }
        const before = openDocs.map((d: any) => d.Id)
        host.CloseById(target.Id)
        await new Promise((res) => setTimeout(res, 700))
        const afterClose = host.OpenDocuments.ToArray().map((d: any) => d.Id)
        await explorer.OpenFileInProject(folder, relPath, 0, 0)
        await new Promise((res) => setTimeout(res, 700))
        const afterReopen = host.OpenDocuments.ToArray().map((d: any) => ({ id: d.Id, path: d?.Storage?.Path }))
        return { ok: true, folder, relPath, before, afterClose, afterReopen }
    }, fileHint)
    await l.win.waitForTimeout(2500)
    return r
}

function makeCopy(): string {
    const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-conn-save-'))
    for (const rel of PROJECT_RELS) fs.cpSync(path.join(CORPUS, rel), path.join(copyRoot, rel), { recursive: true })
    return copyRoot
}

test.describe.serial('connector dirty + save', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        copyRoot = makeCopy()
        restoreSession = seedSession(PROJECT_RELS.map((rel) => path.join(copyRoot, rel)))
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        // Render the project-explorer panel (select its nav item) so its service
        // DataContext (OpenFileInProject) is reachable in the visual tree.
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1500)
        // Clean slate: close whatever the session restored, then open EXACTLY
        // one diagram-2 tab programmatically (no double-click ambiguity, no dupes).
        await closeAllDocs(l)
        const opened = await openDiagramFile(l, 'diagram-2.diagram')
        console.log('=== initial open: ' + JSON.stringify(opened) + ' ===')
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    test('draw flips the document dirty flag AND writes the connector to .todl', async () => {
        expect(await hasNode(l, A), 'diagram-2 opened (endpoint present)').toBe(true)
        expect(await labelBetween(l, A, B), 'no connector initially').toBeUndefined()

        const drawn = await draw(l, A, B)
        expect(drawn.ok, `draw fired: ${JSON.stringify(drawn)}`).toBe(true)
        await l.win.waitForTimeout(1500)

        expect(await labelBetween(l, A, B), 'projected with type label').toBe('calls')
        expect(await docIsDirty(l), 'document dirty after connector draw').toBe(true)
        expect(connectorRecorded(copyRoot, A, B), 'connector written to .todl').toBe(true)
    })

    // A SINGLE-tab close + reopen (the clean flow) re-projects the connector from
    // the model. NOTE: a duplicate-document state (the same diagram open as two
    // tabs) breaks this — see the report; that path is out of scope for this test.
    test('connector survives an in-session tab close + reopen (re-projects from model)', async () => {
        expect(connectorRecorded(copyRoot, A, B), 'connector on disk before reopen').toBe(true)
        const r = await closeAndReopenActive(l, 'diagram-2.diagram')
        expect(r.ok, `close+reopen: ${JSON.stringify(r)}`).toBe(true)
        expect(await hasNode(l, A), `endpoint ${A} present after reopen`).toBe(true)
        expect(connectorRecorded(copyRoot, A, B), 'connector STILL on disk after reopen').toBe(true)
        let label: string | undefined
        for (let i = 0; i < 20; i++) { label = await labelBetween(l, A, B); if (label !== undefined) break; await l.win.waitForTimeout(500) }
        expect(label, 'connector re-projected on the reopened tab').toBe('calls')
    })

    test('no app errors', async () => {
        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})

// Set a pinned waypoint on the A↔B connector (simulates a user route drag) and
// return whether it took.
async function setWaypoint(l: Launched, fromId: string, toId: string, x: number, y: number): Promise<boolean> {
    return l.win.evaluate(({ fromId, toId, x, y }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break } }
        const idOf = (ep: any) => ep?.Node?.Id ?? ep?.UnresolvedNodeId
        const c = (diagram?.Connectors?.ToArray?.() ?? []).find((x: any) => {
            const s = idOf(x.Source), t = idOf(x.Target)
            return (s === fromId && t === toId) || (s === toId && t === fromId)
        })
        if (!c) return false
        // RouteWaypoint = { point: Point, userAltered }. Borrow the Point class off
        // any existing waypoint, else construct via the connector's own module isn't
        // reachable — so reuse the endpoint FreePoint Point ctor when present.
        const anyWp = c.Waypoints?.[0]?.point
        const PointCtor = anyWp?.constructor
        const pt = PointCtor ? new PointCtor(x, y) : { X: x, Y: y }
        c.Waypoints = [{ point: pt, userAltered: true }]
        return true
    }, { fromId, toId, x, y })
}

// The pinned waypoints of the A↔B connector as [{x,y,userAltered}], or [].
async function waypointsOf(l: Launched, fromId: string, toId: string): Promise<Array<{ x: number; y: number; userAltered: boolean }>> {
    return l.win.evaluate(({ fromId, toId }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break } }
        const idOf = (ep: any) => ep?.Node?.Id ?? ep?.UnresolvedNodeId
        const c = (diagram?.Connectors?.ToArray?.() ?? []).find((x: any) => {
            const s = idOf(x.Source), t = idOf(x.Target)
            return (s === fromId && t === toId) || (s === toId && t === fromId)
        })
        return (c?.Waypoints ?? []).map((w: any) => ({ x: w.point?.X, y: w.point?.Y, userAltered: !!w.userAltered }))
    }, { fromId, toId })
}

// Save the active document (persists the .diagram to disk).
async function saveActiveDoc(l: Launched): Promise<void> {
    await l.win.evaluate(async () => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v?.constructor?.name === 'Diagram') { diagram = v; break } }
        const doc = diagram?.DataContext
        if (doc?.Save) { const r = doc.Save(); if (r?.then) await r }
        const store = doc?.Storage
        if (store?.WhenWritten) await store.WhenWritten()
    })
    await l.win.waitForTimeout(500)
}

// Snapshot / restore every .todl under the arch project (to simulate an external
// edit that deletes a connector — the user's Bug 2).
function snapshotTodl(copyRoot: string): Map<string, string> {
    const archDir = path.join(copyRoot, 'architecures/test_architecture')
    const snap = new Map<string, string>()
    for (const f of walkTodl(archDir)) snap.set(f, fs.readFileSync(f, 'utf8'))
    return snap
}
function restoreTodl(snap: Map<string, string>): void {
    for (const [f, text] of snap) fs.writeFileSync(f, text)
}

// Bug 1: a connector's VISUAL state (route waypoints, routing mode, pinned port
// sides) must survive a tab close + reopen. Derived connectors were skipped by the
// .diagram serializer, so a manual route was lost on reopen.
test.describe.serial('connector route/port visual state persists (Bug 1)', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        copyRoot = makeCopy()
        restoreSession = seedSession(PROJECT_RELS.map((rel) => path.join(copyRoot, rel)))
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1500)
        await closeAllDocs(l)
        await openDiagramFile(l, 'diagram-2.diagram')
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    test('a pinned route waypoint survives a tab close + reopen', async () => {
        expect(await hasNode(l, A)).toBe(true)
        await draw(l, A, B)
        await l.win.waitForTimeout(1500)
        expect(await labelBetween(l, A, B)).toBe('calls')

        // Reroute: pin a waypoint, then save the diagram.
        expect(await setWaypoint(l, A, B, 424, 242), 'waypoint set').toBe(true)
        await l.win.waitForTimeout(500)
        const before = await waypointsOf(l, A, B)
        expect(before, 'waypoint present before reopen').toEqual([{ x: 424, y: 242, userAltered: true }])
        await saveActiveDoc(l)

        // Close + reopen the tab.
        await closeAndReopenActive(l, 'diagram-2.diagram')
        // Wait for the connector to re-project.
        for (let i = 0; i < 20; i++) { if (await labelBetween(l, A, B) !== undefined) break; await l.win.waitForTimeout(500) }
        expect(await labelBetween(l, A, B), 'connector re-projected').toBe('calls')

        // The pinned waypoint must be restored.
        const after = await waypointsOf(l, A, B)
        expect(after, 'pinned waypoint restored after reopen').toEqual([{ x: 424, y: 242, userAltered: true }])
    })
})

// Bug 2: deleting a connector from the .todl must be reflected in the open diagram
// (the cached ArchModel must not project stale connectors after an external edit).
test.describe.serial('external .todl edit refreshes the diagram (Bug 2)', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        copyRoot = makeCopy()
        restoreSession = seedSession(PROJECT_RELS.map((rel) => path.join(copyRoot, rel)))
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1500)
        await closeAllDocs(l)
        await openDiagramFile(l, 'diagram-2.diagram')
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    test('deleting the connector from .todl removes it from the live diagram', async () => {
        expect(await hasNode(l, A)).toBe(true)
        // Snapshot the .todl BEFORE drawing (this state has no A→B connector).
        const preDraw = snapshotTodl(copyRoot)

        await draw(l, A, B)
        await l.win.waitForTimeout(1500)
        expect(await labelBetween(l, A, B), 'connector projected after draw').toBe('calls')
        expect(connectorRecorded(copyRoot, A, B), 'connector on disk after draw').toBe(true)

        // Externally delete the connector: restore the pre-draw .todl on disk.
        restoreTodl(preDraw)
        expect(connectorRecorded(copyRoot, A, B), 'connector removed from disk').toBe(false)

        // The file-watch must refresh the cached model → the diagram drops the
        // now-deleted connector. Poll up to ~10s for the live re-projection.
        let label: string | undefined = 'calls'
        for (let i = 0; i < 20; i++) {
            label = await labelBetween(l, A, B)
            if (label === undefined) break
            await l.win.waitForTimeout(500)
        }
        expect(label, 'connector removed from the live diagram after external .todl delete').toBeUndefined()
    })
})

// Reproduction of the reported bug: opening the SAME diagram file a second time
// must not create a duplicate document, and must not lose the connector on disk.
test.describe.serial('duplicate-document repro', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    async function openCount(fileHint: string): Promise<number> {
        return l.win.evaluate((fileHint) => {
            const S = Symbol.for('mural:visual-backref')
            let host: any
            for (const el of document.querySelectorAll('*')) {
                const dc = (el as any)[S]?.DataContext
                if (dc && typeof dc.CloseById === 'function' && dc.OpenDocuments) { host = dc; break }
            }
            if (!host) return -1
            return host.OpenDocuments.ToArray().filter((d: any) => (d?.Storage?.Path ?? '').includes(fileHint)).length
        }, fileHint)
    }

    test.beforeAll(async () => {
        copyRoot = makeCopy()
        restoreSession = seedSession(PROJECT_RELS.map((rel) => path.join(copyRoot, rel)))
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1500)
        await closeAllDocs(l)
        await openDiagramFile(l, 'diagram-2.diagram')
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    test('drawing then re-opening the same file keeps ONE document and the connector on disk', async () => {
        expect(await hasNode(l, A)).toBe(true)
        expect(await openCount('diagram-2.diagram'), 'one doc after first open').toBe(1)

        // Draw a connector — this fires model.save() → file-watch → RefreshProjects,
        // which re-adopts the OpenProject (the dedup-key churn under test).
        await draw(l, A, B)
        await l.win.waitForTimeout(1500)
        expect(connectorRecorded(copyRoot, A, B), 'connector on disk after draw').toBe(true)
        // Let the debounced project rescan (op re-adopt) settle.
        await l.win.waitForTimeout(2500)

        // Open the SAME file again (as a user might, or as session-restore + open).
        await openDiagramFile(l, 'diagram-2.diagram')
        await l.win.waitForTimeout(1500)

        // BUG: a second document for the same file appears (dedup keyed on the
        // stale OpenProject instance), and the duplicate binding clobbers the .todl.
        expect(await openCount('diagram-2.diagram'), 'still ONE doc after re-open').toBe(1)
        expect(connectorRecorded(copyRoot, A, B), 'connector STILL on disk after re-open').toBe(true)
    })
})

// A full relaunch: the connector drawn above must still be on disk and
// re-project when the app is started fresh against the same scratch copy.
test.describe.serial('connector survives app relaunch', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        copyRoot = makeCopy()
        restoreSession = seedSession(PROJECT_RELS.map((rel) => path.join(copyRoot, rel)))
        // Session 1: draw a connector, then close the app.
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        await openDiagram2(l)
        await draw(l, A, B)
        await l.win.waitForTimeout(2000)
        await l.app.close()
        // Session 2: relaunch against the same copy.
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        await openDiagram2(l)
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    test('drawn connector is present after relaunch', async () => {
        expect(await hasNodes(l), 'diagram-2 opened after relaunch').toBe(true)
        expect(connectorRecorded(copyRoot, A, B), 'connector on disk after relaunch').toBe(true)
        expect(await labelBetween(l, A, B), 'connector re-projected after relaunch').toBe('calls')
    })
})
