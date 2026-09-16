// VSCode-style composer smoke.
//
// The docked "Agent Chat" renders the ChatSession composer: a multiline TextBox
// with SubmitsOnEnter + a placeholder, a model ComboBox, and an add-context
// button; the ChatSession VM seeds the model list (Default selected) and tracks
// added-context chips. Drives the manager via the dev-only globalThis.__chats
// hook and introspects the live visual tree via the mural visual-backref — never
// DOM-clicks mural buttons (an invisible hit-rect intercepts pointer events).
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, type Launched } from './plexus-app'

let L: Launched

test.beforeAll(async () => {
    L = await launchPlexus()
    await L.win.waitForTimeout(800)
    // Ensure the docked Agent Chat exists + is rendered before we introspect.
    await L.win.evaluate(async () => { await globalThis.__chats.EnsurePrimary() })
    await L.win.waitForTimeout(600)
})
test.afterAll(async () => { await L?.app?.close() })

test('boots without app errors', async () => {
    const errs = appErrors(L.errors)
    expect(errs, errs.join('\n')).toEqual([])
})

test('the ChatSession VM seeds the model picker (Default) and tracks context', async () => {
    const r = await L.win.evaluate(async () => {
        const primary = await globalThis.__chats.EnsurePrimary()
        primary.addContextItem('C:/proj/src', true)
        const dirs = primary.ContextItems.ToArray().map((c: { Dir: string }) => c.Dir)
        const hadContext = primary.HasContext
        primary.ContextItems.ToArray()[0].RemoveCommand.Execute(undefined)   // chip ✕
        return {
            modelCount: primary.Models.Count,
            defaultAlias: primary.Model(),
            dirs,
            hadContext,
            clearedContext: primary.HasContext,
        }
    })
    expect(r.modelCount).toBeGreaterThan(1)   // Default + Opus/Sonnet/Haiku
    expect(r.defaultAlias).toBe('')           // Default omits --model
    expect(r.dirs).toEqual(['C:/proj/src'])
    expect(r.hadContext).toBe(true)
    expect(r.clearedContext).toBe(false)
})

test('the composer renders a SubmitsOnEnter multiline TextBox with a placeholder', async () => {
    const r = await L.win.evaluate(() => {
        const S = Symbol.for('mural:visual-backref')
        let composer: { placeholder: string } | undefined
        let combo = false
        for (const el of document.querySelectorAll('*')) {
            const v = (el as unknown as Record<symbol, { constructor?: { name?: string }; SubmitsOnEnter?: boolean; Placeholder?: string; DataContext?: { constructor?: { name?: string } } }>)[S]
            if (!v) continue
            const name = v.constructor?.name
            if (name === 'TextBox' && v.SubmitsOnEnter === true && (v.Placeholder ?? '') !== '') {
                composer = { placeholder: v.Placeholder as string }
            }
            if (name === 'ComboBox' && v.DataContext?.constructor?.name === 'ChatSession') combo = true
        }
        return { hasComposer: composer !== undefined, placeholder: composer?.placeholder ?? '', combo }
    })
    expect(r.hasComposer).toBe(true)
    expect(r.placeholder.length).toBeGreaterThan(0)
    expect(r.combo).toBe(true)
    expect(appErrors(L.errors), appErrors(L.errors).join('\n')).toEqual([])
})

test('a running turn flips the composer to busy; StopCommand interrupts back to idle', async () => {
    const r = await L.win.evaluate(async () => {
        const primary = await globalThis.__chats.EnsurePrimary()
        const before = { busy: primary.IsBusy, idle: primary.IsIdle }
        primary.Reducer.beginUserTurn('do a thing')   // a turn starts running
        const during = { busy: primary.IsBusy, idle: primary.IsIdle }
        primary.StopCommand.Execute(undefined)         // interrupt it
        const after = { busy: primary.IsBusy, idle: primary.IsIdle }
        return { before, during, after }
    })
    expect(r.before).toEqual({ busy: false, idle: true })
    expect(r.during).toEqual({ busy: true, idle: false })
    expect(r.after).toEqual({ busy: false, idle: true })
    expect(appErrors(L.errors), appErrors(L.errors).join('\n')).toEqual([])
})
