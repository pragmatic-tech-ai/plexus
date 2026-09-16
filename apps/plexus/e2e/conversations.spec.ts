// Multi-conversation agents smoke.
//
// ChatSessionsService manages parallel agent conversations as right-dock tabs. One
// starter conversation is seeded at boot; this adds a second, routes an event to the
// first only, and verifies the two conversations hold independent transcripts —
// exercising NewConversation + per-session event routing in the real app. Drives the
// manager through the dev-only globalThis.__chats hook (wired in main.js).
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, type Launched } from './plexus-app'

let L: Launched

test.beforeAll(async () => { L = await launchPlexus(); await L.win.waitForTimeout(800) })
test.afterAll(async () => { await L?.app?.close() })

test('boots without app errors', async () => {
    const errs = appErrors(L.errors)
    expect(errs, errs.join('\n')).toEqual([])
})

test('the docked Agent Chat is fixed; extra sessions open as document tabs', async () => {
    const result = await L.win.evaluate(async () => {
        const chats = globalThis.__chats
        const primary = await chats.EnsurePrimary()   // the docked "Agent Chat" (from boot)
        const a = chats.NewConversation()             // a document tab
        const b = chats.NewConversation()             // another document tab
        // Route an assistant-text event to A only (the literal is the value of
        // AgentEventKind.AssistantText — test data crossing the evaluate boundary).
        a.apply({ Kind: 'assistant-text', Text: 'hello A' })
        return {
            primaryTitle: primary.Title,
            primaryListed: chats.Open.ToArray().some((c: { Id: string }) => c.Id === primary.Id),
            a: a.Id, b: b.Id, aCount: a.Transcript.Count, bCount: b.Transcript.Count, openDocs: chats.Open.Count,
        }
    })
    expect(result.primaryTitle).toBe('Agent Chat')   // fixed name
    expect(result.primaryListed).toBe(false)          // the dock chat is not a document
    expect(result.openDocs).toBe(2)                   // only the two document tabs are listed
    expect(result.a).not.toBe(result.b)
    expect(result.aCount).toBe(1)
    expect(result.bCount).toBe(0)
    expect(appErrors(L.errors), appErrors(L.errors).join('\n')).toEqual([])
})

test('the session manager filters by search and renames a conversation inline', async () => {
    const r = await L.win.evaluate(() => {
        const chats = globalThis.__chats
        const a = chats.NewConversation(); a.setTitle('ZZ Billing review')
        chats.NewConversation().setTitle('ZZ Layout pass')
        chats.SearchText = 'billing'
        const filtered = chats.VisibleOpen.ToArray().map((c: { Title: string }) => c.Title)
        chats.SearchText = ''
        // Inline rename via the row commands ('Return' is the value of Key.Return).
        a.BeginRenameCommand.Execute(undefined)
        a.EditTitle = 'ZZ Renamed'
        a.RenameKeyCommand.Execute({ Key: 'Return' })
        return { filtered, renamed: a.Title, visibleAfter: chats.VisibleOpen.Count }
    })
    expect(r.filtered).toEqual(['ZZ Billing review'])
    expect(r.renamed).toBe('ZZ Renamed')
    expect(r.visibleAfter).toBeGreaterThanOrEqual(2)
    expect(appErrors(L.errors), appErrors(L.errors).join('\n')).toEqual([])
})

test('the Approved tools button opens its dialog without error', async () => {
    await L.win.evaluate(() => { globalThis.__chats.OpenApprovedToolsCommand.Execute(undefined) })
    await L.win.waitForTimeout(300)   // let the refresh + dialog render settle
    expect(appErrors(L.errors), appErrors(L.errors).join('\n')).toEqual([])
})
