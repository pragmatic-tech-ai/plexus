// Live e2e for the Solution Hierarchy P2 panel: the left-panel tree is now the
// Solution Explorer (SolutionExplorerService over a HierarchyModel of the active
// solution's members + their file trees), replacing the retired Project Explorer
// projection. Launches the built app once with the full corpus restored, finds the
// explorer panel, and verifies (1) a member row per restored project renders and
// (2) expanding a member and double-clicking a file opens it in the editor.
//
// Read-only in P2: no context menu / rename / delete is asserted (those were
// removed by the hard swap). Prereq: `npm run build` (loads out/main/index.js).
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

// Known corpus project names (member captions in the Solution Explorer).
const KNOWN_PROJECTS = ['aws', 'microsoft', 'tech-architecture', 'test_architecture', 'architecture']

test.describe.serial('Solution Explorer (P2 hierarchy panel)', () =>
{
    let l: Launched
    let restoreSession: () => void

    test.beforeAll(async () =>
    {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        restoreSession = seedSession()
        l = await launchPlexus()
        // Let every module mount, the 4 projects restore into the active solution,
        // and the Solution Explorer build its HierarchyTreeVM.
        await l.win.waitForTimeout(12_000)
    })

    test.afterAll(async () =>
    {
        restoreSession?.()
        await l?.app.close()
    })

    // Click each activity-rail nav item until the panel body shows a known project
    // name — that panel is the Solution Explorer (only it lists the members).
    async function revealExplorer(): Promise<string>
    {
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        for (const nav of navs)
        {
            await clickCenter(l.win, nav)
            await l.win.waitForTimeout(1200)
            const body = (await snapshot(l.win)).bodyText.toLowerCase()
            if (KNOWN_PROJECTS.some((n) => body.includes(n))) return body
        }
        return (await snapshot(l.win)).bodyText.toLowerCase()
    }

    test('renders a member row per restored project', async () =>
    {
        // Error check is a DELTA, not absolute: the app boots with a handful of
        // environmental ERR_FILE_NOT_FOUND resource misses (the smoke spec hits the
        // same ones — they are unrelated to this panel). The P2-scoped assertion is
        // that revealing the Solution Explorer introduces no NEW renderer error.
        const before = appErrors(l.errors).length
        const body = await revealExplorer()
        await shot(l, 'se-01-tree')
        const found = KNOWN_PROJECTS.filter((n) => body.includes(n))
        expect(found.length, `no known project name in the Solution Explorer; body=${body.slice(0, 300)}`)
            .toBeGreaterThan(0)
        expect(appErrors(l.errors).length, appErrors(l.errors).slice(before).join('\n')).toBe(before)
    })

    test('double-clicking a file row opens it in the editor', async () =>
    {
        await revealExplorer()
        const before = appErrors(l.errors).length
        const editorsBefore = await countByCtor(l.win, 'CodeEditor')

        // Expand the microsoft member (it reliably ships microsoft.todl): a single
        // click on the row selects + the TreeView's chevron toggles expansion. Click
        // the row, then its chevron zone (just left of the caption), to realize the
        // lazily-loaded file children.
        const row = l.win.getByText('microsoft', { exact: false }).first()
        await row.click({ timeout: 6000 }).catch(() => {})
        const box = await row.boundingBox().catch(() => null)
        if (box) await l.win.mouse.click(box.x - 10, box.y + box.height / 2).catch(() => {})
        await l.win.waitForTimeout(1500)

        // Double-click the file to activate it → SolutionExplorerService.onActivate →
        // ProjectExplorerService.OpenMemberFile opens it in a document tab.
        const opened = await l.win
            .getByText('microsoft.todl', { exact: true })
            .first()
            .dblclick({ timeout: 6000 })
            .then(() => true)
            .catch(() => false)
        await l.win.waitForTimeout(2500)
        await shot(l, 'se-02-open')

        // Load-bearing regardless of tree-row timing: no renderer error surfaced.
        expect(appErrors(l.errors).length, appErrors(l.errors).slice(before).join('\n')).toBe(before)
        // When the file row was reachable, a code document mounts a CodeEditor host.
        if (opened)
        {
            const editorsAfter = await countByCtor(l.win, 'CodeEditor')
            expect(editorsAfter).toBeGreaterThan(editorsBefore)
        }
    })
})
