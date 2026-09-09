import { join } from 'node:path'
import {
    McpGatingMode, McpTransportKind, ValueSourceKind,
    type McpServerEntry, type McpTransport, type ValueSource,
} from '../../shared/mcp-client-api.js'

interface RawStdio { command: string; args?: string[]; env?: Record<string, string> }
interface RawHttp  { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }
type RawServer = RawStdio | RawHttp

interface ClaudeConfig
{
    mcpServers?: Record<string, RawServer>;
    projects?: Record<string, { mcpServers?: Record<string, RawServer> }>;
}

// Reads the user's Claude MCP config (~/.claude.json top-level + per-project
// mcpServers, and a project .mcp.json) and maps each server to an importable
// McpServerEntry. Read-only — Plexus never writes these files.
export class ClaudeConfigImporter
{
    private static readonly ENV_ONLY = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/

    constructor(private readonly io: { read(path: string): string | undefined }, private readonly home: string) {}

    public candidates(projectRoot?: string): McpServerEntry[]
    {
        const found = new Map<string, McpServerEntry>()
        for (const raw of this.rawMaps(projectRoot))
            for (const [key, def] of Object.entries(raw))
            {
                const entry = this.toEntry(key, def)
                if (entry !== undefined && !found.has(key)) found.set(key, entry)
            }
        return [...found.values()]
    }

    private rawMaps(projectRoot?: string): Record<string, RawServer>[]
    {
        const maps: Record<string, RawServer>[] = []
        const claude = this.parse(this.io.read(join(this.home, '.claude.json')))
        if (claude?.mcpServers !== undefined) maps.push(claude.mcpServers)
        if (projectRoot !== undefined)
        {
            const perProject = claude?.projects?.[projectRoot]?.mcpServers
            if (perProject !== undefined) maps.push(perProject)
            const dotMcp = this.parse(this.io.read(join(projectRoot, '.mcp.json')))
            if (dotMcp?.mcpServers !== undefined) maps.push(dotMcp.mcpServers)
        }
        return maps
    }

    private parse(raw: string | undefined): ClaudeConfig | undefined
    {
        if (raw === undefined) return undefined
        try { return JSON.parse(raw) as ClaudeConfig } catch { return undefined }
    }

    private toEntry(key: string, def: RawServer): McpServerEntry | undefined
    {
        const transport = this.toTransport(def)
        if (transport === undefined) return undefined
        return { key, label: key, enabled: true, transport, gating: { mode: McpGatingMode.Prompt, tools: [] } }
    }

    private toTransport(def: RawServer): McpTransport | undefined
    {
        if ('command' in def && typeof def.command === 'string')
            return { kind: McpTransportKind.Stdio, command: def.command, args: def.args ?? [], env: this.sources(def.env) }
        if ('url' in def && typeof def.url === 'string')
            return { kind: def.type === 'sse' ? McpTransportKind.Sse : McpTransportKind.Http, url: def.url, headers: this.sources(def.headers) }
        return undefined
    }

    private sources(raw: Record<string, string> | undefined): Record<string, ValueSource>
    {
        const out: Record<string, ValueSource> = {}
        for (const [k, v] of Object.entries(raw ?? {}))
        {
            const m = ClaudeConfigImporter.ENV_ONLY.exec(v)
            out[k] = m !== null ? { kind: ValueSourceKind.Env, value: m[1] } : { kind: ValueSourceKind.Literal, value: v }
        }
        return out
    }
}
