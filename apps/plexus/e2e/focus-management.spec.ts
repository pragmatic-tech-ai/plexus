// Live smoke for focus management (mural 0.33.0):
//  - Activating a diagram document lands keyboard focus on its root control (the
//    canvas) via ContentPresenter.FocusContentOnActivate, so the document host
//    reads as the focused pane (IsKeyboardFocusWithin true up the ancestor chain).
//  - Clicking a node keeps focus on the diagram (the tunnel OnPreviewPointerDown
//    focuses before a Figure consumes the click).
// Unit tests spy Focus(); this proves the LIVE InputManager path in the real app.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { launchPlexus, seedSession, corpusAvailable, appErrors, rectsForCtor, clickCenter, type Launched } from './plexus-app'

const ART = path.join(__dirname, '.artifacts')

// The live focus picture: whether the active diagram canvas is focused, and
// whether the document-host tab control contains focus (the active-pane state).
async function focusState(l: Launched): Promise<{ canvasFocused: boolean; hostFocusWithin: boolean; focusedCtor: string | undefined }> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let canvasFocused = false
        let hostFocusWithin = false
        let focusedCtor: string | undefined
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (!v) continue
            const ctor = v.constructor?.name
            if (ctor === 'Diagram' && v.IsFocused) canvasFocused = true
            if (v.IsFocused) focusedCtor = ctor
            if (ctor === 'ExtendedTabControl' && v.IsKeyboardFocusWithin) hostFocusWithin = true
        }
        return { canvasFocused, hostFocusWithin, focusedCtor }
    })
}

async function archNodeCount(l: Launched): Promise<number> {
    return l.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let n = 0
        for (const el of document.querySelectorAll('*')) {
            const v = (el as any)[S]
            if (v && v.constructor?.name === 'Figure' && v.Tag?.constructor?.name === 'ArchNodeVM') n++
        }
        return n
    })
}

test.describe.serial('focus management (live)', () => {
    let l: Launched
    let restoreSession: () => void

    test.beforeAll(async () => {
        test.skip(!corpusAvailable(), 'built app (out/) or test corpus not available')
        fs.mkdirSync(ART, { recursive: true })
        restoreSession = seedSession()
        l = await launchPlexus()
        await l.win.waitForTimeout(12_000)
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
        for (let attempt = 0; attempt < 3 && (await archNodeCount(l)) === 0; attempt++) {
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

    test('activating a diagram focuses its canvas and the host shows the active-pane state', async () => {
        expect(await archNodeCount(l), 'diagram opened with nodes').toBeGreaterThan(0)
        // Activation (opening the doc) should have focused the canvas via
        // FocusContentOnActivate — give the focus microtask a beat.
        await l.win.waitForTimeout(500)
        await l.win.screenshot({ path: path.join(ART, 'focus-00-activated.png') }).catch(() => {})
        const onActivate = await focusState(l)
        expect(onActivate.canvasFocused, `focused ctor was ${onActivate.focusedCtor}`).toBe(true)
        expect(onActivate.hostFocusWithin, 'the document host reads as the focused pane').toBe(true)

        // Clicking a node keeps focus on the diagram (tunnel focus pre-empts the
        // node consuming the click).
        const figs = (await rectsForCtor(l.win, 'Figure')).filter((f) => f.w > 40 && f.h > 20)
        expect(figs.length, 'has a clickable node').toBeGreaterThan(0)
        await clickCenter(l.win, figs[0]!)
        await l.win.waitForTimeout(300)
        const afterClick = await focusState(l)
        expect(afterClick.canvasFocused, 'clicking a node keeps the diagram focused').toBe(true)

        expect(appErrors(l.errors), appErrors(l.errors).join('\n')).toEqual([])
    })
})
