import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { McpTransportKind, type McpProbeResult, type McpServerEntry } from '../../shared/mcp-client-api.js'
import type { ValueSourceResolver } from './value-source.js'

const PROBE_TIMEOUT_MS = 15_000

// Opens a short-lived MCP client connection to an external server to (a) validate
// it (probe) and (b) enumerate its tools (per-tool gating). Never long-lived —
// the agent's real connection is the CLI's; this is only for the config UI.
export class McpClient
{
    constructor(private readonly values: ValueSourceResolver) {}

    public async probe(entry: McpServerEntry): Promise<McpProbeResult>
    {
        try
        {
            const tools = await this.withConnection(entry, async (c) => (await c.listTools()).tools.map((t) => t.name))
            return { ok: true, toolCount: tools.length, tools }
        }
        catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
    }

    public async listTools(entry: McpServerEntry): Promise<string[]>
    {
        return this.withConnection(entry, async (c) => (await c.listTools()).tools.map((t) => t.name))
    }

    private async withConnection<T>(entry: McpServerEntry, use: (c: Client) => Promise<T>): Promise<T>
    {
        const transport = this.transportFor(entry)
        const client = new Client({ name: 'plexus-probe', version: '0.0.0' })
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error('MCP connection timed out')), PROBE_TIMEOUT_MS) })
        try
        {
            await Promise.race([client.connect(transport), timeout])
            return await Promise.race([use(client), timeout])
        }
        finally
        {
            if (timer !== undefined) clearTimeout(timer)
            await client.close().catch(() => { /* best-effort teardown */ })
        }
    }

    private transportFor(entry: McpServerEntry): Transport
    {
        const t = entry.transport
        if (t.kind === McpTransportKind.Stdio)
        {
            // Merge configured vars OVER the SDK's safe default environment so the
            // spawned process still inherits PATH / SystemRoot etc.
            const env: Record<string, string> = { ...getDefaultEnvironment() }
            for (const [k, v] of Object.entries(t.env)) { const r = this.values.resolve(v); if (r !== undefined) env[k] = r }
            return new StdioClientTransport({ command: t.command, args: [...t.args], env })
        }
        const headers: Record<string, string> = {}
        for (const [k, v] of Object.entries(t.headers)) { const r = this.values.resolve(v); if (r !== undefined) headers[k] = r }
        const url = new URL(t.url)
        const opts = { requestInit: { headers } }
        return t.kind === McpTransportKind.Sse ? new SSEClientTransport(url, opts) : new StreamableHTTPClientTransport(url, opts)
    }
}
