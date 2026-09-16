// PHASE A gate: prove a plexus-core .mu resolves across the package boundary and
// the app boots with it merged. Removed in Phase B once real shared resources land.
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, type Launched } from './plexus-app'

test('plexus-core probe: cross-package .mu resolves and the app boots', async () => {
    const app: Launched = await launchPlexus()
    const { win, errors } = app
    try {
        await win.waitForTimeout(3000)
        const ok = await win.evaluate(() => (globalThis as { __coreProbe?: () => boolean }).__coreProbe?.() === true)
        expect(ok, 'ProbeResources imported + merged from plexus-core').toBe(true)
        expect(appErrors(errors), 'no app errors').toEqual([])
    } finally {
        await app.app.close()
    }
})
