import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ClaudeCliProvider } from '../claude-cli-provider.js'
import type { ChildLike, McpOptions } from '../ai-provider.js'

function fakeChild(): ChildLike {
    return {
        pid: 1,
        stdout: { on: () => {} }, stderr: { on: () => {} },
        stdin: { write: () => {}, end: () => {} },
        on: () => {}, kill: () => {},
    }
}
const options: McpOptions = {
    servers: {
        plexus: { type: 'http', url: 'http://127.0.0.1:5123/mcp', tagSession: true },
        fs: { command: 'srv', args: ['--x'], env: { K: 'v' } },
    },
    allowedTools: ['mcp__fs', 'Read'],
}

describe('ClaudeCliProvider MCP args', () => {
    test('writes a strict mcp-config with both transports; tags only the in-process server', () => {
        let captured: string[] = []
        const provider = new ClaudeCliProvider('claude', (_c, args) => { captured = args; return fakeChild() }, () => options)
        provider.start('sess-1', '/cwd', [], () => {})
        expect(captured).toContain('--strict-mcp-config')
        expect(captured).toContain('mcp__fs')
        const idx = captured.indexOf('--mcp-config')
        const cfg = JSON.parse(readFileSync(captured[idx + 1], 'utf8'))
        expect(cfg.mcpServers.plexus.url).toContain('?session=sess-1')  // tagged
        expect(cfg.mcpServers.fs.command).toBe('srv')                    // stdio verbatim
        expect(cfg.mcpServers.fs.url).toBeUndefined()
    })
    test('no resolver → no mcp args', () => {
        let captured: string[] = []
        const provider = new ClaudeCliProvider('claude', (_c, args) => { captured = args; return fakeChild() })
        provider.start('s', '/cwd', [], () => {})
        expect(captured).not.toContain('--mcp-config')
    })
})
