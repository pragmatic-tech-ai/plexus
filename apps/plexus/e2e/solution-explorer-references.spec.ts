// Live e2e for the P5a References branch on the Solution Explorer: a resolved
// consumer project shows a `References` node (first child) → Meta-models / Libraries
// groups → one leaf per declared reference (id@version, decorated by resolution), and
// the keyed ReferenceActionsContributor populates Add / Set Version / Remove menus.
//
// Targets the seeded `test_architecture` (architecture; manifest libraries =
// microsoft@0.1.0, aws@0.1.0 → a non-empty Libraries group). LOAD-BEARING assertions:
// the References node renders under the project, the References-node menu offers the
// inline Add action, and revealing/expanding/menu-opening adds NO new renderer error
// (the app boots with a few environmental misses; the branch must add none). Leaf-level
// Set Version / Remove are best-effort against live-tree timing (the P3/P4 convention).
//
// Runs against a CLONE of the corpus, seeded into the restore session. Prereq:
// `npm run build`.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
    launchPlexus,
    seedSession,
    corpusAvailable,
    cloneCorpus,
    appErrors,
    rectsForCtor,
    clickCenter,
    type Launched,
} from './plexus-app'

const ART = path.join(__dirname, '.artifacts')
const shot = (l: Launched, name: string) =>
    l.win.screenshot({ path: path.join(ART, `${name}.png`) }).catch(() => {})

type Rect = { x: number; y: number; w: number; h: number }
type Match = { exact?: string; endsWith?: string; startsWith?: string }

test.describe.serial('Solution Explorer — References branch (P5a)', () =>
{
    let l: Launched
    let restoreSession: () => void
    let clone: { root: string; projects: string[]; archDir: string }

    test.beforeAll(async () =>
    {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        clone = cloneCorpus()
        restoreSession = seedSession(clone.projects)
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)          // modules mount + projects restore + tree builds
    })

    test.afterAll(async () =>
    {
        restoreSession?.()
        await l?.app.close()
        await new Promise((r) => setTimeout(r, 2000))
        if (clone?.root) try { fs.rmSync(clone.root, { recursive: true, force: true }) } catch { /* best-effort */ }
    })

    async function treeRowCount(): Promise<number>
    {
        return l.win.evaluate(() =>
        {
            const S = Symbol.for('mural:visual-backref')
            let n = 0
            for (const el of document.querySelectorAll('*'))
                if ((el as unknown as Record<symbol, { DataContext?: { constructor: { name: string } } }>)[S]?.DataContext?.constructor?.name === 'HierarchyItemVM') n++
            return n
        })
    }

    async function revealExplorer(): Promise<void>
    {
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        for (const nav of navs)
        {
            await clickCenter(l.win, nav)
            await l.win.waitForTimeout(1200)
            if (await treeRowCount() > 0) return
        }
    }

    // Topmost visible tree row whose HierarchyItemVM caption matches — the row Border
    // (leftmost at that y), which carries the ContextMenu.
    async function rowRect(match: Match): Promise<Rect | null>
    {
        return l.win.evaluate((m: Match) =>
        {
            const S = Symbol.for('mural:visual-backref')
            const hits: Rect[] = []
            for (const el of document.querySelectorAll('*'))
            {
                const dc = (el as unknown as Record<symbol, { DataContext?: { constructor: { name: string }; Caption?: unknown } }>)[S]?.DataContext
                if (dc?.constructor?.name !== 'HierarchyItemVM') continue
                const cap = String(dc.Caption)
                const ok = (m.exact !== undefined && cap === m.exact)
                    || (m.endsWith !== undefined && cap.endsWith(m.endsWith))
                    || (m.startsWith !== undefined && cap.startsWith(m.startsWith))
                if (!ok) continue
                const r = (el as Element).getBoundingClientRect()
                if (r.width > 4 && r.height > 4 && r.x >= 0 && r.y >= 0 && r.y < window.innerHeight)
                    hits.push({ x: r.x, y: r.y, w: r.width, h: r.height })
            }
            hits.sort((a, b) => (a.y - b.y) || (a.x - b.x))
            return hits[0] ?? null
        }, match) as Promise<Rect | null>
    }

    // Expand a row: select it (click near the left, over content) then ArrowRight —
    // the reliable expand path (chevron geometry is unreliable). Children realize async.
    async function expandRow(rect: Rect): Promise<void>
    {
        await l.win.mouse.click(rect.x + 20, rect.y + rect.h / 2)
        await l.win.waitForTimeout(400)
        await l.win.keyboard.press('ArrowRight')
        await l.win.waitForTimeout(2200)
    }

    // Right-click a row Border near its left (transparent fill only hit-tests painted content).
    async function rightClickRow(rect: Rect): Promise<void>
    {
        await l.win.mouse.click(rect.x + Math.min(rect.w / 2, 100), rect.y + rect.h / 2, { button: 'right' })
        await l.win.waitForTimeout(700)
    }

    async function menuItems(): Promise<Record<string, { visible: boolean }>>
    {
        return l.win.evaluate(() =>
        {
            const S = Symbol.for('mural:visual-backref')
            const items: Record<string, { visible: boolean }> = {}
            for (const el of document.querySelectorAll('*'))
            {
                const v = (el as unknown as Record<symbol, { constructor: { name: string }; Header?: unknown }>)[S]
                if (v?.constructor?.name !== 'MenuItem') continue
                const r = (el as Element).getBoundingClientRect()
                const key = String(v.Header)
                const prev = items[key] ?? { visible: false }
                items[key] = { visible: prev.visible || (r.width > 0 && r.height > 0) }
            }
            return items
        })
    }

    // Poll for a row (children realize async — the References subtree fetches its view,
    // reading manifests + workspace producers, so it can lag a fixed wait).
    async function waitForRow(match: Match, timeoutMs: number): Promise<Rect | null>
    {
        const deadline = Date.now() + timeoutMs
        for (;;)
        {
            const r = await rowRect(match)
            if (r !== null || Date.now() > deadline) return r
            await l.win.waitForTimeout(400)
        }
    }

    test('References node renders under a project, with groups + leaves, and inline-edit menus', async () =>
    {
        const before = appErrors(l.errors).length
        await revealExplorer()
        expect(await treeRowCount(), 'the Solution Explorer tree is showing').toBeGreaterThan(0)

        // Expand the architecture project (its row caption is the absolute path → endsWith the folder name).
        const member = await rowRect({ endsWith: 'test_architecture' })
        expect(member, 'the test_architecture project row rendered').not.toBeNull()
        await expandRow(member!)
        await shot(l, 'ser-01-project-expanded')

        // LOAD-BEARING: the References node appears as a child of the project.
        const refs = await waitForRow({ exact: 'References' }, 8000)
        expect(refs, 'a References node rendered under the project').not.toBeNull()

        // LOAD-BEARING: the References node's menu offers the inline Add action (the contributor, live).
        await rightClickRow(refs!)
        await shot(l, 'ser-02-references-menu')
        const refsMenu = await menuItems()
        expect(refsMenu['Add Meta-model']?.visible, `Add Meta-model on References node; menu=${Object.keys(refsMenu).join(',')}`).toBe(true)
        await l.win.keyboard.press('Escape').catch(() => {})
        await l.win.waitForTimeout(300)

        // Best-effort (async view fetch + realize timing): the Libraries group, its Add menu,
        // and a declared leaf's Set Version / Remove. When they realize, exercise them.
        await expandRow(refs!)
        const libGroup = await waitForRow({ exact: 'Libraries' }, 8000)
        if (libGroup !== null)
        {
            await rightClickRow(libGroup)
            expect((await menuItems())['Add']?.visible, 'Add on the Libraries group').toBe(true)
            await l.win.keyboard.press('Escape').catch(() => {})
            await l.win.waitForTimeout(300)

            await expandRow(libGroup)
            const leaf = await waitForRow({ startsWith: 'microsoft@' }, 8000)
            if (leaf !== null)
            {
                await rightClickRow(leaf)
                await shot(l, 'ser-03-leaf-menu')
                const leafMenu = await menuItems()
                expect(
                    (leafMenu['Set Version']?.visible ?? false) || (leafMenu['Remove']?.visible ?? false),
                    `Set Version/Remove on a reference leaf; menu=${Object.keys(leafMenu).join(',')}`,
                ).toBe(true)
                await l.win.keyboard.press('Escape').catch(() => {})
            }
        }

        // LOAD-BEARING: revealing/expanding/menus added no NEW renderer error.
        const added = appErrors(l.errors).slice(before)
        expect(added.length, added.join('\n')).toBe(0)
    })
})
