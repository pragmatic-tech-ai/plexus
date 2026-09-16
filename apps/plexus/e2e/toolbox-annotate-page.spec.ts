// Live smoke: opening a diagram surfaces the framework "Callouts, Text &
// Containers" toolbox page (container / text / callout), wired by Mural's
// ensureToolboxDefaults. Reaches the ToolboxRepository through the shell's
// service provider (no DOM/panel-visibility dependency).
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { launchPlexus, seedSession, corpusAvailable, type Launched } from './plexus-app'

const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'C:/Users/Eugene/Projects/plexus_tests'
const PROJECT_RELS = [
    'meta-models/tech-architecture', 'libraries/microsoft', 'libraries/aws', 'architecures/test_architecture',
]

// The items of the toolbox page titled `title`, across any service that owns Pages.
async function annotatePageItems(l: Launched, title: string) {
    return l.win.evaluate((wanted) => {
        const S = Symbol.for('mural:visual-backref')
        let root: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v) { root = v; break } }
        for (let p = root?.Services; p; p = p._parent) {
            for (const [, e] of (p._cache ?? new Map())) {
                const pages = e?.Pages?.ToArray?.()
                if (!pages) continue
                const page = pages.find((pg: any) => pg?.Title === wanted)
                if (page) return page.Items.ToArray().map((it: any) => ({ id: it?.Id, label: it?.Label }))
            }
        }
        return null
    }, title)
}

test.describe.serial('toolbox annotate page', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-toolbox-page-'))
        const projects: string[] = []
        for (const rel of PROJECT_RELS) {
            const dst = path.join(copyRoot, rel)
            fs.cpSync(path.join(CORPUS, rel), dst, { recursive: true })
            projects.push(dst)
        }
        restoreSession = seedSession(projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)

        // Open a diagram so a Diagram is instantiated (ensureToolboxDefaults runs).
        const { rectsForCtor, clickCenter } = await import('./plexus-app')
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = (navs[1]?.x ?? 60) + (navs[1]?.w ?? 40) + 120
        for (let i = 0; i < 20; i++) {
            if (await l.win.getByText('containment-demo.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300); await l.win.mouse.wheel(0, 400); await l.win.waitForTimeout(200)
        }
        const dd = l.win.getByText('containment-demo.diagram', { exact: true }).first()
        await dd.dblclick({ timeout: 4000 }).catch(() => {})
        await l.win.waitForTimeout(3500)
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    test('the toolbox has a Callouts, Text & Containers page with the three tools', async () => {
        const items = await annotatePageItems(l, 'Callouts, Text & Containers')
        expect(items, 'the annotate page exists').not.toBeNull()
        expect(items!.map((i: any) => i.id)).toEqual(['kind:container', 'kind:text', 'kind:callout'])
        expect(items!.map((i: any) => i.label)).toEqual(['Container', 'Text', 'Callout'])
    })
})
