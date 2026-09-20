/**
 * `LegacyRegistryMigration` — on first run (no connections yet), seed one
 * "GitHub Packages" connection from the legacy single-registry settings + token, so
 * existing users keep working and every install always has at least one connection.
 * With no legacy file present, SettingsStore returns the GitHub-Packages defaults, so
 * a fresh install still gets a sensible default connection. Idempotent.
 */
import { type IConnectionStore, type ISecretStore, TokenSource } from "@pragmatic-tech-ai/todl/package-manager";
import type { SettingsStore } from "../settings-store.js";
import type { TokenStore } from "../token-store.js";

const SEED_ID = "github-packages";
const SEED_NAME = "GitHub Packages";
const NPM_TYPE = "npm";

export interface LegacyRegistryMigrationDeps
{
  connectionStore: IConnectionStore;
  secretStore: ISecretStore;
  legacySettings: SettingsStore;
  legacyToken: TokenStore;
}

export class LegacyRegistryMigration
{
  constructor(private readonly deps: LegacyRegistryMigrationDeps) {}

  public async MigrateIfNeeded(): Promise<void>
  {
    if ((await this.deps.connectionStore.All()).length > 0) return;
    const settings = this.deps.legacySettings.get();
    await this.deps.connectionStore.Save({
      Id: SEED_ID,
      DisplayName: SEED_NAME,
      RegistryType: NPM_TYPE,
      Settings: {
        registry: settings.registry,
        scope: settings.scope,
        org: settings.org,
        githubApi: settings.githubApi,
      },
      TokenSource: settings.tokenSource === TokenSource.Env ? TokenSource.Env : TokenSource.Stored,
      TokenEnvVar: settings.tokenEnvVar,
    });
    const token = this.deps.legacyToken.getToken();
    if (token.length > 0) await this.deps.secretStore.Set(SEED_ID, token);
  }
}
