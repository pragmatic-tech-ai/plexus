/**
 * `ConnectionStore` — the persisted list of registry connections + which one is
 * the default, stored as JSON in `userData/connections.json`. Pure `node:fs`; the
 * `userData` dir is injected so the unit test uses a temp dir. Secrets never live
 * here — tokens are in `ConnectionTokenStore`, keyed by connection id.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RegistryConnection, ConnectionInput } from "./registry-connection.js";

interface ConnectionsFile
{
  version: number;
  defaultId: string;
  connections: RegistryConnection[];
}

const CONNECTIONS_FILE = "connections.json";
const FILE_VERSION = 1;

export class ConnectionStore
{
  private readonly path: string;

  constructor(private readonly userDataDir: string)
  {
    this.path = join(userDataDir, CONNECTIONS_FILE);
  }

  /** True when no connections file has been written yet (drives migration). */
  isEmpty(): boolean
  {
    return this.read().connections.length === 0;
  }

  list(): RegistryConnection[]
  {
    return this.read().connections;
  }

  get(id: string): RegistryConnection | undefined
  {
    return this.read().connections.find((c) => c.id === id);
  }

  has(id: string): boolean
  {
    return this.get(id) !== undefined;
  }

  defaultId(): string | undefined
  {
    const file = this.read();
    const id = file.defaultId;
    return id.length > 0 && file.connections.some((c) => c.id === id) ? id : file.connections[0]?.id;
  }

  /** Add a connection, minting a unique id from its name. The first connection
   *  added becomes the default. Returns the stored record (with its id). */
  add(input: ConnectionInput): RegistryConnection
  {
    const file = this.read();
    const id = ConnectionStore.uniqueId(input.name, file.connections);
    const connection: RegistryConnection = { id, ...input };
    file.connections.push(connection);
    if (file.defaultId.length === 0) file.defaultId = id;
    this.write(file);
    return connection;
  }

  /** Merge a partial edit into an existing connection (id is immutable). */
  update(id: string, partial: Partial<ConnectionInput>): RegistryConnection | undefined
  {
    const file = this.read();
    const connection = file.connections.find((c) => c.id === id);
    if (connection === undefined) return undefined;
    Object.assign(connection, partial);
    this.write(file);
    return connection;
  }

  /** Remove a connection; if it was the default, promote the first remaining. */
  remove(id: string): void
  {
    const file = this.read();
    file.connections = file.connections.filter((c) => c.id !== id);
    if (file.defaultId === id) file.defaultId = file.connections[0]?.id ?? "";
    this.write(file);
  }

  setDefault(id: string): void
  {
    const file = this.read();
    if (!file.connections.some((c) => c.id === id)) return;
    file.defaultId = id;
    this.write(file);
  }

  private read(): ConnectionsFile
  {
    if (!existsSync(this.path)) return { version: FILE_VERSION, defaultId: "", connections: [] };
    const stored = JSON.parse(readFileSync(this.path, "utf8")) as Partial<ConnectionsFile>;
    return {
      version: stored.version ?? FILE_VERSION,
      defaultId: stored.defaultId ?? "",
      connections: stored.connections ?? [],
    };
  }

  private write(file: ConnectionsFile): void
  {
    mkdirSync(this.userDataDir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(file, null, 2));
  }

  /** A URL-safe slug of `name`, de-duplicated against existing ids with a
   *  numeric suffix (`github-packages`, `github-packages-2`, …). */
  private static uniqueId(name: string, existing: readonly RegistryConnection[]): string
  {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "connection";
    const taken = new Set(existing.map((c) => c.id));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }
}
