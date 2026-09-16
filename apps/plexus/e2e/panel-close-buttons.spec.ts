// Panel header button-bar (close / hide) smoke.
//
// Verifies the VSCode-style header affordances added in mural 0.37.0:
//   * The left side pane (ShellSideContentPane) carries a CloseCommand that
//     hides the pane (NavigationService.SidePaneVisible → false); invoking it
//     again reveals it (the toggle behaviour the ✕ + activity-bar re-click use).
//   * The right dock (PanelDockService) ClosePanelCommand closes the ACTIVE
//     inspector — its SelectedPanel — dropping the hosted panel count.
//
// Drives through the live service/visual graph (backref) rather than clicking
// the 12px glyphs, which is what the buttons are wired to anyway.
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, countByCtor, rectsForCtor, type Launched } from './plexus-app'

let L: Launched

test.beforeAll(async () => {
    L = await launchPlexus()
})

test.afterAll(async () => {
    await L?.app?.close()
})

// Read + drive a Visual found by its ctor name (first match). `op` runs in the
// renderer against the live Visual and returns a JSON-serialisable result.
async function onVisual<T>(ctor: string, op: (v: any) => T): Promise<T> {
    return L.win.evaluate(
        ({ ctor, opSrc }) => {
            const S = Symbol.for('mural:visual-backref')
            for (const el of document.querySelectorAll('*')) {
                const v = (el as any)[S]
                if (v && v.constructor?.name === ctor) {
                    // eslint-disable-next-line no-new-func
                    return new Function('v', `return (${opSrc})(v)`)(v)
                }
            }
            throw new Error(`no visual ${ctor}`)
        },
        { ctor, opSrc: op.toString() },
    )
}

// Find a live service instance by scanning DataContexts for its ctor name.
async function onService<T>(ctor: string, op: (s: any) => T): Promise<T> {
    return L.win.evaluate(
        ({ ctor, opSrc }) => {
            const S = Symbol.for('mural:visual-backref')
            for (const el of document.querySelectorAll('*')) {
                const v = (el as any)[S]
                const dc = v?.DataContext
                if (dc && dc.constructor?.name === ctor) {
                    // eslint-disable-next-line no-new-func
                    return new Function('s', `return (${opSrc})(s)`)(dc)
                }
            }
            throw new Error(`no service ${ctor}`)
        },
        { ctor, opSrc: op.toString() },
    )
}

test('boots without app errors', async () => {
    const errs = appErrors(L.errors)
    expect(errs, errs.join('\n')).toEqual([])
})

// Rendered width of the first ShellSideContentPane (0 when collapsed).
async function paneWidth(): Promise<number> {
    const rects = await rectsForCtor(L.win, 'ShellSideContentPane')
    return rects[0]?.w ?? 0
}

test('left side pane close command hides then reveals the pane', async () => {
    // The pane is shown at boot and carries a CloseCommand (the shell wires it
    // to NavigationService.ToggleSidePaneCommand).
    expect(await countByCtor(L.win, 'ShellSideContentPane')).toBeGreaterThan(0)
    const hasClose = await onVisual('ShellSideContentPane', (v) => !!v.CloseCommand)
    expect(hasClose).toBe(true)
    expect(await onService('NavigationService', (s) => s.SidePaneVisible)).toBe(true)
    expect(await paneWidth()).toBeGreaterThan(0)

    // Fire the close ✕ → the pane hides (SidePaneVisible false, collapses).
    await onVisual('ShellSideContentPane', (v) => v.CloseCommand.Execute(undefined))
    await L.win.waitForTimeout(150)
    expect(await onService('NavigationService', (s) => s.SidePaneVisible)).toBe(false)
    expect(await paneWidth()).toBe(0)

    // Toggle again → it comes back (the activity-bar re-click / ✕ toggle).
    await onService('NavigationService', (s) => s.ToggleSidePaneCommand.Execute(undefined))
    await L.win.waitForTimeout(150)
    expect(await onService('NavigationService', (s) => s.SidePaneVisible)).toBe(true)
    expect(await paneWidth()).toBeGreaterThan(0)
})

test('right dock close command closes the active inspector', async () => {
    const before = await onService('PanelDockService', (s) => s.Panels.Count)
    test.skip(before < 1, 'no dock panels hosted at boot')

    const closed = await onService('PanelDockService', (s) => {
        const id = s.SelectedPanel?.Id
        s.ClosePanelCommand.Execute(id)
        return s.Panels.Count
    })
    expect(closed).toBe(before - 1)
})
