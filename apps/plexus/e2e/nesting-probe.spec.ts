// GO/NO-GO probe: multi-level MODEL-BACKED container nesting projects at depth.
// Opens nesting-demo.diagram (azure ⊃ m365 ⊃ power_platform ⊃ business_agent) and
// asserts each level nests into its direct parent as a true SVG-DOM descendant —
// the depth generalization the container-drag-follow demo (1 level) does not cover.
//
// This is the realization-timing gate: a location that is BOTH a child and a
// container (m365, power_platform) is freshly re-minted as a ContentContainerFigure
// by reconcileContainerRealization, and its ChildHost must be ready in time for the
// inner level to attach (deferred via ContainerBound → placeAll otherwise). If this
// FAILS, stop and root-cause the deferred-attach cascade before any fix.
//
// Depends on the tech-architecture meta-model annotating `location.parent`
// @containment (Task 1); read live from the corpus clone.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { launchPlexus, seedSession, corpusAvailable, appErrors, writeNestingFixture, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')
const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'C:/Users/Eugene/Projects/plexus_tests'
const PROJECT_RELS = [
    'meta-models/tech-architecture',
    'libraries/microsoft',
    'libraries/aws',
    'architecures/test_architecture',
]

// id → { figure ctor, containerParentId, DOM-descendant-of-its-container }.
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
            rows.push({
                id: fig.Id,
                figure: fig.constructor?.name,
                containerParentId: container?.Id,
                domDescendantOfContainer: !!(contEl && el && contEl !== el && contEl.contains(el)),
            })
        }
        return { rows }
    })
}

test.describe.serial('multi-level model-backed nesting projects at depth', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-nesting-'))
        const projects: string[] = []
        for (const rel of PROJECT_RELS) {
            const dst = path.join(copyRoot, rel)
            fs.cpSync(path.join(CORPUS, rel), dst, { recursive: true })
            projects.push(dst)
        }
        writeNestingFixture(path.join(copyRoot, 'architecures/test_architecture'))
        restoreSession = seedSession(projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)

        const { rectsForCtor, clickCenter } = await import('./plexus-app')
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = (navs[1]?.x ?? 60) + (navs[1]?.w ?? 40) + 120
        for (let i = 0; i < 20; i++) {
            if (await l.win.getByText('nesting-demo.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300)
            await l.win.mouse.wheel(0, 400)
            await l.win.waitForTimeout(250)
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            const p = await probe(l)
            if (p.rows.length > 0) break
            const dd = l.win.getByText('nesting-demo.diagram', { exact: true }).first()
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

    test('azure ⊃ m365 ⊃ power_platform ⊃ business_agent nests four deep (library locations)', async () => {
        await l.win.screenshot({ path: path.join(ART, 'nesting-probe.png') }).catch(() => {})
        const rows = (await probe(l)).rows
        fs.writeFileSync(path.join(ART, 'nesting-rows.json'), JSON.stringify(rows, null, 2))
        const by = (id: string) => rows.find((r: any) => r.id === id)

        for (const id of ['microsoft_tech.azure', 'microsoft_tech.m365', 'microsoft_tech.power_platform', 'business_agent']) {
            expect(by(id), `${id} realized (rows: ${JSON.stringify(rows)})`).toBeTruthy()
            expect(by(id).figure, `${id} realized as a figure`).not.toBe('(unrealized)')
        }

        // The three (imported library) locations are containers; azure is the root.
        expect(by('microsoft_tech.azure').figure, 'azure is a container').toBe('ContentContainerFigure')
        expect(by('microsoft_tech.azure').containerParentId, 'azure is the outermost (root)').toBeUndefined()

        // Each level nests into its DIRECT parent (location→location via @containment
        // parent from the library; component→location via `in`).
        expect(by('microsoft_tech.m365').containerParentId, 'm365 nests in azure').toBe('microsoft_tech.azure')
        expect(by('microsoft_tech.power_platform').containerParentId, 'power_platform nests in m365').toBe('microsoft_tech.m365')
        expect(by('business_agent').containerParentId, 'business_agent nests in power_platform').toBe('microsoft_tech.power_platform')

        // True SVG-DOM descendants (transforms compose).
        expect(by('microsoft_tech.m365').domDescendantOfContainer, 'm365 DOM-nested in azure').toBe(true)
        expect(by('microsoft_tech.power_platform').domDescendantOfContainer, 'power_platform DOM-nested in m365').toBe(true)
        expect(by('business_agent').domDescendantOfContainer, 'business_agent DOM-nested in power_platform').toBe(true)

        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
