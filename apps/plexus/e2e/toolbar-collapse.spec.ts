// Command toolbar collapse smoke.
//
// The shell's command toolbar (PART_CommandHost) is bound
// `Visibility = ActiveDocument << ToVisibility`, so with no document open it
// collapses out of layout rather than leaving a bare @SurfaceContainer strip
// under the title bar. Verifies the collapsed state at boot (the corpus restores
// projects but no document). The shown state is the inverse of the same binding
// the adjacent Save cluster already uses.
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, type Launched } from './plexus-app'

test('command toolbar is collapsed when no document is active', async () => {
    const L: Launched = await launchPlexus()
    try {
        await L.win.waitForTimeout(900)
        const hostHeight = await L.win.evaluate(() => {
            const S = Symbol.for('mural:visual-backref')
            for (const el of document.querySelectorAll('*')) {
                const v = (el as { [k: symbol]: { Name?: string } })[S]
                if (v && v.Name === 'PART_CommandHost') {
                    return (el as Element).getBoundingClientRect().height
                }
            }
            return null // not realized at all — also "collapsed"
        })
        expect(hostHeight === null || hostHeight === 0).toBe(true)
        expect(appErrors(L.errors), appErrors(L.errors).join('\n')).toEqual([])
    } finally {
        await L.app.close()
    }
})
