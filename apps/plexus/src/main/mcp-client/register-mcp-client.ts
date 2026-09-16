import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, parse as parsePath } from 'node:path'
import { homedir } from 'node:os'
import { McpClientChannel, type McpProbeResult, type McpServerEntry } from '../../shared/mcp-client-api.js'
import type { McpStoreIo } from './mcp-server-store.js'
import { McpServerStore } from './mcp-server-store.js'
import { ProjectMcpStore } from './project-mcp-store.js'
import { ValueSourceResolver } from './value-source.js'
import { McpConfigResolver, type BaseMcp } from './mcp-config-resolver.js'
import { McpClient } from './mcp-client.js'
import { ClaudeConfigImporter } from './claude-config-importer.js'

// Walks cwd -> ancestors looking for a project.plexus marker (the project root
// that owns a .plexus/mcp.json). The exists() probe is injected for tests.
export class ProjectRootFinder
{
    constructor(private readonly exists: (path: string) => boolean = existsSync) {}

    public find(cwd: string): string | undefined
    {
        let dir = cwd
        for (;;)
        {
            if (this.exists(join(dir, 'project.plexus'))) return dir
            const parent = parsePath(dir).dir
            if (parent === dir || parent === '') return undefined
            dir = parent
        }
    }
}

// Owns the MCP-client runtime: the global store, the per-cwd resolver, the probe
// client, and the importer. Created once (in the agent wiring) and shared by the
// agent provider + the IPC layer.
export class McpClientRuntime
{
    public readonly resolver: McpConfigResolver
    private readonly global: McpServerStore
    private readonly values = new ValueSourceResolver()
    private readonly client = new McpClient(this.values)
    private readonly finder = new ProjectRootFinder()
    private readonly io: McpStoreIo = {
        read: (p) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined),
        write: (p, c) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c, 'utf8') },
    }

    constructor(base: BaseMcp)
    {
        this.global = new McpServerStore(this.io, join(app.getPath('userData'), 'mcp-servers.json'))
        this.resolver = new McpConfigResolver(this.global, (cwd) => this.projectStore(cwd), base, this.values)
    }

    private projectStore(cwd: string): ProjectMcpStore | undefined
    {
        const root = this.finder.find(cwd)
        return root === undefined ? undefined : new ProjectMcpStore(this.io, root)
    }

    public register(): void
    {
        ipcMain.handle(McpClientChannel.ListGlobal, (): McpServerEntry[] => this.global.list())
        ipcMain.handle(McpClientChannel.SaveGlobal, (_e, entries: McpServerEntry[]): void => this.global.replaceAll(entries))
        ipcMain.handle(McpClientChannel.ListProject, (_e, root: string): McpServerEntry[] => new ProjectMcpStore(this.io, root).list())
        ipcMain.handle(McpClientChannel.SaveProject, (_e, root: string, entries: McpServerEntry[]): void => new ProjectMcpStore(this.io, root).replaceAll(entries))
        ipcMain.handle(McpClientChannel.Probe, (_e, entry: McpServerEntry): Promise<McpProbeResult> => this.client.probe(entry))
        ipcMain.handle(McpClientChannel.ListTools, (_e, entry: McpServerEntry): Promise<string[]> => this.client.listTools(entry))
        ipcMain.handle(McpClientChannel.ImportCandidates, (_e, root?: string): McpServerEntry[] =>
            new ClaudeConfigImporter({ read: (p) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined) }, homedir()).candidates(root))
    }
}
