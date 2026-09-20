/**
 * `PackageRegistryManager` — the source of truth for registry connections. It
 * owns the `ConnectionStore` (list + default) and the keyed `ConnectionTokenStore`
 * (per-connection encrypted tokens), and resolves the effective `NpmRegistryConfig`
 * (connection + token) the bridge hands to a `PackageManager`. Replaces the old
 * single `SettingsStore`/`TokenStore` config, migrating them into one connection
 * on first run so nothing breaks.
 *
 * Secrets never leave this layer: the renderer sees `ConnectionView`s (with a
 * `hasToken` flag) via the bridge, never a token value.
 */
import type { NpmRegistryConfig } from "@pragmatic-tech-ai/todl/package-manager";
import type { ConnectionStore } from "./connection-store.js";
import type { ConnectionTokenStore } from "./connection-token-store.js";
import type { SettingsStore } from "./settings-store.js";
import type { TokenStore } from "./token-store.js";
import { TokenSource } from "./settings-store.js";
import type {
  RegistryConnection,
  ConnectionView,
  ConnectionInput,
} from "./registry-connection.js";

export interface PackageRegistryManagerDeps
{
  connectionStore: ConnectionStore;
  tokenStore: ConnectionTokenStore;
  /** The process environment, for env-var-sourced tokens (prod: `process.env`). */
  env: Record<string, string | undefined>;
  /** Legacy single-registry settings — read once, to seed the first connection. */
  legacySettings: SettingsStore;
  /** Legacy single encrypted token — migrated into the seeded connection. */
  legacyToken: TokenStore;
}

const SEED_NAME = "GitHub Packages";

export class PackageRegistryManager
{
  constructor(private readonly deps: PackageRegistryManagerDeps) {}

  /** On first run (no connections yet), seed one connection from the legacy
   *  single-registry settings + token so existing users keep working and every
   *  install always has at least one connection. Idempotent. */
  migrateIfNeeded(): void
  {
    if (!this.deps.connectionStore.isEmpty()) return;
    const s = this.deps.legacySettings.get();
    const seeded = this.deps.connectionStore.add({
      name: SEED_NAME,
      registry: s.registry,
      scope: s.scope,
      org: s.org,
      githubApi: s.githubApi,
      tokenSource: s.tokenSource,
      tokenEnvVar: s.tokenEnvVar,
    });
    const legacyToken = this.deps.legacyToken.getToken();
    if (legacyToken.length > 0) this.deps.tokenStore.setToken(seeded.id, legacyToken);
  }

  listViews(): ConnectionView[]
  {
    const defaultId = this.deps.connectionStore.defaultId();
    return this.deps.connectionStore.list().map((c) => this.viewOf(c, defaultId));
  }

  add(input: ConnectionInput): ConnectionView
  {
    const connection = this.deps.connectionStore.add(input);
    return this.viewOf(connection, this.deps.connectionStore.defaultId());
  }

  update(id: string, partial: Partial<ConnectionInput>): ConnectionView | undefined
  {
    const connection = this.deps.connectionStore.update(id, partial);
    return connection === undefined ? undefined : this.viewOf(connection, this.deps.connectionStore.defaultId());
  }

  remove(id: string): void
  {
    this.deps.connectionStore.remove(id);
    this.deps.tokenStore.clear(id);
  }

  /** Store an encrypted token for a connection and switch it to the Stored
   *  source (entering a token implies stored auth). */
  setToken(id: string, token: string): void
  {
    this.deps.tokenStore.setToken(id, token);
    this.deps.connectionStore.update(id, { tokenSource: TokenSource.Stored });
  }

  /** Point a connection at an environment variable for its token. */
  useEnvToken(id: string, varName: string): void
  {
    this.deps.connectionStore.update(id, { tokenSource: TokenSource.Env, tokenEnvVar: varName });
  }

  setDefault(id: string): void
  {
    this.deps.connectionStore.setDefault(id);
  }

  listEnvVars(): string[]
  {
    return Object.keys(this.deps.env)
      .filter((k) => this.deps.env[k] !== undefined)
      .sort((a, b) => a.localeCompare(b));
  }

  /** The effective registry config for a connection (its non-secret fields plus
   *  the resolved token). Falls back to the default connection when `id` is
   *  omitted (legacy, non-connection-scoped ops). */
  effectiveConfig(id?: string): NpmRegistryConfig
  {
    const connection = this.resolve(id);
    if (connection === undefined)
    {
      const s = this.deps.legacySettings.get();
      return { registry: s.registry, scope: s.scope, org: s.org, githubApi: s.githubApi, token: "" };
    }
    return {
      registry: connection.registry,
      scope: connection.scope,
      org: connection.org,
      githubApi: connection.githubApi,
      token: this.tokenFor(connection),
    };
  }

  private resolve(id?: string): RegistryConnection | undefined
  {
    const target = id ?? this.deps.connectionStore.defaultId();
    return target === undefined ? undefined : this.deps.connectionStore.get(target);
  }

  private tokenFor(connection: RegistryConnection): string
  {
    if (connection.tokenSource === TokenSource.Env)
    {
      return this.deps.env[connection.tokenEnvVar] ?? "";
    }
    return this.deps.tokenStore.getToken(connection.id);
  }

  private viewOf(c: RegistryConnection, defaultId: string | undefined): ConnectionView
  {
    return {
      id: c.id,
      name: c.name,
      registry: c.registry,
      scope: c.scope,
      org: c.org,
      githubApi: c.githubApi,
      tokenSource: c.tokenSource,
      tokenEnvVar: c.tokenEnvVar,
      hasToken: this.tokenFor(c).length > 0,
      isDefault: c.id === defaultId,
    };
  }
}
