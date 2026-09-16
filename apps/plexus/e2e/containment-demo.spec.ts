// DEMO: model-backed containment on a live diagram. Opens the test_arch project's
// containment-demo.diagram, which places the `on_premises` location plus two nodes
// that declare `in = on_premises` in the model (component `enterprise_legacy_app`
// and network `on_prem_network`). On open, the containment projection realizes
// `on_premises` as a ContentContainerFigure and nests the two children inside it —
// straight from the model's `in` refs, with no model mutation. Captures
// screenshots and asserts the nesting.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, appErrors, cloneCorpus, writeContainmentDemoFixture, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')
const shot = (l: Launched, name: string) =>
    l.win.screenshot({ path: path.join(ART, `${name}.png`) }).catch(() => {})

// Every realized arch node: its id, concept, the ctor of its realized Figure
// (ContentContainerFigure for containers), and its container-parent id (nesting).
async function nodes(l: Launched): Promise<Array<{ id: string; concept: string; figure: string; parent: string | undefined }>> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        if (!diagram) return []
        const arr: any[] = diagram.ItemsSource?.ToArray ? diagram.ItemsSource.ToArray() : []
        const out: Array<{ id: string; concept: string; figure: string; parent: string | undefined }> = []
        for (const vm of arr) {
            const fig = vm?.constructor?.name === 'Figure' ? vm : diagram.Generator?.ContainerFromItem(vm)
            out.push({
                id: vm?.Id ?? fig?.Id,
                concept: vm?.Concept ?? '',
                figure: fig?.constructor?.name ?? '(unrealized)',
                parent: fig?.ContainerParent?.Id,
            })
        }
        return out
    })
}

test.describe.serial('DEMO: model-backed containment', () => {
    let l: Launched
    let restoreSession: () => void
    let cloneRoot: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        // Generate the demo diagram into a corpus clone (never shipped in the real
        // corpus): places on_premises + its two `in` children.
        const clone = cloneCorpus()
        cloneRoot = clone.root
        writeContainmentDemoFixture(clone.archDir)
        restoreSession = seedSession(clone.projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)

        // Open the project explorer, then scroll the virtualized tree until the demo
        // diagram appears and open it (mirrors the f2-title-edit navigation flow).
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
        for (let attempt = 0; attempt < 3 && (await nodes(l)).length === 0; attempt++) {
            const dd = l.win.getByText('containment-demo.diagram', { exact: true }).first()
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(3500)
        }
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (cloneRoot) fs.rmSync(cloneRoot, { recursive: true, force: true })
    })

    test('the location realizes as a container and its `in` children nest inside it', async () => {
        await shot(l, 'containment-demo')
        const ns = await nodes(l)
        // eslint-disable-next-line no-console
        console.log('DEMO nodes:', JSON.stringify(ns, null, 2))

        const loc = ns.find((n) => n.id === 'on_premises')
        const legacy = ns.find((n) => n.id === 'enterprise_legacy_app')
        const net = ns.find((n) => n.id === 'on_prem_network')

        expect(loc, 'on_premises placed').toBeTruthy()
        expect(legacy, 'enterprise_legacy_app placed').toBeTruthy()
        expect(net, 'on_prem_network placed').toBeTruthy()

        // The location concept is a container → realized as a ContentContainerFigure.
        expect(loc!.figure, 'location realizes as a content container').toBe('ContentContainerFigure')
        // Both `in = on_premises` children are nested inside the location container.
        expect(legacy!.parent, 'legacy app nested in on_premises').toBe('on_premises')
        expect(net!.parent, 'network nested in on_premises').toBe('on_premises')

        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
