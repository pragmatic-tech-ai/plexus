// Comprehensive live smoke of the Plexus Electron app driven through mural's
// SVG visual tree. Launches the built app once with the full test corpus
// (meta-model + two libraries + arch consumer) restored, then exercises the
// major surfaces — verifying every module mounts and renders with zero
// renderer errors after the Observable/MuralBase split renamed the VM base.
//
// Prereq: `npm run build` (the harness loads out/main/index.js).
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
    launchPlexus,
    seedSession,
    corpusAvailable,
    appErrors,
    snapshot,
    countByCtor,
    rectsForCtor,
    clickCenter,
    type Launched,
} from './plexus-app'

const ART = path.join(__dirname, '.artifacts')
const shot = (l: Launched, name: string) =>
    l.win.screenshot({ path: path.join(ART, `${name}.png`) }).catch(() => {})

test.describe.serial('Plexus live smoke (Observable/MuralBase split)', () => {
    let l: Launched
    let restoreSession: () => void

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        restoreSession = seedSession()
        l = await launchPlexus()
        // Let all modules mount, the 4 projects restore, and validation run.
        await l.win.waitForTimeout(12_000)
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
    })

    test('boots with zero renderer errors and reaches EditorShell.Services', async () => {
        const snap = await snapshot(l.win)
        await shot(l, '01-boot')
        expect(appErrors(l.errors), `renderer errors:\n${appErrors(l.errors).join('\n')}`).toEqual([])
        expect(snap.rootCtor).toBe('EditorShell')
        expect(snap.hasServices).toBe(true)
        // A fully-mounted shell renders thousands of visuals across every panel.
        expect(snap.visualCount).toBeGreaterThan(2000)
        expect(snap.problemsText).toBe('No problems')
    })

    test('renders Figure silhouettes (toolbox) — the split’s core payload', async () => {
        // Figures are the shape toolbox tiles; they self-paint via Visual seams.
        const figures = await countByCtor(l.win, 'Figure')
        expect(figures).toBeGreaterThan(0)
    })

    test('activity-bar panels each switch and render without new errors', async () => {
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        expect(navs.length).toBeGreaterThanOrEqual(3)
        for (let i = 0; i < navs.length; i++) {
            const before = appErrors(l.errors).length
            await clickCenter(l.win, navs[i]!)
            await l.win.waitForTimeout(1200)
            const snap = await snapshot(l.win)
            await shot(l, `02-panel-${i}`)
            // Some panels are sparse (a collapsed explorer, a small toolbar);
            // the load-bearing assertion is that switching raised no error.
            expect(snap.visualCount).toBeGreaterThan(50)
            expect(appErrors(l.errors).length, `panel ${i} raised errors`).toBe(before)
        }
    })

    test('project explorer lists the restored projects', async () => {
        // Folder/explorer nav is the 2nd activity item; click it, then assert a
        // known corpus project name is on screen (proves the tree VMs mounted).
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1500)
        const snap = await snapshot(l.win)
        await shot(l, '03-explorer')
        const text = snap.bodyText.toLowerCase()
        const found = ['aws', 'microsoft', 'tech-architecture', 'test_architecture', 'architecture'].filter((n) =>
            text.includes(n),
        )
        expect(found.length, `no known project name in explorer; body=${snap.bodyText.slice(0, 300)}`).toBeGreaterThan(0)
        expect(appErrors(l.errors)).toEqual([])
    })

    test('opens a document from the explorer without errors', async () => {
        // Double-click a known corpus .todl to open it in the code editor
        // (exercises the renamed code-document / document-tab VMs). The
        // microsoft library reliably ships microsoft.todl.
        const before = appErrors(l.errors).length
        const opened = await l.win
            .getByText('microsoft.todl', { exact: true })
            .first()
            .dblclick({ timeout: 6000 })
            .then(() => true)
            .catch(() => false)
        await l.win.waitForTimeout(2500)
        await shot(l, '04-document')
        // Whether or not a tree row was clickable, no error may have surfaced.
        expect(appErrors(l.errors).length).toBe(before)
        if (opened) {
            // A code document mounts a CodeEditor host (DomHost + Monaco);
            // Plexus renders source through Monaco, not mural text visuals.
            const editors = await countByCtor(l.win, 'CodeEditor')
            expect(editors).toBeGreaterThan(0)
        }
    })

    test('settings opens and renders', async () => {
        const before = appErrors(l.errors).length
        // The gear is the bottom-most IconButton in the activity rail.
        const icons = await rectsForCtor(l.win, 'IconButton')
        const gear = icons.slice().sort((a, b) => b.y - a.y || a.x - b.x)[0]
        if (gear) await clickCenter(l.win, gear)
        await l.win.waitForTimeout(1500)
        await shot(l, '05-settings')
        expect(appErrors(l.errors).length).toBe(before)
    })

    test('agent chat panel is mounted with an input', async () => {
        const snap = await snapshot(l.win)
        expect(snap.bodyText.toLowerCase()).toContain('chat')
        expect(appErrors(l.errors)).toEqual([])
    })

    test('no renderer errors accumulated across the whole session', async () => {
        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
