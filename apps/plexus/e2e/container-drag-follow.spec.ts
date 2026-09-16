// Regression: dragging a container carries its nested children. Opens the
// test_arch containment-demo.diagram (the `on_premises` location plus two nodes
// that declare `in = on_premises`), drags the container by a known delta, and
// asserts each nested child (a) is a true DOM descendant of the container's SVG
// group and (b) moves on screen by the SAME delta as the container.
//
// This guards the mural renderer fix (svg-renderer relocating a Visual's <g>
// when it is reparented in the visual tree): before the fix the child was a
// logical visual descendant but its SVG element stayed on the flat layer, so a
// container move left it behind (Δscreen = 0). The bug slipped past the headless
// suites because they asserted the visual tree, never the rendered SVG DOM.
//
// A container move autosaves the .diagram, so the run opens a scratch COPY of the
// corpus (PLEXUS_TEST_CORPUS pointed at a temp clone) — the real corpus is never
// mutated.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { launchPlexus, seedSession, corpusAvailable, appErrors, writeContainmentDemoFixture, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')
const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'C:/Users/Eugene/Projects/plexus_tests'
const PROJECT_RELS = [
    'meta-models/tech-architecture',
    'libraries/microsoft',
    'libraries/aws',
    'architecures/test_architecture',
]
const shot = (l: Launched, name: string) =>
    l.win.screenshot({ path: path.join(ART, `${name}.png`) }).catch(() => {})

// For each realized arch node: id, the ctor of its realized Figure, nesting link,
// whether the figure's SVG element is a DOM descendant of its container's SVG
// element (the thing that makes ancestor transforms compose), and the screen rect
// of that element.
async function probe(l: Launched) {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        const elByVisual = new Map<any, Element>()
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (!v) continue
            if (!elByVisual.has(v)) elByVisual.set(v, el)
            if (v?.constructor?.name === 'Diagram') diagram = v
        }
        if (!diagram) return { rows: [] as any[] }
        const arr: any[] = diagram.ItemsSource?.ToArray ? diagram.ItemsSource.ToArray() : []
        const figOf = (vm: any) => vm?.constructor?.name === 'Figure' ? vm : diagram.Generator?.ContainerFromItem(vm)
        const rows: any[] = []
        for (const vm of arr) {
            const fig = figOf(vm)
            if (!fig) { rows.push({ id: vm?.Id, figure: '(unrealized)' }); continue }
            const container = fig.ContainerParent
            const el = elByVisual.get(fig)
            const contEl = container ? elByVisual.get(container) : undefined
            const r = el ? (el as Element).getBoundingClientRect() : undefined
            rows.push({
                id: fig.Id,
                figure: fig.constructor?.name,
                containerParentId: container?.Id,
                domDescendantOfContainer: !!(contEl && el && contEl !== el && contEl.contains(el)),
                screenX: r ? Math.round(r.x) : undefined,
                screenY: r ? Math.round(r.y) : undefined,
                screenCX: r ? Math.round(r.x + r.width / 2) : undefined,
                screenCY: r ? Math.round(r.y + r.height / 2) : undefined,
            })
        }
        return { rows }
    })
}

test.describe.serial('container drag carries nested children', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        // Clone the corpus so the container-move autosave hits the copy, not the real thing.
        copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-drag-follow-'))
        const projects: string[] = []
        for (const rel of PROJECT_RELS) {
            const dst = path.join(copyRoot, rel)
            fs.cpSync(path.join(CORPUS, rel), dst, { recursive: true })
            projects.push(dst)
        }
        // The demo diagram is generated per-run into the clone (never shipped in
        // the real corpus): places on_premises + its two `in` children.
        writeContainmentDemoFixture(path.join(copyRoot, 'architecures/test_architecture'))
        restoreSession = seedSession(projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)

        // Open the project explorer, scroll the virtualized tree to the demo diagram, open it.
        const { rectsForCtor, clickCenter } = await import('./plexus-app')
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = (navs[1]?.x ?? 60) + (navs[1]?.w ?? 40) + 120
        for (let i = 0; i < 20; i++) {
            if (await l.win.getByText('containment-demo.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300)
            await l.win.mouse.wheel(0, 400)
            await l.win.waitForTimeout(250)
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            const p = await probe(l)
            if (p.rows.length > 0) break
            const dd = l.win.getByText('containment-demo.diagram', { exact: true }).first()
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(3500)
        }
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    test('nested children move by the same screen delta as the container', async () => {
        const { rectsForCtor } = await import('./plexus-app')
        await shot(l, 'drag-before')

        const conts = await rectsForCtor(l.win, 'ContentContainerFigure')
        expect(conts.length, 'the location realizes as a container').toBeGreaterThan(0)
        const c = conts[0]
        const px = c.x + c.w / 2, py = c.y + 12   // top header band, clear of any child
        const DX = 180, DY = 120

        const before = (await probe(l)).rows
        const children = before.filter((r: any) => r.containerParentId === 'on_premises')
        expect(children.length, 'children are nested under on_premises before the drag').toBeGreaterThan(0)

        await l.win.mouse.move(px, py)
        await l.win.mouse.down()
        for (let i = 1; i <= 6; i++) {
            await l.win.mouse.move(px + (DX * i) / 6, py + (DY * i) / 6)
            await l.win.waitForTimeout(30)
        }
        await l.win.mouse.up()
        await l.win.waitForTimeout(600)
        await shot(l, 'drag-after')

        const after = (await probe(l)).rows
        const byId = (rows: any[], id: string) => rows.find((r: any) => r.id === id)

        // The container actually moved (sanity that the drag engaged).
        const cb = byId(before, 'on_premises'), ca = byId(after, 'on_premises')
        const contDx = ca.screenX - cb.screenX, contDy = ca.screenY - cb.screenY
        // A pointer drag has a small engage threshold, so the container's screen
        // delta trails the nominal drag by a few px — only require it actually moved.
        expect(contDx, `container moved in X (got ${contDx})`).toBeGreaterThan(DX / 2)
        expect(contDy, `container moved in Y (got ${contDy})`).toBeGreaterThan(DY / 2)

        // Every nested child is a true DOM descendant and moved by the same delta.
        for (const ch of children) {
            const b = byId(before, ch.id), a = byId(after, ch.id)
            expect(a.domDescendantOfContainer, `${ch.id} is a DOM descendant of the container`).toBe(true)
            expect(a.containerParentId, `${ch.id} stays nested under on_premises`).toBe('on_premises')
            const dx = a.screenX - b.screenX, dy = a.screenY - b.screenY
            expect(Math.abs(dx - contDx), `${ch.id} followed in X (child Δ${dx} vs container Δ${contDx})`).toBeLessThanOrEqual(4)
            expect(Math.abs(dy - contDy), `${ch.id} followed in Y (child Δ${dy} vs container Δ${contDy})`).toBeLessThanOrEqual(4)
        }

        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })

    // Fresh-nest path: a node dragged INTO the container at runtime (reparent MOVE,
    // not placeAll RESTORE) must ALSO ride the container's transform on a later move.
    // This is the gesture a user does by hand — drop a container, drag a node in,
    // then reposition the box — and the one most likely to expose a stale <g>.
    test('a node dragged into the container then follows a container move', async () => {
        // Pick a loose (un-nested) node to drag in.
        const start = (await probe(l)).rows
        const loose = start.find((r: any) => r.figure && r.figure !== '(unrealized)'
            && !r.containerParentId && r.id !== 'on_premises')
        expect(loose, 'a loose node exists to drag in').toBeTruthy()

        // Nest it through the exact code path a hand drag-in runs
        // (ContainerPlacement.reparent = MOVE), isolating the follow question from
        // the flakiness of a synthetic drop landing pixel-perfectly in the box.
        const reparented = await l.win.evaluate((looseId: string) => {
            const S = Symbol.for('mural:visual-backref')
            let diagram: any
            for (const el of document.querySelectorAll('*')) {
                const v = (el as any)[S]
                if (v?.constructor?.name === 'Diagram') { diagram = v; break }
            }
            if (!diagram) return { ok: false, reason: 'no diagram' }
            const arr: any[] = diagram.ItemsSource?.ToArray?.() ?? []
            const figOf = (vm: any) => vm?.constructor?.name === 'Figure' ? vm : diagram.Generator?.ContainerFromItem(vm)
            const looseVm = arr.find((vm: any) => (vm?.Id ?? figOf(vm)?.Id) === looseId)
            const fig = figOf(looseVm)
            if (!fig) return { ok: false, reason: 'no figure for loose node' }
            diagram.ContainerPlacement.reparent(fig, 'on_premises')
            return { ok: true }
        }, loose.id)
        expect(reparented.ok, `reparent fired: ${JSON.stringify(reparented)}`).toBe(true)
        await l.win.waitForTimeout(400)

        const nested = (await probe(l)).rows.find((r: any) => r.id === loose.id)
        expect(nested.containerParentId, `${loose.id} nested into the container`).toBe('on_premises')
        expect(nested.domDescendantOfContainer, `${loose.id} is a DOM descendant after drag-in`).toBe(true)

        // Move the container by bumping its figure frame (drives the SAME render
        // transform a drag produces, deterministically) and confirm the freshly-
        // nested child rides along on screen.
        const DX = 140, DY = 90
        const before = (await probe(l)).rows
        await l.win.evaluate(({ dx, dy }) => {
            const S = Symbol.for('mural:visual-backref')
            let diagram: any
            for (const el of document.querySelectorAll('*')) {
                const v = (el as any)[S]
                if (v?.constructor?.name === 'Diagram') { diagram = v; break }
            }
            const arr: any[] = diagram.ItemsSource?.ToArray?.() ?? []
            const figOf = (vm: any) => vm?.constructor?.name === 'Figure' ? vm : diagram.Generator?.ContainerFromItem(vm)
            const contVm = arr.find((vm: any) => (vm?.Id ?? figOf(vm)?.Id) === 'on_premises')
            const cont = figOf(contVm)
            cont.Left = cont.Left + dx
            cont.Top = cont.Top + dy
        }, { dx: DX, dy: DY })
        await l.win.waitForTimeout(400)
        const after = (await probe(l)).rows

        const byId = (rows: any[], id: string) => rows.find((r: any) => r.id === id)
        const cb = byId(before, 'on_premises'), ca = byId(after, 'on_premises')
        const contDx = ca.screenX - cb.screenX, contDy = ca.screenY - cb.screenY
        expect(contDx, `container moved in X (got ${contDx})`).toBeGreaterThan(DX / 2)

        const b = byId(before, loose.id), a = byId(after, loose.id)
        const dx = a.screenX - b.screenX, dy = a.screenY - b.screenY
        expect(Math.abs(dx - contDx), `${loose.id} followed in X (Δ${dx} vs container Δ${contDx})`).toBeLessThanOrEqual(4)
        expect(Math.abs(dy - contDy), `${loose.id} followed in Y (Δ${dy} vs container Δ${contDy})`).toBeLessThanOrEqual(4)

        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
