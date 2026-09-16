// Live check: F2 / double-click on an architecture node edits its TITLE
// ($Label), not the container Figure's blank ShapeText.
//
// F2 and double-click funnel through the SAME line — resolveEditTarget(container)
// ?.BeginEdit() (mural diagram.ts F2 handler + figure.ts double-click). Making
// ArchNodeVM IEditable (it now exposes BeginEdit) is what flips resolveEditTarget
// from the fallback ShapeText to the node itself. This harness drives the
// double-click gesture because Playwright cannot inject a key event into mural's
// own focus route (verified: F2 is inert here even on a plain geometric shape,
// whose F2 edits ShapeText — a harness limitation, not app behaviour). Since both
// gestures call the identical resolveEditTarget path, double-click entering the
// title editor is the definitive proof the routing target changed.
//
// Cancel-only — never commits — so no model.save() runs. Still, run it against a
// scratch copy of the corpus (PLEXUS_TEST_CORPUS) as a belt-and-braces guard.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, appErrors, rectsForCtor, clickCenter, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')
const shot = (l: Launched, name: string) =>
    l.win.screenshot({ path: path.join(ART, `${name}.png`) }).catch(() => {})

// Every arch node's { label, editing state, container rect }, resolving each
// ArchNodeVM through its container Figure's Tag (Selector.exposedValueOf).
async function archNodes(l: Launched): Promise<
    Array<{ label: string; editing: boolean; editingLabel: string; x: number; y: number; w: number; h: number }>
> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        const out: Array<{ label: string; editing: boolean; editingLabel: string; x: number; y: number; w: number; h: number }> = []
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (!v || v.constructor?.name !== 'Figure') continue
            const tag = v.Tag
            if (!tag || tag.constructor?.name !== 'ArchNodeVM') continue
            const r = (el as Element).getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue
            out.push({ label: tag.Label, editing: !!tag.IsEditing, editingLabel: tag.EditingLabel, x: r.x, y: r.y, w: r.width, h: r.height })
        }
        return out
    })
}

// VISIBLE (non-zero rect) inline editors. Each arch tile carries a collapsed
// editor TextBox in its template; only the one revealed by $IsEditing lays out
// with a real rect. Counted as a DELTA over the ambient baseline (chat input,
// etc.) so unrelated TextBoxes don't skew the assertion.
function visibleTextBoxes(l: Launched): Promise<number> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let n = 0
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (!v || v.constructor?.name !== 'TextBox') continue
            const r = (el as Element).getBoundingClientRect()
            if (r.width > 0 && r.height > 0) n++
        }
        return n
    })
}

test.describe.serial('arch node title edit', () => {
    let l: Launched
    let restoreSession: () => void

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        restoreSession = seedSession()
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)

        // Open the project explorer (activity-rail NavigationItem[1]), wheel the
        // virtualized tree until diagram-2.diagram (arch nodes) renders, then open it.
        const navs = await rectsForCtor(l.win, 'NavigationItem')
        if (navs[1]) await clickCenter(l.win, navs[1])
        await l.win.waitForTimeout(1200)
        const scrollX = navs[1]!.x + navs[1]!.w + 120
        for (let i = 0; i < 16; i++) {
            if (await l.win.getByText('diagram-2.diagram', { exact: true }).count()) break
            await l.win.mouse.move(scrollX, 300)
            await l.win.mouse.wheel(0, 400)
            await l.win.waitForTimeout(250)
        }
        for (let attempt = 0; attempt < 3 && (await archNodes(l)).length === 0; attempt++) {
            const dd = l.win.getByText('diagram-2.diagram', { exact: true }).first()
            await dd.scrollIntoViewIfNeeded().catch(() => {})
            await dd.dblclick({ timeout: 4000 }).catch(() => {})
            await l.win.waitForTimeout(3500)
        }
    })

    test.afterAll(async () => {
        restoreSession?.()
        await l?.app.close()
    })

    test('double-click opens a title editor seeded with the node label; Escape cancels', async () => {
        const before = await archNodes(l)
        await shot(l, 'f2-00-canvas')
        expect(before.length, 'expected arch nodes on diagram-2').toBeGreaterThan(0)
        expect(before.every((n) => !n.editing)).toBe(true)
        const baseBoxes = await visibleTextBoxes(l)

        // Double-click the icon area of the first arch node (its title is below).
        const node = before[0]!
        await l.win.mouse.dblclick(node.x + node.w / 2, node.y + node.h * 0.35)
        await l.win.waitForTimeout(700)
        await shot(l, 'f2-01-editing')

        // Exactly the clicked node is now editing, its buffer seeded from the TITLE
        // (Label) — the title editor engaged, NOT the blank ShapeText. A visible
        // inline TextBox appeared too (the editor the $IsEditing trigger reveals).
        const during = await archNodes(l)
        const editing = during.filter((n) => n.editing)
        expect(editing.length, 'exactly one node should be editing').toBe(1)
        expect(editing[0]!.editingLabel).toBe(node.label)
        expect(await visibleTextBoxes(l), 'an inline editor is now shown').toBeGreaterThan(baseBoxes)

        // Escape cancels — no commit, no save. Editor gone, every title unchanged.
        await l.win.keyboard.press('Escape')
        await l.win.waitForTimeout(600)
        await shot(l, 'f2-02-cancelled')
        const after = await archNodes(l)
        expect(after.every((n) => !n.editing)).toBe(true)
        expect(after.map((n) => n.label).sort()).toEqual(before.map((n) => n.label).sort())

        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
