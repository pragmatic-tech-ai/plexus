import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { ClaudeConfigImporter } from '../claude-config-importer.js'
import { McpGatingMode, McpTransportKind, ValueSourceKind } from '../../../shared/mcp-client-api.js'

const home = '/home/u'
const claudeJson = JSON.stringify({
    mcpServers: {
        fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'], env: { API_KEY: '${MY_KEY}' } },
        remote: { type: 'http', url: 'https://mcp.example/api', headers: { Authorization: 'Bearer xyz' } },
    },
})

describe('ClaudeConfigImporter', () => {
    const io = { read: (p: string) => (p === join(home, '.claude.json') ? claudeJson : undefined) }
    test('maps stdio + http servers to entries with Prompt gating', () => {
        const cands = new ClaudeConfigImporter(io, home).candidates()
        const fs = cands.find((c) => c.key === 'fs')!
        expect(fs.transport.kind).toBe(McpTransportKind.Stdio)
        expect(fs.gating.mode).toBe(McpGatingMode.Prompt)
        expect(fs.enabled).toBe(true)
        // ${MY_KEY} becomes an env value source
        const env = (fs.transport as { env: Record<string, unknown> }).env.API_KEY
        expect(env).toEqual({ kind: ValueSourceKind.Env, value: 'MY_KEY' })
        const remote = cands.find((c) => c.key === 'remote')!
        expect(remote.transport.kind).toBe(McpTransportKind.Http)
    })
    test('no config → empty candidate list', () => {
        expect(new ClaudeConfigImporter({ read: () => undefined }, home).candidates()).toEqual([])
    })
})
