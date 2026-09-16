// Project agent/skill runner smoke.
//
// listAgentsAndSkills returns a well-formed catalog for a directory (no throw), and
// RunAgentSkill opens a titled conversation + submits a Background Work task —
// exercising discovery + run wiring end-to-end. Uses the dev hooks wired in main.js.
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, type Launched } from './plexus-app'

let L: Launched

test.beforeAll(async () => { L = await launchPlexus(); await L.win.waitForTimeout(800) })
test.afterAll(async () => { await L?.app?.close() })

test('listAgentsAndSkills returns a catalog shape without error', async () => {
    const shape = await L.win.evaluate(async () => {
        const c = await globalThis.api.agent.listAgentsAndSkills('/tmp/does-not-exist')
        return { agents: Array.isArray(c.agents), skills: Array.isArray(c.skills) }
    })
    expect(shape).toEqual({ agents: true, skills: true })
    expect(appErrors(L.errors), appErrors(L.errors).join('\n')).toEqual([])
})

test('RunAgentSkill opens a titled conversation and adds a background task', async () => {
    const result = await L.win.evaluate(() => {
        const before = globalThis.__chats.Open.Count
        const chat = globalThis.__runAgent()
        return { title: chat.Title, grew: globalThis.__chats.Open.Count === before + 1 }
    })
    expect(result.title).toBe('demo-skill · Demo')
    expect(result.grew).toBe(true)
    expect(appErrors(L.errors), appErrors(L.errors).join('\n')).toEqual([])
})
