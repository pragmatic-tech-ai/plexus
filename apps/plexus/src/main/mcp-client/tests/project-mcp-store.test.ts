import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { ProjectMcpStore } from '../project-mcp-store.js'
import type { McpStoreIo } from '../mcp-server-store.js'
import { McpGatingMode, McpTransportKind, type McpServerEntry } from '../../../shared/mcp-client-api.js'

const entry = (key: string): McpServerEntry => ({
    key, label: key, enabled: true,
    transport: { kind: McpTransportKind.Http, url: 'http://x', headers: {} },
    gating: { mode: McpGatingMode.AllowAll, tools: [] },
})

describe('ProjectMcpStore', () => {
    test('file path is <root>/.plexus/mcp.json', () => {
        expect(ProjectMcpStore.fileFor('/proj')).toBe(join('/proj', '.plexus', 'mcp.json'))
    })
    test('writes/reads under the project root via the io seam', () => {
        let written: { path?: string; body?: string } = {}
        const io: McpStoreIo = { read: () => written.body, write: (p, c) => { written = { path: p, body: c } } }
        const s = new ProjectMcpStore(io, '/proj')
        s.upsert(entry('a'))
        expect(written.path).toBe(join('/proj', '.plexus', 'mcp.json'))
        expect(s.list().map((e) => e.key)).toEqual(['a'])
    })
})
