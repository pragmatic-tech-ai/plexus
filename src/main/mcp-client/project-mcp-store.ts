import { join } from 'node:path'
import { McpServerStore, type McpStoreIo } from './mcp-server-store.js'
import type { McpServerEntry } from '../../shared/mcp-client-api.js'

// A server store whose backing file lives inside the project tree so the config
// travels with the project (committable). Delegates to McpServerStore.
export class ProjectMcpStore
{
    public static fileFor(projectRoot: string): string { return join(projectRoot, '.plexus', 'mcp.json') }

    private readonly inner: McpServerStore

    constructor(io: McpStoreIo, projectRoot: string)
    {
        this.inner = new McpServerStore(io, ProjectMcpStore.fileFor(projectRoot))
    }

    public list(): McpServerEntry[] { return this.inner.list() }
    public upsert(entry: McpServerEntry): void { this.inner.upsert(entry) }
    public remove(key: string): void { this.inner.remove(key) }
    public replaceAll(entries: readonly McpServerEntry[]): void { this.inner.replaceAll(entries) }
}
