import { describe, test, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { McpClient } from '../mcp-client.js'
import { ValueSourceResolver } from '../value-source.js'
import { McpGatingMode, McpTransportKind, type McpServerEntry } from '../../../shared/mcp-client-api.js'

const here = dirname(fileURLToPath(import.meta.url))
const stub = join(here, 'fixtures', 'stub-stdio-server.mjs')
const entry: McpServerEntry = {
    key: 'stub', label: 'stub', enabled: true, gating: { mode: McpGatingMode.Prompt, tools: [] },
    transport: { kind: McpTransportKind.Stdio, command: process.execPath, args: [stub], env: {} },
}

describe('McpClient', () => {
    test('probe reports ok + tool count against a stub stdio server', async () => {
        const res = await new McpClient(new ValueSourceResolver({})).probe(entry)
        expect(res.ok).toBe(true)
        expect(res.toolCount).toBe(2)
    }, 20_000)
    test('listTools returns the tool names', async () => {
        const tools = await new McpClient(new ValueSourceResolver({})).listTools(entry)
        expect(tools.sort()).toEqual(['alpha', 'beta'])
    }, 20_000)
    test('probe on a bad command returns ok:false with an error', async () => {
        const bad: McpServerEntry = { ...entry, transport: { kind: McpTransportKind.Stdio, command: 'definitely-not-a-real-binary-xyz', args: [], env: {} } }
        const res = await new McpClient(new ValueSourceResolver({})).probe(bad)
        expect(res.ok).toBe(false)
        expect(res.error).toBeTruthy()
    }, 20_000)
})
