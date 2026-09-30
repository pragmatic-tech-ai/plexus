// Live e2e for the P5b Connections branch on the Solution Explorer: a global `Connections`
// node renders under the solution root (leading the project rows), its keyed
// ConnectionActionsContributor offers the inline "New Connection…" action, and a consumer
// project shows a per-project "Active connection: …" row. LOAD-BEARING assertions: the
// Connections node renders, its menu offers New Connection…, and revealing/expanding/menu-
// opening adds NO new renderer error (the branch must add none). The per-project active row and
// any leaf-level menus are best-effort against live-tree timing (the P3/P4/P5a convention).
//
// READ-ONLY: connections are user-global (<userData>/connections.json). The test never creates,
// edits, or removes a connection — it only asserts the branch renders and its menus populate —
// so it neither depends on nor mutates the developer's real connection store.
//
// Runs against a CLONE of the corpus, seeded into the restore session. Prereq: `npm run build`.
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

test.describe.serial('Solution Explorer — Connections branch (P5b)', () =>
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

    async function expandRow(rect: Rect): Promise<void>
    {
        await l.win.mouse.click(rect.x + 20, rect.y + rect.h / 2)
        await l.win.waitForTimeout(400)
        await l.win.keyboard.press('ArrowRight')
        await l.win.waitForTimeout(2200)
    }

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

    test('Connections node renders under the solution with a New Connection action, no new errors', async () =>
    {
        const before = appErrors(l.errors).length
        await revealExplorer()
        expect(await treeRowCount(), 'the Solution Explorer tree is showing').toBeGreaterThan(0)

        // LOAD-BEARING: the global Connections node renders (a root row under the solution).
        const connections = await waitForRow({ exact: 'Connections' }, 8000)
        expect(connections, 'a Connections node rendered under the solution').not.toBeNull()
        await shot(l, 'sec-01-connections-node')

        // LOAD-BEARING: the Connections node's menu offers the inline New Connection action.
        await rightClickRow(connections!)
        await shot(l, 'sec-02-connections-menu')
        const menu = await menuItems()
        expect(menu['New Connection…']?.visible, `New Connection… on the Connections node; menu=${Object.keys(menu).join(',')}`).toBe(true)
        await l.win.keyboard.press('Escape').catch(() => {})
        await l.win.waitForTimeout(300)

        // Best-effort: a consumer project shows a per-project "Active connection: …" row when
        // expanded (architecture is a consumer → the row leads its file tree).
        const member = await rowRect({ endsWith: 'test_architecture' })
        if (member !== null)
        {
            await expandRow(member)
            const active = await waitForRow({ startsWith: 'Active connection' }, 8000)
            if (active !== null) await shot(l, 'sec-03-active-connection-row')
        }

        // LOAD-BEARING: revealing/expanding/menus added no NEW renderer error.
        const added = appErrors(l.errors).slice(before)
        expect(added.length, added.join('\n')).toBe(0)
    })
})
