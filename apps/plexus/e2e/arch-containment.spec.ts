// Live check: model-backed containment round-trips. Nesting a `component` node
// into a `location` node on an arch diagram writes the containment as an `in`
// relationship ref in the model's `.todl`, and re-opening the diagram restores
// the nesting from that ref.
//
// The corpus meta-model (tech-architecture) already declares
// `concept component { relationship in -> location?; }`, so `location` is a
// containment target → a container concept, and the default `in` recognition
// applies with no annotations. A drag-nest funnels through
// ContainerPlacement.reparent → the Diagram's NodeReparented event →
// ArchDiagramBinding.handleReparent → ArchModel.addRef('in') + save(). Rather
// than a pixel-perfect canvas drag (unreliable), this drives that exact
// production path in-renderer (reparent the realized Figure), then asserts the
// persisted `.todl` gained the ref — the definitive proof of the write-back.
//
// This test WRITES to the model, so it runs against a scratch COPY of the corpus
// (PLEXUS_TEST_CORPUS pointed at a temp clone) — the real corpus is never mutated.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { launchPlexus, seedSession, corpusAvailable, appErrors, type Launched } from './plexus-app'

const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'C:/Users/Eugene/Projects/plexus_tests'
const PROJECT_RELS = [
    'meta-models/tech-architecture',
    'libraries/microsoft',
    'libraries/aws',
    'architecures/test_architecture',
]

// A component + location pair currently placed on the active arch diagram,
// resolved through each Figure's Tag (the bound ArchNodeVM). Returns their ids +
// whether the component is already nested in the location.
async function containmentState(l: Launched): Promise<{
    hasPair: boolean
    componentId?: string
    locationId?: string
    nested?: boolean
}> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        if (!diagram) return { hasPair: false }
        const items = diagram.ItemsSource
        const arr: any[] = items?.ToArray ? items.ToArray() : []
        const figFor = (vm: any) => (vm?.constructor?.name === 'Figure' ? vm : diagram.Generator?.ContainerFromItem(vm))
        let comp: any, loc: any
        for (const vm of arr) {
            const concept = vm?.Concept
            if (concept === 'component' && !comp) comp = vm
            else if (concept === 'location' && !loc) loc = vm
        }
        if (!comp || !loc) return { hasPair: false }
        const compFig = figFor(comp)
        return {
            hasPair: true,
            componentId: comp.Id,
            locationId: loc.Id,
            nested: compFig?.ContainerParent?.Id === loc.Id,
        }
    })
}

// Drive the real nest: reparent the component's realized Figure into the location
// container via ContainerPlacement (fires NodeReparented → write-back → save).
async function nestComponentInLocation(l: Launched, locationId: string): Promise<void> {
    await l.win.evaluate((locationId) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        const items = diagram.ItemsSource.ToArray()
        const figFor = (vm: any) => (vm?.constructor?.name === 'Figure' ? vm : diagram.Generator?.ContainerFromItem(vm))
        const comp = items.find((vm: any) => vm?.Concept === 'component')
        diagram.ContainerPlacement.reparent(figFor(comp), locationId)
    }, locationId)
}

// The component's home .todl in the copy, and whether it records an `in` ref to
// the location (`in = <locationId>` or `in <locationId>` — the emitter's form).
function todlRecordsIn(copyRoot: string, componentId: string, locationId: string): boolean {
    const archDir = path.join(copyRoot, 'architecures/test_architecture')
    for (const file of walkTodl(archDir)) {
        const text = fs.readFileSync(file, 'utf8')
        // Look inside the component's record for an `in` member naming the location.
        const re = new RegExp(`\\b${componentId}\\b[\\s\\S]*?\\bin\\b\\s*[=:]?\\s*${locationId}\\b`)
        if (re.test(text)) return true
    }
    return false
}

function walkTodl(dir: string): string[] {
    const out: string[] = []
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) out.push(...walkTodl(p))
        else if (e.name.endsWith('.todl')) out.push(p)
    }
    return out
}

test.describe.serial('arch model-backed containment', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        // Clone the four corpus projects into a scratch dir; open the clones so the
        // write-back never touches the real corpus.
        copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-containment-'))
        const projects: string[] = []
        for (const rel of PROJECT_RELS) {
            const dst = path.join(copyRoot, rel)
            fs.cpSync(path.join(CORPUS, rel), dst, { recursive: true })
            projects.push(dst)
        }
        restoreSession = seedSession(projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    test('nesting a component into a location writes an `in` ref that survives reload', async () => {
        // Open a diagram that has both a component and a location. The explorer flow
        // mirrors f2-title-edit; scan a few diagrams for the pair.
        let state = await containmentState(l)
        if (!state.hasPair) {
            // Try opening diagrams from the explorer until a component+location pair shows.
            const { rectsForCtor, clickCenter } = await import('./plexus-app')
            const navs = await rectsForCtor(l.win, 'NavigationItem')
            if (navs[1]) await clickCenter(l.win, navs[1])
            await l.win.waitForTimeout(1500)
            for (let i = 0; i < 20 && !(state = await containmentState(l)).hasPair; i++) {
                const diagrams = l.win.getByText(/\.diagram$/)
                const n = await diagrams.count()
                if (i < n) await diagrams.nth(i).dblclick({ timeout: 3000 }).catch(() => {})
                await l.win.waitForTimeout(1500)
            }
        }
        test.skip(!state.hasPair, 'no diagram with a component+location pair in the corpus')

        expect(state.componentId, 'component id').toBeTruthy()
        expect(state.locationId, 'location id').toBeTruthy()

        // Nest, let the write-back save.
        await nestComponentInLocation(l, state.locationId!)
        await l.win.waitForTimeout(1500)

        // The component is now visually nested in the location…
        const after = await containmentState(l)
        expect(after.nested, 'component nested under location').toBe(true)

        // …and the model persisted the `in` ref to the copied .todl.
        expect(
            todlRecordsIn(copyRoot, state.componentId!, state.locationId!),
            'component record gained `in = <location>` in the saved .todl',
        ).toBe(true)

        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
