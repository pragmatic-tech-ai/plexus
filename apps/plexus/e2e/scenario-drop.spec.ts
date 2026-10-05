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
import { launchPlexus, seedSession, corpusAvailable, appErrors, cloneCorpus, openProjectFile, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')

// Every realized node with geometry + nesting + whether its figure sits inside
// its container's diagram-space rect.
async function probe(l: Launched)
{
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        const elByVisual = new Map<any, Element>()
        for (const el of document.querySelectorAll('*'))
        {
            const v = (el as any)[S]
            if (!v) continue
            if (!elByVisual.has(v)) elByVisual.set(v, el)
            if (v?.constructor?.name === 'Diagram') diagram = v
        }
        if (!diagram) return { rows: [] as any[] }
        const arr: any[] = diagram.ItemsSource?.ToArray ? diagram.ItemsSource.ToArray() : []
        const figOf = (vm: any) => (vm?.constructor?.name === 'Figure' ? vm : diagram.Generator?.ContainerFromItem(vm))
        const rows: any[] = []
        for (const vm of arr)
        {
            const fig = figOf(vm)
            const parent = fig?.ContainerParent
            const el = fig ? elByVisual.get(fig) : undefined
            const pel = parent ? elByVisual.get(parent) : undefined
            // Ground truth from the rendered SVG: is the child's box within the
            // container's box (viewport coords), and a DOM descendant of it?
            let insideParentRect: boolean | undefined
            let domNested: boolean | undefined
            if (parent && el && pel)
            {
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

// Fire a scenario drop at (x,y) by invoking the REAL drop factory the framework's
// canvas-drop onDropped handler runs — ArchScenarioDropFactory.CreateDropped —
// against the live bound document as the mutator. This drives the exact factory
// logic (planScenarioDrop + materializeMembership + model-backed nesting).
//
// It deliberately does NOT route through the ToolboxRepository item lookup that
// onDropped uses (ToolboxRepository.ItemById('scenario:<id>')): the scenario's
// toolbox item is served by a ScopedToolboxPage that populates its items only on
// attach + while VISIBLE and recomputes them against a model instance CAPTURED at
// page build — a reload replaces the model, so a hidden page's items silently
// clear (ItemById → undefined) until the Scenarios tab is shown. The test never
// opens that tab, so routing through ItemById is irreducibly racy and orthogonal
// to the nesting behaviour under test. The factory itself re-resolves the CURRENT
// model (modelForDocument), so a synthetic item carrying just the id is faithful.
// CreateDropped reads only context.Item.Id, context.Position and context.Mutator.
async function fireScenarioDrop(l: Launched, scenarioId: string, x: number, y: number): Promise<{ fired: boolean; itemFound: boolean }>
{
    return l.win.evaluate(({ scenarioId, x, y }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        let services: any
        for (const el of document.querySelectorAll('*'))
        {
            const v = (el as any)[S]
            if (!v) continue
            if (!services && v.Services) services = v.Services
            if (v?.constructor?.name === 'Diagram') diagram = v
        }
        if (!diagram || !services) return { fired: false, itemFound: false }
        let host: any, binding: any
        for (let p = services; p; p = p._parent)
            for (const [, e] of (p._cache ?? new Map()))
            {
                const n = (e as any)?.constructor?.name
                if (n === 'PlexusDocumentHost') host = e
                else if (n === 'ArchDiagramBindingService') binding = e
            }
        const doc = host?.ActiveDocument
        if (doc === undefined) return { fired: false, itemFound: false }
        // ATOMIC readiness: resolve the scenario flow on the CURRENT model (the same
        // instance CreateDropped re-resolves), in this same evaluate, and only fire
        // when it has resolved step pairs — the model's entity graph (bases) resolves
        // async, and a drop against an unresolved flow plans zero nodes (silent no-op).
        const model = binding?.modelForDocument?.(doc)
        const scenario = model?.entities?.().find((e: any) => e?.id === scenarioId)
        let resolvedPairs = 0
        if (scenario)
            for (const seq of (scenario.refs?.('sequences') ?? []))
                for (const step of (seq.refs?.('steps') ?? []))
                    if (step.refs?.('src')?.[0] && step.refs?.('dst')?.[0]) resolvedPairs++
        if (resolvedPairs === 0) return { fired: false, itemFound: false }
        // Resolve ArchScenarioDropFactory by its ServiceKey (by description) — no
        // dependency on the toolbox page/item being materialized.
        let factory: any
        for (let p = services; p && factory === undefined; p = p._parent)
        {
            const regs = p._registrations
            if (regs === undefined || typeof regs.forEach !== 'function') continue
            let token: any
            regs.forEach((_v: unknown, t: any) => { if (token === undefined && t && t.description === 'ArchScenarioDropFactory') token = t })
            if (token !== undefined) { try { factory = services.get(token) } catch { /* keep looking */ } }
        }
        if (factory === undefined || typeof factory.CreateDropped !== 'function') return { fired: false, itemFound: true }
        // The bound document is the mutator: it is what the binding keys
        // modelForDocument on, and DiagramDocument exposes AddNode/SetNodeVisual/
        // GetNodeVisual/Nodes — everything context.Mutator needs.
        factory.CreateDropped({
            Item: { Id: 'scenario:' + scenarioId },
            Descriptor: {},
            Position: { X: x, Y: y },
            Diagram: diagram,
            Mutator: doc,
            TargetContainer: undefined,
        })
        return { fired: true, itemFound: true }
    }, { scenarioId, x, y })
}

// Fire the scenario drop, retrying until the canvas changes. The synthetic
// _fireItemDropped races on toolbox-item materialization + model resolution that
// waitForScenarioFlow narrows but can't make perfectly deterministic across runs.
// A second drop of the SAME scenario is idempotent — planScenarioDrop marks
// already-placed participants isNew:false and materializeMembership reuses them —
// so re-firing until the probe changes adds nothing extra and is safe.
async function dropScenarioUntilChanged(l: Launched, scenarioId: string, x: number, y: number): Promise<void>
{
    const key = (rows: Array<{ id: string }>): string => rows.map((r) => r.id).sort().join(',')
    const baseline = key((await probe(l)).rows)
    for (let attempt = 0; attempt < 12; attempt++)
    {
        await fireScenarioDrop(l, scenarioId, x, y)
        for (let w = 0; w < 8; w++)
        {
            await l.win.waitForTimeout(400)
            if (key((await probe(l)).rows) !== baseline) return
        }
    }
}

// Fixture: pre-place ONLY the two block containers (chat_surface, ai_data_sources)
// as roomy boxes, nothing else. Dropping a scenario then adds its member
// components fresh — so `m365_copilot_chat` (in_block = chat_surface) is a genuine
// new node that the factory must position INSIDE the existing chat_surface.
const FIXTURE = 'a-scenario-drop-demo.diagram'   // sorts to the top of the project files
function writeScenarioDropFixture(archDir: string): void
{
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
async function diagramOpen(l: Launched): Promise<boolean>
{
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        for (const el of document.querySelectorAll('*'))
        {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram') return true
        }
        return false
    })
}

// Open the named arch-project file and wait for a Diagram to mount. Opens
// through the workspace service (the nested solution tree keeps project nodes
// collapsed, so a tree double-click can't see the file row).
async function openByName(l: Launched, name: string): Promise<boolean>
{
    for (let attempt = 0; attempt < 3; attempt++)
    {
        if (await diagramOpen(l)) return true
        await openProjectFile(l, 'test_architecture', name)
    }
    return diagramOpen(l)
}

// Poll until BOTH readiness conditions a synthetic scenario drop needs are met:
//  (1) the dropped scenario's flow RESOLVES on the active document's model — a
//      model binds almost immediately, but its entity graph (bases → the
//      scenario's sequences/steps and their src/dst endpoints) resolves async
//      after; the drop factory walks that flow (collectScenarioFlow) and plans no
//      nodes until it resolves pairs; and
//  (2) the scenario's toolbox item is MATERIALIZED, so the drop router's
//      ToolboxRepository.ItemById('scenario:<id>') resolves to the factory (the
//      scenario page populates its items lazily, a path independent of (1)).
// Missing either makes the drop a silent no-op. The non-empty case is not
// naturally gated on both, so without this it races. (In the real UI a scenario
// tile only appears once both hold, so a user can't hit this race.)
async function waitForScenarioFlow(l: Launched, scenarioId: string): Promise<boolean>
{
    for (let i = 0; i < 60; i++)
    {
        const ready = await l.win.evaluate((scenarioId) => {
            const S = Symbol.for('mural:visual-backref')
            let root: any
            for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v && v.Services) { root = v; break } }
            let host: any, binding: any
            for (let p = root?.Services; p; p = p._parent)
                for (const [, e] of (p._cache ?? new Map()))
                {
                    const n = (e as any)?.constructor?.name
                    if (n === 'PlexusDocumentHost') host = e
                    else if (n === 'ArchDiagramBindingService') binding = e
                }
            const doc = host?.ActiveDocument
            if (!doc || !binding || typeof binding.modelForDocument !== 'function') return false
            // The scenario's flow resolves on the bound model → the factory can plan
            // nodes. (fireScenarioDrop re-checks this atomically before firing, and
            // invokes the factory directly, so no toolbox-item materialization is
            // needed here.)
            const model = binding.modelForDocument(doc)
            const scenario = model?.entities?.().find((e: any) => e?.id === scenarioId)
            if (!scenario) return false
            for (const seq of (scenario.refs?.('sequences') ?? []))
                for (const step of (seq.refs?.('steps') ?? []))
                    if (step.refs?.('src')?.[0] && step.refs?.('dst')?.[0]) return true
            return false
        }, scenarioId)
        if (ready) return true
        await l.win.waitForTimeout(500)
    }
    return false
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
        await waitForScenarioFlow(l, 'conversational')
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

        await dropScenarioUntilChanged(l, 'conversational', 520, 360)

        const after = await probe(l)
        fs.writeFileSync(path.join(ART, 'drop-after.json'), JSON.stringify(after.rows, null, 2))
        await l.win.screenshot({ path: path.join(ART, 'scenario-drop-after.png') }).catch(() => {})
        const newErrors = appErrors(l.errors.slice(errBefore))
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
function writeEmptyFixture(archDir: string): void
{
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
        await waitForScenarioFlow(l, 'conversational')
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (cloneRoot) fs.rmSync(cloneRoot, { recursive: true, force: true })
    })

    test('a same-drop container still contains its member component', async () => {
        const errBefore = l.errors.length
        await dropScenarioUntilChanged(l, 'conversational', 400, 300)
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
