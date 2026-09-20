/**
 * `FileConnectionStore` — the devUI host implementation of the engine's
 * `IConnectionStore`, persisting connection specs + the default id as JSON in
 * `userData/connections.json`. Pure `node:fs`; the `userData` dir is injected so the
 * unit test uses a temp dir. Secrets never live here — tokens are in the
 * `ISecretStore` (over ConnectionTokenStore), keyed by connection id.
 *
 * Reads the pre-engine flat format (`{id,name,registry,scope,org,githubApi,
 * tokenSource,tokenEnvVar}`) and maps it to a `ConnectionSpec` on load, so existing
 * users' connections.json keeps working across the migration; writes always use the
 * spec format.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type IConnectionStore, type ConnectionSpec, TokenSource } from "@pragmatic-tech-ai/todl/package-manager";

// The npm Settings keys (mirrors NpmConnectionFactory) — the flat registry fields
// live under these in a spec's Settings dict.
const REGISTRY_KEY = "registry";
const SCOPE_KEY = "scope";
const ORG_KEY = "org";
const GITHUB_API_KEY = "githubApi";
const NPM_TYPE = "npm";

interface StoredFile
{
  version: number;
  defaultId: string;
  connections: ConnectionSpec[];
}

// The pre-engine flat connection record (read for back-compat only).
interface LegacyConnection
{
  id: string;
  name: string;
  registry: string;
  scope: string;
  org: string;
  githubApi: string;
  tokenSource: string;
  tokenEnvVar: string;
}

const CONNECTIONS_FILE = "connections.json";
const FILE_VERSION = 2;

export class FileConnectionStore implements IConnectionStore
{
  private readonly path: string;

  constructor(private readonly userDataDir: string)
  {
    this.path = join(userDataDir, CONNECTIONS_FILE);
  }

  public async All(): Promise<readonly ConnectionSpec[]>
  {
    return this.read().connections;
  }

  public async Get(id: string): Promise<ConnectionSpec | undefined>
  {
    return this.read().connections.find((c) => c.Id === id);
  }

  public async Save(spec: ConnectionSpec): Promise<void>
  {
    const file = this.read();
    const index = file.connections.findIndex((c) => c.Id === spec.Id);
    if (index >= 0) file.connections[index] = spec;
    else file.connections.push(spec);
    if (file.defaultId.length === 0) file.defaultId = spec.Id;
    this.write(file);
  }

  public async Delete(id: string): Promise<void>
  {
    const file = this.read();
    file.connections = file.connections.filter((c) => c.Id !== id);
    if (file.defaultId === id) file.defaultId = file.connections[0]?.Id ?? "";
    this.write(file);
  }

  public async DefaultId(): Promise<string | undefined>
  {
    const file = this.read();
    if (file.defaultId.length > 0 && file.connections.some((c) => c.Id === file.defaultId)) return file.defaultId;
    return file.connections[0]?.Id;
  }

  public async SetDefault(id: string): Promise<void>
  {
    const file = this.read();
    if (!file.connections.some((c) => c.Id === id)) return;
    file.defaultId = id;
    this.write(file);
  }

  private read(): StoredFile
  {
    if (!existsSync(this.path)) return { version: FILE_VERSION, defaultId: "", connections: [] };
    const stored = JSON.parse(readFileSync(this.path, "utf8")) as {
      version?: number;
      defaultId?: string;
      connections?: unknown[];
    };
    return {
      version: FILE_VERSION,
      defaultId: stored.defaultId ?? "",
      connections: (stored.connections ?? []).map((c) => FileConnectionStore.toSpec(c)),
    };
  }

  private write(file: StoredFile): void
  {
    mkdirSync(this.userDataDir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(file, null, 2));
  }

  // Accept either a spec (new format, has `Id`) or a legacy flat record (has `id`),
  // normalising both to a ConnectionSpec.
  private static toSpec(raw: unknown): ConnectionSpec
  {
    const record = raw as Partial<ConnectionSpec> & Partial<LegacyConnection>;
    if (typeof record.Id === "string") return record as ConnectionSpec;
    const legacy = raw as LegacyConnection;
    return {
      Id: legacy.id,
      DisplayName: legacy.name,
      RegistryType: NPM_TYPE,
      Settings: {
        [REGISTRY_KEY]: legacy.registry,
        [SCOPE_KEY]: legacy.scope,
        [ORG_KEY]: legacy.org,
        [GITHUB_API_KEY]: legacy.githubApi,
      },
      TokenSource: legacy.tokenSource === "env" ? TokenSource.Env : TokenSource.Stored,
      TokenEnvVar: legacy.tokenEnvVar,
    };
  }
}
