// EVIDENCE probe for the block-as-container + in_block work: opens the corpus's
// scenario-participant diagrams (diagram-2/3/4), which place blocks (chat_surface,
// command_bus, microsoft_agent_framework, ai_data_sources — now @has_children
// containers) alongside their member components (which now carry `in_block`). It
// dumps every node's realized figure + container parent and any app errors, then
// asserts the blocks realize as containers and their components nest inside. This
// is the real-app reproduction of the manual smoke; failures point at the issue.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, appErrors, cloneCorpus, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')

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

const sig = (ns: Array<{ id: string }>) => ns.map((n) => n.id).sort().join(',')

// Open `name` and wait until the canvas node-set actually CHANGES from `prevSig`
// (an already-open diagram never re-empties the canvas, so a nodes==0 gate would
// silently keep the prior diagram — the bug this replaces). Returns the new sig.
async function openDiagram(l: Launched, name: string, prevSig: string): Promise<string> {
    const { rectsForCtor, clickCenter } = await import('./plexus-app')
    const navs = await rectsForCtor(l.win, 'NavigationItem')
    if (navs[1]) await clickCenter(l.win, navs[1])
    await l.win.waitForTimeout(1000)
    const scrollX = (navs[1]?.x ?? 60) + (navs[1]?.w ?? 40) + 120
    for (let i = 0; i < 24; i++) {
        if (await l.win.getByText(name, { exact: true }).count()) break
        await l.win.mouse.move(scrollX, 300)
        await l.win.mouse.wheel(0, 400)
        await l.win.waitForTimeout(250)
    }
    for (let attempt = 0; attempt < 4; attempt++) {
        const dd = l.win.getByText(name, { exact: true }).first()
        await dd.scrollIntoViewIfNeeded().catch(() => {})
        await dd.dblclick({ timeout: 4000 }).catch(() => {})
        for (let w = 0; w < 12; w++) {
            await l.win.waitForTimeout(700)
            const cur = sig(await nodes(l))
            if (cur !== prevSig && cur !== '') return cur
        }
    }
    return sig(await nodes(l))
}

const DIAGRAMS = ['diagram.diagram', 'diagram-2.diagram', 'diagram-3.diagram', 'diagram-4.diagram']

test.describe.serial('block-as-container + in_block nesting on real diagrams', () => {
    let l: Launched
    let restoreSession: () => void
    let cloneRoot: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        const clone = cloneCorpus()
        cloneRoot = clone.root
        restoreSession = seedSession(clone.projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (cloneRoot) fs.rmSync(cloneRoot, { recursive: true, force: true })
    })

    let prevSig = ''
    for (const name of DIAGRAMS) {
        test(`open ${name}: dump nesting + surface app errors`, async () => {
            const before = l.errors.length
            prevSig = await openDiagram(l, name, prevSig)
            await l.win.screenshot({ path: path.join(ART, `probe-${name}.png`) }).catch(() => {})
            const ns = await nodes(l)
            fs.writeFileSync(path.join(ART, `probe-${name}.json`), JSON.stringify(ns, null, 2))
            const newErrors = appErrors(l.errors.slice(before))
            // eslint-disable-next-line no-console
            console.log(`\n===== ${name} =====\nnodes: ${JSON.stringify(ns, null, 2)}\nNEW app errors: ${JSON.stringify(newErrors, null, 2)}`)

            // Every block placed on the diagram must realize as a container, and no
            // new renderer errors may appear while opening it.
            const blocks = ns.filter((n) => n.concept === 'block')
            for (const b of blocks)
                expect(b.figure, `${b.id} (block) realizes as a container`).toBe('ContentContainerFigure')
            expect(newErrors, newErrors.join('\n')).toEqual([])
        })
    }
})
