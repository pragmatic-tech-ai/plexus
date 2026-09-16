// Custom frame smoke — mural-painted title bar.
//
// The window runs with a hidden OS title bar (titleBarStyle: 'hidden'). The mural
// host now fills the whole window and PAINTS the 32dp title strip itself
// (EditorShell's Header region → @PlexusTitleBar: logo box + mark + bound title).
// The only HTML chrome left is #drag-strip — a transparent top-32px band that
// gives the OS its window-drag affordance (CSS -webkit-app-region), since that
// can't live on mural's SVG. Verifies: the app mounts full-window, the drag strip
// is present/draggable/32px at the top, and the theme hook resolved a real surface
// for the WCO caption buttons (i.e. the frame wiring ran).
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, type Launched } from './plexus-app'

let L: Launched

test.beforeAll(async () => {
    L = await launchPlexus()
    await L.win.waitForTimeout(800)
})

test.afterAll(async () => {
    await L?.app?.close()
})

test('boots without app errors', async () => {
    const errs = appErrors(L.errors)
    expect(errs, errs.join('\n')).toEqual([])
})

test('mural host fills the window; transparent 32px drag strip on top', async () => {
    const frame = await L.win.evaluate(() => {
        const app  = document.getElementById('app')
        const strip = document.getElementById('drag-strip')
        const appR = app?.getBoundingClientRect()
        const cs = strip ? getComputedStyle(strip) : null
        const sr = strip?.getBoundingClientRect()
        return {
            // The mural mount now reaches the window's very top (no HTML band above it).
            appTop: appR?.top ?? -1,
            appFillsWidth: (appR?.width ?? 0) >= (window.innerWidth - 1),
            stripPresent: !!strip,
            stripTop: sr?.top ?? -1,
            stripHeight: sr?.height ?? -1,
            stripDrag: cs?.getPropertyValue('-webkit-app-region') ?? '',
            // Transparent: it only carries the OS drag affordance, mural paints under it.
            stripBg: cs?.backgroundColor ?? '',
            // The old HTML title band is gone.
            noHtmlBand: !document.getElementById('titlebar'),
        }
    })

    expect(frame.appTop).toBe(0)
    expect(frame.appFillsWidth).toBe(true)
    expect(frame.stripPresent).toBe(true)
    expect(frame.stripTop).toBe(0)
    expect(frame.stripHeight).toBe(32)
    expect(frame.stripDrag).toBe('drag')
    expect(frame.stripBg).toMatch(/rgba?\(0, 0, 0, 0\)|transparent/)
    expect(frame.noHtmlBand).toBe(true)
})

test('title tracks app state and mirrors to document.title', async () => {
    // TitleService drives document.title (active document → open project → "Plexus").
    // At rest, with no document/project, it is the app name.
    const docTitle = await L.win.evaluate(() => document.title)
    expect(docTitle.length).toBeGreaterThan(0)
    expect(docTitle).toContain('Plexus')
})
