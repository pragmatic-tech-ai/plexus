import { test, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionStore } from "../connection-store.js";
import { ConnectionTokenStore } from "../connection-token-store.js";
import { SettingsStore, TokenSource } from "../settings-store.js";
import { TokenStore, type Encryptor } from "../token-store.js";
import { PackageRegistryManager, type PackageRegistryManagerDeps } from "../package-registry-manager.js";

class FakeEncryptor implements Encryptor
{
  available(): boolean { return true; }
  encrypt(plain: string): Buffer { return Buffer.from(plain.split("").reverse().join(""), "utf8"); }
  decrypt(cipher: Buffer): string { return cipher.toString("utf8").split("").reverse().join(""); }
}

let dir: string;
let deps: PackageRegistryManagerDeps;
let manager: PackageRegistryManager;

function build(env: Record<string, string | undefined> = {}): void
{
  deps = {
    connectionStore: new ConnectionStore(dir),
    tokenStore: new ConnectionTokenStore(dir, new FakeEncryptor()),
    env,
    legacySettings: new SettingsStore(dir),
    legacyToken: new TokenStore(dir, new FakeEncryptor()),
  };
  manager = new PackageRegistryManager(deps);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "prm-"));
  build();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("migrateIfNeeded seeds one GitHub Packages connection from legacy defaults", () => {
  manager.migrateIfNeeded();
  const views = manager.listViews();
  assert.equal(views.length, 1);
  assert.equal(views[0]!.name, "GitHub Packages");
  assert.equal(views[0]!.registry, "https://npm.pkg.github.com");
  assert.equal(views[0]!.scope, "@pragmatic-tech-ai");
  assert.equal(views[0]!.isDefault, true);
});

test("migrateIfNeeded is idempotent — a second call adds nothing", () => {
  manager.migrateIfNeeded();
  manager.migrateIfNeeded();
  assert.equal(manager.listViews().length, 1);
});

test("migrate carries a legacy stored token into the seeded connection", () => {
  deps.legacyToken.setToken("ghp_legacy");
  manager.migrateIfNeeded();
  const view = manager.listViews()[0]!;
  assert.equal(view.hasToken, true);
  assert.equal(manager.effectiveConfig(view.id).token, "ghp_legacy");
});

test("add / update / remove flow through listViews", () => {
  const added = manager.add({
    name: "Internal", registry: "https://npm.internal", scope: "@int", org: "int",
    githubApi: "https://api.internal", tokenSource: TokenSource.Stored, tokenEnvVar: "",
  });
  assert.equal(manager.listViews().length, 1);
  manager.update(added.id, { org: "internal-corp" });
  assert.equal(manager.listViews()[0]!.org, "internal-corp");
  manager.remove(added.id);
  assert.equal(manager.listViews().length, 0);
});

test("setToken stores an encrypted token and switches the source to Stored", () => {
  manager.migrateIfNeeded();
  const id = manager.listViews()[0]!.id;
  manager.setToken(id, "ghp_new");
  const view = manager.listViews()[0]!;
  assert.equal(view.tokenSource, TokenSource.Stored);
  assert.equal(view.hasToken, true);
  assert.equal(manager.effectiveConfig(id).token, "ghp_new");
});

test("useEnvToken resolves the token from the environment", () => {
  build({ MY_TOKEN: "ghp_env" });
  manager.migrateIfNeeded();
  const id = manager.listViews()[0]!.id;
  manager.useEnvToken(id, "MY_TOKEN");
  const view = manager.listViews()[0]!;
  assert.equal(view.tokenSource, TokenSource.Env);
  assert.equal(view.tokenEnvVar, "MY_TOKEN");
  assert.equal(view.hasToken, true);
  assert.equal(manager.effectiveConfig(id).token, "ghp_env");
});

test("effectiveConfig with no id falls back to the default connection", () => {
  manager.migrateIfNeeded();
  const id = manager.listViews()[0]!.id;
  manager.setToken(id, "ghp_default");
  assert.equal(manager.effectiveConfig().token, "ghp_default");
  assert.equal(manager.effectiveConfig().registry, "https://npm.pkg.github.com");
});

test("removing a connection clears its stored token", () => {
  const added = manager.add({
    name: "Temp", registry: "r", scope: "@t", org: "t",
    githubApi: "https://api.github.com", tokenSource: TokenSource.Stored, tokenEnvVar: "",
  });
  manager.setToken(added.id, "secret");
  manager.remove(added.id);
  // token file is gone; a re-created connection with the same id has no token
  assert.equal(deps.tokenStore.hasToken(added.id), false);
});
