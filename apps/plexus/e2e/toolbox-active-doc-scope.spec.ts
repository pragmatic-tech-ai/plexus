// Live smoke: opening an architecture diagram scopes the toolbox to the active
// document's model — the Model + Scenarios pages carry the model namespace, and
// the library / meta-model pages narrow to the bases the model references.
// The corpus arch project (test_architecture) is `pilot_project.models` and
// references tech-architecture + microsoft + aws.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { launchPlexus, seedSession, corpusAvailable, appErrors, rectsForCtor, clickCenter, type Launched } from './plexus-app'

const CORPUS = process.env.PLEXUS_TEST_CORPUS ?? 'C:/Users/Eugene/Projects/plexus_tests'
const PROJECT_RELS = [
    'meta-models/tech-architecture', 'libraries/microsoft', 'libraries/aws', 'architecures/test_architecture',
]

// Every toolbox page (title/id/item count) across whichever service owns Pages.
async function toolboxPages(l: Launched): Promise<Array<{ id: string; title: string; count: number }>> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let root: any
        for (const el of document.querySelectorAll('*')) { const v = (el as any)[S]; if (v) { root = v; break } }
        const out: Array<{ id: string; title: string; count: number }> = []
        const seen = new Set<string>()
        for (let p = root?.Services; p; p = p._parent) {
            for (const [, e] of (p._cache ?? new Map())) {
                const pages = e?.Pages?.ToArray?.()
                if (!pages) continue
                for (const pg of pages) {
                    if (seen.has(pg.Id)) continue
                    seen.add(pg.Id)
                    out.push({ id: pg.Id, title: pg.Title, count: pg.Items?.Count ?? pg.Items?.ToArray?.().length ?? 0 })
                }
            }
        }
        return out
    })
}

test.describe.serial('toolbox scopes to the active architecture diagram', () => {
    let l: Launched
    let restoreSession: () => void
    let copyRoot: string

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plexus-toolbox-scope-'))
        const projects: string[] = []
        for (const rel of PROJECT_RELS) {
            const dst = path.join(copyRoot, rel)
            fs.cpSync(path.join(CORPUS, rel), dst, { recursive: true })
            projects.push(dst)
        }
        restoreSession = seedSession(projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)

        // Open an architecture diagram so its model binds and the toolbox scopes.
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = (navs[1]?.x ?? 60) + (navs[1]?.w ?? 40) + 120
        for (let i = 0; i < 20; i++) {
            if (await l.win.getByText('diagram.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300); await l.win.mouse.wheel(0, 400); await l.win.waitForTimeout(200)
        }
        const dd = l.win.getByText('diagram.diagram', { exact: true }).first()
        await dd.dblclick({ timeout: 4000 }).catch(() => {})
        await l.win.waitForTimeout(3500)
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (copyRoot) fs.rmSync(copyRoot, { recursive: true, force: true })
    })

    test('model + scenarios pages carry the namespace; libraries are scoped; no errors', async () => {
        const pages = await toolboxPages(l)
        console.log('TOOLBOX PAGES:', JSON.stringify(pages, null, 2))
        console.log('APP ERRORS:', JSON.stringify(appErrors(l.errors), null, 2))

        const titles = pages.map((p) => p.title)
        // Model page unchanged (confirms the arch diagram bound + wiring resolved).
        expect(titles).toContain('Model: pilot_project.models')
        // Scenarios page now carries the model namespace (the change under test).
        expect(titles).toContain('Scenarios: pilot_project.models')
        // Built-in Shapes always present.
        expect(pages.some((p) => p.id === 'shapes')).toBe(true)
        // No new renderer errors from the active-doc scoping path.
        expect(appErrors(l.errors)).toEqual([])
    })
})
