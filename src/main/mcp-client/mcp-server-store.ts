import type { McpServerEntry } from '../../shared/mcp-client-api.js'

// Synchronous file IO seam (unit-testable without fs), same shape as RuleIo.
export interface McpStoreIo { read(path: string): string | undefined; write(path: string, contents: string): void }

// Persistent flat list of MCP servers behind an injectable IO seam. Loads on
// construction; every mutation rewrites the whole file ({ servers: [...] }).
export class McpServerStore
{
    private servers: McpServerEntry[]

    constructor(private readonly io: McpStoreIo, private readonly path: string)
    {
        const raw = io.read(path)
        let parsed: { servers?: McpServerEntry[] } = {}
        if (raw !== undefined) { try { parsed = JSON.parse(raw) as { servers?: McpServerEntry[] } } catch { parsed = {} } }
        this.servers = parsed.servers ?? []
    }

    public list(): McpServerEntry[] { return [...this.servers] }

    public upsert(entry: McpServerEntry): void
    {
        this.servers = [...this.servers.filter((s) => s.key !== entry.key), entry]
        this.flush()
    }

    public remove(key: string): void
    {
        this.servers = this.servers.filter((s) => s.key !== key)
        this.flush()
    }

    public replaceAll(entries: readonly McpServerEntry[]): void { this.servers = [...entries]; this.flush() }

    private flush(): void { this.io.write(this.path, JSON.stringify({ servers: this.servers }, null, 2)) }
}
