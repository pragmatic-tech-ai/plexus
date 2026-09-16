// Verifies the real-app interrupt: dropping a microsoft-stack location onto the
// Scenarios-scoped diagram-3 (which doesn't frame `location`) must NOT silently
// create a component — it must show an explanatory modal and add no node. Drives
// the production drop path via diagram._fireItemDropped, exactly like a toolbox
// drag of the `microsoft_tech.azure` term.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, cloneCorpus, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')

async function nodeCount(l: Launched): Promise<number> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        return diagram?.ItemsSource?.ToArray ? diagram.ItemsSource.ToArray().length : -1
    })
}

// Fire a toolbox drop of `termId` at (x,y) through the real drop pipeline.
async function fireTermDrop(l: Launched, termId: string, x: number, y: number): Promise<boolean> {
    return l.win.evaluate(({ termId, x, y }) => {
        const S = Symbol.for('mural:visual-backref')
        let diagram: any
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v?.constructor?.name === 'Diagram') { diagram = v; break }
        }
        if (!diagram || typeof diagram._fireItemDropped !== 'function') return false
        const FORMAT = '@pragmatic-tech-ai/mural/toolbox-item'
        const data = { Has: (f: string) => f === FORMAT, Get: (f: string) => (f === FORMAT ? termId : undefined) }
        diagram._fireItemDropped({ Data: data, Position: { X: x, Y: y }, TargetContainer: undefined })
        return true
    }, { termId, x, y })
}

// The visible modal title text, if a dialog is open.
async function dialogText(l: Launched): Promise<string> {
    return l.win.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim())
}

test.describe.serial('dropping a location on a Scenarios diagram is interrupted', () => {
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
        // Open diagram-3 (arch.viewpoints = ["Scenarios"]).
        const { rectsForCtor, clickCenter } = await import('./plexus-app')
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = (navs[1]?.x ?? 60) + (navs[1]?.w ?? 40) + 120
        for (let i = 0; i < 30; i++) {
            if (await l.win.getByText('diagram-3.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300); await l.win.mouse.wheel(0, 300); await l.win.waitForTimeout(150)
        }
        for (let a = 0; a < 4 && (await nodeCount(l)) <= 0; a++) {
            const dd = l.win.getByText('diagram-3.diagram', { exact: true }).first()
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(3500)
        }
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
        if (cloneRoot) fs.rmSync(cloneRoot, { recursive: true, force: true })
    })

    test('shows an explanatory modal and adds no node', async () => {
        const before = await nodeCount(l)
        // Toolbox item id for a library term is `term:<id>` (diagram-panel-services).
        await fireTermDrop(l, 'term:microsoft_tech.azure', 500, 300)
        await l.win.waitForTimeout(1500)
        await l.win.screenshot({ path: path.join(ART, 'drop-rejection.png') }).catch(() => {})
        const after = await nodeCount(l)
        const text = await dialogText(l)
        // eslint-disable-next-line no-console
        console.log('nodes before/after:', before, after, '\nbody incl. modal:', text.slice(0, 600))

        // No node was added (no silent component).
        expect(after, 'no node added by the rejected drop').toBe(before)
        // The explanatory modal is visible: the term name + the fix guidance.
        expect(text).toContain('Azure')
        expect(text.toLowerCase()).toContain('viewpoint')
    })
})
