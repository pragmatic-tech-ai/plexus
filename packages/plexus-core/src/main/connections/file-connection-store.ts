/**
 * `FileConnectionStore` — the engine's `IConnectionStore`, persisting connection specs +
 * the default id as JSON in `userData/connections.json`. Pure `node:fs`; the `userData`
 * dir is injected so the unit test uses a temp dir. Secrets never live here — tokens are
 * in the `ISecretStore` (over `ConnectionTokenStore`), keyed by connection id.
 *
 * Reads the pre-engine flat format and maps it to a `ConnectionSpec` on load, so existing
 * users' connections.json keeps working; writes always use the spec format.
 *
 * Promoted from apps/devUI into plexus-core, on-disk layout unchanged (byte-compat).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type IConnectionStore, type ConnectionSpec, TokenSource } from '@pragmatic-tech-ai/todl/package-manager'

interface StoredFile
{
    version: number
    defaultId: string
    connections: ConnectionSpec[]
}

// The pre-engine flat connection record (read for back-compat only).
interface LegacyConnection
{
    id: string
    name: string
    registry: string
    scope: string
    org: string
    githubApi: string
    tokenSource: string
    tokenEnvVar: string
}

export class FileConnectionStore implements IConnectionStore
{
    private static readonly FileName = 'connections.json'
    private static readonly FileVersion = 2
    private static readonly NpmType = 'npm'
    private static readonly RegistryKey = 'registry'
    private static readonly ScopeKey = 'scope'
    private static readonly OrgKey = 'org'
    private static readonly GithubApiKey = 'githubApi'
    private static readonly EnvTokenSource = 'env'

    private readonly path: string

    constructor(private readonly userDataDir: string)
    {
        this.path = join(userDataDir, FileConnectionStore.FileName)
    }

    public async All(): Promise<readonly ConnectionSpec[]>
    {
        return this.Read().connections
    }

    public async Get(id: string): Promise<ConnectionSpec | undefined>
    {
        return this.Read().connections.find((c) => c.Id === id)
    }

    public async Save(spec: ConnectionSpec): Promise<void>
    {
        const file = this.Read()
        const index = file.connections.findIndex((c) => c.Id === spec.Id)
        if (index >= 0) file.connections[index] = spec
        else file.connections.push(spec)
        if (file.defaultId.length === 0) file.defaultId = spec.Id
        this.Write(file)
    }

    public async Delete(id: string): Promise<void>
    {
        const file = this.Read()
        file.connections = file.connections.filter((c) => c.Id !== id)
        if (file.defaultId === id) file.defaultId = file.connections[0]?.Id ?? ''
        this.Write(file)
    }

    public async DefaultId(): Promise<string | undefined>
    {
        const file = this.Read()
        if (file.defaultId.length > 0 && file.connections.some((c) => c.Id === file.defaultId)) return file.defaultId
        return file.connections[0]?.Id
    }

    public async SetDefault(id: string): Promise<void>
    {
        const file = this.Read()
        if (!file.connections.some((c) => c.Id === id)) return
        file.defaultId = id
        this.Write(file)
    }

    private Read(): StoredFile
    {
        if (!existsSync(this.path)) return { version: FileConnectionStore.FileVersion, defaultId: '', connections: [] }
        const stored = JSON.parse(readFileSync(this.path, 'utf8')) as { version?: number; defaultId?: string; connections?: unknown[] }
        return {
            version: FileConnectionStore.FileVersion,
            defaultId: stored.defaultId ?? '',
            connections: (stored.connections ?? []).map((c) => FileConnectionStore.ToSpec(c)),
        }
    }

    private Write(file: StoredFile): void
    {
        mkdirSync(this.userDataDir, { recursive: true })
        writeFileSync(this.path, JSON.stringify(file, null, 2))
    }

    // Accept either a spec (new format, has `Id`) or a legacy flat record (has `id`),
    // normalising both to a ConnectionSpec.
    private static ToSpec(raw: unknown): ConnectionSpec
    {
        const record = raw as Partial<ConnectionSpec> & Partial<LegacyConnection>
        if (typeof record.Id === 'string') return record as ConnectionSpec
        const legacy = raw as LegacyConnection
        return {
            Id: legacy.id,
            DisplayName: legacy.name,
            RegistryType: FileConnectionStore.NpmType,
            Settings: {
                [FileConnectionStore.RegistryKey]: legacy.registry,
                [FileConnectionStore.ScopeKey]: legacy.scope,
                [FileConnectionStore.OrgKey]: legacy.org,
                [FileConnectionStore.GithubApiKey]: legacy.githubApi,
            },
            TokenSource: legacy.tokenSource === FileConnectionStore.EnvTokenSource ? TokenSource.Env : TokenSource.Stored,
            TokenEnvVar: legacy.tokenEnvVar,
        }
    }
}
