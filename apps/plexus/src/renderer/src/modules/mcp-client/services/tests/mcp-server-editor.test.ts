import { describe, test, expect } from 'vitest'
import { McpServerEditor } from '../mcp-server-editor.js'
import { McpGatingMode, McpTransportKind, ValueSourceKind, type McpServerEntry } from '../../../../../../shared/mcp-client-api.js'

describe('McpServerEditor', () => {
    test('invalid until key + required transport fields present', () => {
        const e = new McpServerEditor()
        expect(e.IsValid).toBe(false)
        e.Key = 'srv'; e.SelectedTransportKind = McpTransportKind.Stdio
        expect(e.IsValid).toBe(false)      // command still empty
        e.Command = 'npx'
        expect(e.IsValid).toBe(true)
    })
    test('IsStdio / IsHttp track the selected transport kind', () => {
        const e = new McpServerEditor()
        e.SelectedTransportKind = McpTransportKind.Http
        expect(e.IsHttp).toBe(true); expect(e.IsStdio).toBe(false)
    })
    test('http editor is valid with a parseable url', () => {
        const e = new McpServerEditor()
        e.Key = 'remote'; e.SelectedTransportKind = McpTransportKind.Http
        expect(e.IsValid).toBe(false)
        e.Url = 'https://mcp.example/api'
        expect(e.IsValid).toBe(true)
    })
    test('from(entry) → toEntry() round-trips a stdio server with env + PerTool gating', () => {
        const entry: McpServerEntry = {
            key: 'fs', label: 'Filesystem', enabled: true,
            transport: { kind: McpTransportKind.Stdio, command: 'npx', args: ['-y', 'server'], env: { K: { kind: ValueSourceKind.Env, value: 'MY' } } },
            gating: { mode: McpGatingMode.PerTool, tools: ['read_file'] },
        }
        const back = McpServerEditor.from(entry).toEntry()
        expect(back).toEqual(entry)
    })
    test('from(entry) → toEntry() round-trips an http server with a header', () => {
        const entry: McpServerEntry = {
            key: 'remote', label: 'Remote', enabled: false,
            transport: { kind: McpTransportKind.Http, url: 'https://x/y', headers: { Authorization: { kind: ValueSourceKind.Literal, value: 'Bearer z' } } },
            gating: { mode: McpGatingMode.AllowAll, tools: [] },
        }
        const back = McpServerEditor.from(entry).toEntry()
        expect(back).toEqual(entry)
    })
})
