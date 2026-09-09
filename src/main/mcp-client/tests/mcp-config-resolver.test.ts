import { describe, test, expect } from 'vitest'
import { McpConfigResolver, type BaseMcp } from '../mcp-config-resolver.js'
import { McpServerStore } from '../mcp-server-store.js'
import { ValueSourceResolver } from '../value-source.js'
import { McpGatingMode, McpTransportKind, ValueSourceKind, type McpServerEntry } from '../../../shared/mcp-client-api.js'

function store(entries: McpServerEntry[]): McpServerStore {
    const s = new McpServerStore({ read: () => undefined, write: () => {} }, 'x')
    for (const e of entries) s.upsert(e)
    return s
}
const base: BaseMcp = {
    servers: { plexus: { type: 'http', url: 'http://127.0.0.1:5000/mcp', tagSession: true } },
    allowedTools: ['mcp__plexus__ask_user_question', 'Read'],
}
const stdio = (key: string, gating: McpServerEntry['gating']): McpServerEntry => ({
    key, label: key, enabled: true, gating,
    transport: { kind: McpTransportKind.Stdio, command: 'srv', args: ['--x'], env: {} },
})

describe('McpConfigResolver', () => {
    test('always includes the base plexus server + base allowedTools', () => {
        const r = new McpConfigResolver(store([]), () => undefined, base, new ValueSourceResolver({}))
        const o = r.resolve('/any')
        expect(o.servers.plexus).toBeDefined()
        expect(o.allowedTools).toContain('Read')
    })
    test('gating AllowAll adds mcp__<key>; PerTool adds each tool; Prompt adds nothing', () => {
        const r = new McpConfigResolver(store([
            stdio('a', { mode: McpGatingMode.AllowAll, tools: [] }),
            stdio('b', { mode: McpGatingMode.PerTool, tools: ['t1', 't2'] }),
            stdio('c', { mode: McpGatingMode.Prompt, tools: [] }),
        ]), () => undefined, base, new ValueSourceResolver({}))
        const allowed = r.resolve('/any').allowedTools
        expect(allowed).toContain('mcp__a')
        expect(allowed).toContain('mcp__b__t1')
        expect(allowed).toContain('mcp__b__t2')
        expect(allowed).not.toContain('mcp__c')
    })
    test('project entry overrides a global entry of the same key', () => {
        const global = store([stdio('a', { mode: McpGatingMode.Prompt, tools: [] })])
        const proj = store([stdio('a', { mode: McpGatingMode.AllowAll, tools: [] })])
        const r = new McpConfigResolver(global, () => proj, base, new ValueSourceResolver({}))
        expect(r.resolve('/proj').allowedTools).toContain('mcp__a')
    })
    test('disabled entry is excluded', () => {
        const r = new McpConfigResolver(store([{ ...stdio('a', { mode: McpGatingMode.AllowAll, tools: [] }), enabled: false }]),
            () => undefined, base, new ValueSourceResolver({}))
        expect(r.resolve('/any').servers.a).toBeUndefined()
    })
    test('a server whose env var is missing is skipped', () => {
        const withEnv: McpServerEntry = {
            key: 'a', label: 'a', enabled: true, gating: { mode: McpGatingMode.AllowAll, tools: [] },
            transport: { kind: McpTransportKind.Stdio, command: 'srv', args: [], env: { KEY: { kind: ValueSourceKind.Env, value: 'MISSING' } } },
        }
        const r = new McpConfigResolver(store([withEnv]), () => undefined, base, new ValueSourceResolver({}))
        expect(r.resolve('/any').servers.a).toBeUndefined()
    })
})
