import { describe, test, expect } from 'vitest'
import { McpServerStore, type McpStoreIo } from '../mcp-server-store.js'
import { McpGatingMode, McpTransportKind, type McpServerEntry } from '../../../shared/mcp-client-api.js'

function memIo(seed?: string): McpStoreIo {
    const box: { last?: string } = { last: seed }
    return { read: () => box.last, write: (_p, c) => { box.last = c } }
}
const entry = (key: string): McpServerEntry => ({
    key, label: key, enabled: true,
    transport: { kind: McpTransportKind.Stdio, command: 'x', args: [], env: {} },
    gating: { mode: McpGatingMode.Prompt, tools: [] },
})

describe('McpServerStore', () => {
    test('upsert then list round-trips and persists', () => {
        const io = memIo()
        const s = new McpServerStore(io, 'p.json')
        s.upsert(entry('a'))
        expect(s.list().map((e) => e.key)).toEqual(['a'])
        // a fresh store over the same io sees the persisted entry
        expect(new McpServerStore(io, 'p.json').list().map((e) => e.key)).toEqual(['a'])
    })
    test('upsert replaces by key; remove drops it', () => {
        const s = new McpServerStore(memIo(), 'p.json')
        s.upsert(entry('a')); s.upsert({ ...entry('a'), label: 'renamed' })
        expect(s.list()).toHaveLength(1)
        expect(s.list()[0].label).toBe('renamed')
        s.remove('a')
        expect(s.list()).toHaveLength(0)
    })
    test('malformed json degrades to empty', () => {
        expect(new McpServerStore(memIo('{not json'), 'p.json').list()).toEqual([])
    })
})
