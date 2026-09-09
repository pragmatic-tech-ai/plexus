import { McpGatingMode, McpTransportKind, type McpServerEntry } from '../../shared/mcp-client-api.js'
import type { McpOptions, McpServerConfig } from '../agent/ai-provider.js'
import type { ValueSourceResolver } from './value-source.js'

// The resolver only reads a server list, so it depends on this minimal surface —
// both McpServerStore (global) and ProjectMcpStore satisfy it structurally.
export interface McpServerSource { list(): McpServerEntry[] }

// The always-present portion of the MCP config: the in-process Plexus HTTP server
// and the fixed allow/disallow/prompt options (built in agent.ts). The resolver
// layers the user's registry servers on top of this.
export interface BaseMcp
{
    servers: Record<string, McpServerConfig>;
    allowedTools: readonly string[];
    disallowedTools?: readonly string[];
    appendSystemPrompt?: string;
    permissionPromptTool?: string;
}

// Produces the McpOptions for one conversation given its bound cwd: merge global +
// project registry (project wins by key), drop disabled and missing-secret servers,
// and derive allowedTools from each server's gating mode.
export class McpConfigResolver
{
    constructor(
        private readonly global: McpServerSource,
        private readonly projectStoreFor: (cwd: string) => McpServerSource | undefined,
        private readonly base: BaseMcp,
        private readonly values: ValueSourceResolver,
    ) {}

    public resolve(cwd: string): McpOptions
    {
        const servers: Record<string, McpServerConfig> = { ...this.base.servers }
        const allowedTools: string[] = [...this.base.allowedTools]
        for (const entry of this.merge(cwd))
        {
            if (!entry.enabled) continue
            const cfg = this.toConfig(entry)
            if (cfg === undefined) continue   // missing secret → skip; Test button is the diagnostic
            servers[entry.key] = cfg
            allowedTools.push(...this.gatingTools(entry))
        }
        return {
            servers, allowedTools,
            disallowedTools: this.base.disallowedTools,
            appendSystemPrompt: this.base.appendSystemPrompt,
            permissionPromptTool: this.base.permissionPromptTool,
        }
    }

    private merge(cwd: string): McpServerEntry[]
    {
        const byKey = new Map<string, McpServerEntry>()
        for (const e of this.global.list()) byKey.set(e.key, e)
        const proj = this.projectStoreFor(cwd)
        if (proj !== undefined) for (const e of proj.list()) byKey.set(e.key, e)
        return [...byKey.values()]
    }

    private gatingTools(entry: McpServerEntry): string[]
    {
        switch (entry.gating.mode)
        {
            case McpGatingMode.AllowAll: return [`mcp__${entry.key}`]
            case McpGatingMode.PerTool:  return entry.gating.tools.map((t) => `mcp__${entry.key}__${t}`)
            default:                     return []   // Prompt → falls through to approve_tool
        }
    }

    private toConfig(entry: McpServerEntry): McpServerConfig | undefined
    {
        const t = entry.transport
        if (t.kind === McpTransportKind.Stdio)
        {
            const env: Record<string, string> = {}
            for (const [k, v] of Object.entries(t.env)) { const r = this.values.resolve(v); if (r === undefined) return undefined; env[k] = r }
            return { command: t.command, args: [...t.args], env }
        }
        const headers: Record<string, string> = {}
        for (const [k, v] of Object.entries(t.headers)) { const r = this.values.resolve(v); if (r === undefined) return undefined; headers[k] = r }
        return { type: t.kind === McpTransportKind.Sse ? 'sse' : 'http', url: t.url, headers }
    }
}
