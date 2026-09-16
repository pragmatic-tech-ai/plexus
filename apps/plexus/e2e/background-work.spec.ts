// Background Work subsystem smoke.
//
// The BackgroundWorkService runs background operations behind a pluggable-executor
// abstraction and surfaces each as a live entry in the status bar. This drives a
// demo task through the dev-only window.__bgDemo hook (wired in main.js) and
// verifies it runs to completion — exercising submit -> executor -> report/log ->
// result end-to-end in the real app.
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, type Launched } from './plexus-app'

let L: Launched

test.beforeAll(async () => { L = await launchPlexus(); await L.win.waitForTimeout(800) })
test.afterAll(async () => { await L?.app?.close() })

test('boots without app errors', async () => {
    const errs = appErrors(L.errors)
    expect(errs, errs.join('\n')).toEqual([])
})

test('a submitted task runs and completes', async () => {
    const finished = await L.win.evaluate(async () => {
        const { done } = globalThis.__bgDemo()
        return await done
    })
    expect(finished).toBe('done')
})
