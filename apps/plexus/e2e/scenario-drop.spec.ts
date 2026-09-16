// Drives the REAL scenario-drop path in the running app: opens diagram-2 (which
// already places the chat_surface + ai_data_sources block containers) and fires
// the toolbox drop for a scenario through diagram._fireItemDropped — the same
// entry canvas-drop-behavior uses, so the router looks the scenario item up in
// the ToolboxRepository, resolves ArchScenarioDropFactory, and runs it for real.
// Then it dumps the resulting nodes (geometry + nesting) and any app errors, so
// scenario-drop misbehavior shows up as concrete data.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, appErrors, cloneCorpus, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')

// Every realized node with geometry + nesting + whether its figure sits inside
// its container's diagram-space rect.
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
        const figOf = (vm: any) => (vm?.constructor?.name === 'Figure' ? vm : diagram.Generator?.ContainerFromItem(vm))
        const rows: any[] = []
        for (const vm of arr) {
            const fig = figOf(vm)
            const parent = fig?.ContainerParent
            const el = fig ? elByVisual.get(fig) : undefined
            const pel = parent ? elByVisual.get(parent) : undefined
            // Ground truth from the rendered SVG: is the child's box within the
            // container's box (viewport coords), and a DOM descendant of it?
            let insideParentRect: boolean | undefined
            let domNested: boolean | undefined
            if (parent && el && pel) {
                const r = el.getBoundingClientRect(); const p = pel.getBoundingClientRect()
                insideParentRect = r.left >= p.left - 1 && r.top >= p.top - 1 && r.right <= p.right + 1 && r.bottom <= p.bottom + 1
                domNested = pel !== el && pel.contains(el)
            }
            const b = el?.getBoundingClientRect()
            rows.push({
                id: vm?.Id ?? fig?.Id,
                concept: vm?.Concept ?? '',
                figure: fig?.constructor?.name ?? '(unrealized)',
                parent: parent?.Id,
                rect: b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : undefined,
                insideParentRect,
                domNested,
            })
        }
        return { rows }
    })
}

// Fire a scenario toolbox drop at (x,y). Returns whether the diagram + fire method
// were found (the router resolves the item/factory itself).
async function fireScenarioDrop(l: Launched, scenarioId: string, x: number, y: number): Promise<{ fired: boolean; itemFound: boolean }> {
    return l.win.evaluate(({ scenarioId, x, y }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        let root: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (!v) continue
            if (!root && v.Services) root = v
            if (v?.constructor?.name === 'Diagram') diagram = v
        }
        if (!diagram || typeof diagram._fireItemDropped !== 'function') return { fired: false, itemFound: false }
        const FORMAT = '@pragmatic-tech-ai/mural/toolbox-item'
        const itemId = 'scenario:' + scenarioId
        const data = { Has: (f: string) => f === FORMAT, Get: (f: string) => (f === FORMAT ? itemId : undefined) }
        diagram._fireItemDropped({ Data: data, Position: { X: x, Y: y }, TargetContainer: undefined })
        return { fired: true, itemFound: true }
    }, { scenarioId, x, y })
}

// Fixture: pre-place ONLY the two block containers (chat_surface, ai_data_sources)
// as roomy boxes, nothing else. Dropping a scenario then adds its member
// components fresh — so `m365_copilot_chat` (in_block = chat_surface) is a genuine
// new node that the factory must position INSIDE the existing chat_surface.
const FIXTURE = 'a-scenario-drop-demo.diagram'   // sorts to the top of the project files
function writeScenarioDropFixture(archDir: string): void {
    const diagram = {
        version: 3,
        nodes: [
            { id: 'chat_surface', type: 'arch', data: {} },
            { id: 'ai_data_sources', type: 'arch', data: {} },
        ],
        visuals: {
            chat_surface: { left: 100, top: 100, w: 320, h: 260, baseWidth: 320, baseHeight: 260, userSized: true },
            ai_data_sources: { left: 520, top: 100, w: 320, h: 260, baseWidth: 320, baseHeight: 260, userSized: true },
        },
    }
    fs.writeFileSync(path.join(archDir, FIXTURE), JSON.stringify(diagram, null, 1))
}

// Whether a Diagram visual is currently mounted in the canvas.
async function diagramOpen(l: Launched): Promise<boolean> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram') return true
        }
        return false
    })
}

// Scroll the project tree to `name`, open it, and wait for a Diagram to mount.
async function openByName(l: Launched, name: string): Promise<boolean> {
    const { rectsForCtor, clickCenter } = await import('./plexus-app')
    const navs = await rectsForCtor(l.win, 'NavigationItem')
    if (navs[1]) await clickCenter(l.win, navs[1])
    await l.win.waitForTimeout(1200)
    const scrollX = (navs[1]?.x ?? 60) + (navs[1]?.w ?? 40) + 120
    for (let attempt = 0; attempt < 4; attempt++) {
        for (let i = 0; i < 60; i++) {
            if (await l.win.getByText(name, { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300)
            await l.win.mouse.wheel(0, 300)
            await l.win.waitForTimeout(150)
        }
        const dd = l.win.getByText(name, { exact: true }).first()
        if (await dd.count()) {
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            for (let w = 0; w < 16; w++) {
                await l.win.waitForTimeout(700)
                if (await diagramOpen(l)) return true
            }
        }
        // Scroll back to the top before retrying the search.
        await l.win.mouse.move(scrollX, 300)
        await l.win.mouse.wheel(0, -4000)
        await l.win.waitForTimeout(400)
    }
    return diagramOpen(l)
}

test.describe.serial('scenario drop onto a diagram with block containers', () => {
    let l: Launched
    let restoreSession: () => void
    let cloneRoot: string

    const sig = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort().join(',')

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        const clone = cloneCorpus()
        cloneRoot = clone.root
        writeScenarioDropFixture(clone.archDir)
        restoreSession = seedSession(clone.projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        await openByName(l, FIXTURE)
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (cloneRoot) fs.rmSync(cloneRoot, { recursive: true, force: true })
    })

    test('dropping the conversational scenario nests participants into their containers', async () => {
        const before = await probe(l)
        fs.writeFileSync(path.join(ART, 'drop-before.json'), JSON.stringify(before.rows, null, 2))
        const errBefore = l.errors.length

        const res = await fireScenarioDrop(l, 'conversational', 520, 360)
        await l.win.waitForTimeout(4000)

        const after = await probe(l)
        fs.writeFileSync(path.join(ART, 'drop-after.json'), JSON.stringify(after.rows, null, 2))
        await l.win.screenshot({ path: path.join(ART, 'scenario-drop-after.png') }).catch(() => {})
        const newErrors = appErrors(l.errors.slice(errBefore))
        // eslint-disable-next-line no-console
        console.log('fire result:', JSON.stringify(res))
        // eslint-disable-next-line no-console
        console.log('BEFORE sig:', sig(before.rows))
        // eslint-disable-next-line no-console
        console.log('AFTER rows:', JSON.stringify(after.rows, null, 2))
        // eslint-disable-next-line no-console
        console.log('NEW app errors:', JSON.stringify(newErrors, null, 2))

        const by = (id: string) => after.rows.find((r) => r.id === id)
        // The drop added the scenario's members (chat_surface was pre-placed).
        expect(sig(after.rows), 'the drop changed the canvas').not.toBe(sig(before.rows))
        expect(by('m365_copilot_chat'), 'm365_copilot_chat was added').toBeTruthy()
        // No renderer errors from the drop.
        expect(newErrors, newErrors.join('\n')).toEqual([])
        // m365_copilot_chat must nest into the pre-placed chat_surface AND be
        // positioned inside its rect (the feature under test).
        expect(by('m365_copilot_chat')!.parent, 'm365_copilot_chat nests in chat_surface').toBe('chat_surface')
        expect(by('m365_copilot_chat')!.insideParentRect, `m365_copilot_chat sits inside chat_surface rect: ${JSON.stringify(by('m365_copilot_chat'))}`).toBe(true)
        // No node may be nested yet positioned outside its container.
        const escaped = after.rows.filter((r) => r.parent && r.insideParentRect === false)
        expect(escaped, `nodes nested but positioned OUTSIDE their container: ${JSON.stringify(escaped)}`).toEqual([])
    })
})

// Empty diagram: the container (chat_surface) is added by the SAME scenario drop
// as its child (m365_copilot_chat). The child must still end up positioned inside
// the container — not scattered in the free flow and then reparented far away.
function writeEmptyFixture(archDir: string): void {
    fs.writeFileSync(path.join(archDir, 'a-scenario-empty-demo.diagram'), JSON.stringify({ version: 3, nodes: [], visuals: {} }, null, 1))
}

test.describe.serial('scenario drop onto an EMPTY diagram (container added same drop)', () => {
    let l: Launched
    let restoreSession: () => void
    let cloneRoot: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        const clone = cloneCorpus()
        cloneRoot = clone.root
        writeEmptyFixture(clone.archDir)
        restoreSession = seedSession(clone.projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
        await openByName(l, 'a-scenario-empty-demo.diagram')
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (cloneRoot) fs.rmSync(cloneRoot, { recursive: true, force: true })
    })

    test('a same-drop container still contains its member component', async () => {
        const errBefore = l.errors.length
        await fireScenarioDrop(l, 'conversational', 400, 300)
        await l.win.waitForTimeout(4000)
        const after = await probe(l)
        fs.writeFileSync(path.join(ART, 'drop-empty-after.json'), JSON.stringify(after.rows, null, 2))
        await l.win.screenshot({ path: path.join(ART, 'scenario-drop-empty-after.png') }).catch(() => {})
        const newErrors = appErrors(l.errors.slice(errBefore))
        // eslint-disable-next-line no-console
        console.log('EMPTY-CASE rows:', JSON.stringify(after.rows, null, 2))
        // eslint-disable-next-line no-console
        console.log('EMPTY-CASE new errors:', JSON.stringify(newErrors, null, 2))

        const by = (id: string) => after.rows.find((r) => r.id === id)
        expect(by('chat_surface'), 'chat_surface added').toBeTruthy()
        expect(by('m365_copilot_chat'), 'm365_copilot_chat added').toBeTruthy()
        expect(newErrors, newErrors.join('\n')).toEqual([])
        expect(by('m365_copilot_chat')!.parent, 'm365_copilot_chat nests in chat_surface').toBe('chat_surface')
        expect(by('m365_copilot_chat')!.insideParentRect, `m365_copilot_chat inside chat_surface: ${JSON.stringify(by('m365_copilot_chat'))}`).toBe(true)
    })
})
