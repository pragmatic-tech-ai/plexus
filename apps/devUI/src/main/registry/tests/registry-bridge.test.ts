import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegistryBridge } from "../registry-bridge.js";
import { type Encryptor } from "../token-store.js";
import { TokenStore } from "../token-store.js";
import { SettingsStore } from "../settings-store.js";
import { ConnectionTokenStore } from "../connection-token-store.js";
import { FileConnectionStore } from "../engine/file-connection-store.js";
import { EncryptedSecretStore } from "../engine/encrypted-secret-store.js";
import { ProcessEnvironmentVariables } from "../engine/process-environment-variables.js";
import { PackageEngine } from "../engine/package-engine.js";
import { LegacyRegistryMigration } from "../engine/legacy-registry-migration.js";
import {
  LocalPackageStore,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from "@pragmatic-tech-ai/todl/package-manager";

const REGISTRY = "https://npm.pkg.github.com";
const GITHUB = "https://api.github.com";
const enc = new TextEncoder();

class PlainEncryptor implements Encryptor
{
  available() { return true; }
  encrypt(p: string) { return Buffer.from(p, "utf8"); }
  decrypt(c: Buffer) { return c.toString("utf8"); }
}

// An in-memory npm registry + GitHub org API for the seeded default connection:
// the org package list (drives list()/testConnection) and packuments (drive
// versions()/bumpVersion). Nothing hits the network.
class InMemoryNpm implements HttpTransport
{
  constructor(
    private readonly orgStatus = 200,
    private readonly orgNames: string[] = [],
    private readonly packuments: Record<string, unknown> = {},
  ) {}

  request(req: HttpRequest): Promise<HttpResponse>
  {
    if (req.url.startsWith(`${GITHUB}/orgs/`))
    {
      return this.orgStatus === 200
        ? this.json(this.orgNames.map((name) => ({ name })))
        : this.json({ message: "Bad credentials" }, this.orgStatus);
    }
    for (const [name, doc] of Object.entries(this.packuments))
    {
      if (req.url === `${REGISTRY}/${name.replace("/", "%2F")}`) return this.json(doc);
    }
    return this.json({ error: "not found" }, 404);
  }

  private json(value: unknown, status = 200): Promise<HttpResponse>
  {
    return Promise.resolve({ status, headers: {}, body: enc.encode(JSON.stringify(value)) });
  }
}

const freshDir = () => mkdtempSync(join(tmpdir(), "todl-bridge-"));

function makeBridge(options: {
  transport?: HttpTransport;
  env?: Record<string, string | undefined>;
  compile?: (directory: string, options?: { scope?: string; outDir?: string }) => Promise<unknown>;
  store?: LocalPackageStore;
} = {}): RegistryBridge
{
  const dir = freshDir();
  const encryptor = new PlainEncryptor();
  const connectionStore = new FileConnectionStore(dir);
  const secretStore = new EncryptedSecretStore(new ConnectionTokenStore(dir, encryptor));
  const environment = new ProcessEnvironmentVariables(options.env ?? {});
  const localStore = options.store ?? new LocalPackageStore();
  // Migrate seeds one "GitHub Packages" connection (default) from SettingsStore's
  // GitHub-Packages defaults, so every bridge starts with a default connection.
  const migration = new LegacyRegistryMigration({
    connectionStore,
    secretStore,
    legacySettings: new SettingsStore(dir),
    legacyToken: new TokenStore(dir, encryptor),
  });
  const engine = new PackageEngine({ connectionStore, secretStore, environment, transport: options.transport });
  const compile = options.compile;
  const bridge = new RegistryBridge({
    service: engine.Service,
    createCompiler: () => ({
      compile: (compile ?? (() => Promise.resolve({ ok: true, diagnostics: [], errors: [] }))) as never,
    }),
    localStore,
  });
  // Run the (async) migration synchronously enough for the tests: they await the
  // first bridge call, and migration is awaited here via a promise the helper stores.
  // Kick it off and return a bridge whose first use is always after seeding.
  (bridge as unknown as { ready: Promise<void> }).ready = migration.MigrateIfNeeded();
  return bridge;
}

async function ready(bridge: RegistryBridge): Promise<RegistryBridge>
{
  await (bridge as unknown as { ready: Promise<void> }).ready;
  return bridge;
}

test("compileDir compiles under <dir>/dist and returns a serializable view", async () => {
  const bridge = await ready(makeBridge({ compile: (directory, opts) =>
    Promise.resolve({
      ok: true,
      diagnostics: [{ severity: "warning", message: "heads up" }],
      errors: [],
      files: ["package.json", "model.json"],
      package: { id: "demo", name: "@scope/demo", version: "0.1.0", sources: [{ uri: "a.todl", text: "" }] },
      _outDir: opts?.outDir,
      _dir: directory,
    }),
  }));
  const view = await bridge.compileDir("C:/proj/demo");
  assert.equal(view.ok, true);
  assert.equal(view.outDir, join("C:/proj/demo", "dist"));
  assert.deepEqual(view.files, ["package.json", "model.json"]);
  assert.equal(view.name, "@scope/demo");
  assert.equal(view.version, "0.1.0");
  assert.equal(view.sourceCount, 1);
  assert.deepEqual(view.diagnostics, [{ severity: "warning", message: "heads up" }]);
});

test("compileDir registers the compiled package into the local store", async () => {
  const store = new LocalPackageStore();
  const bridge = await ready(makeBridge({ store, compile: () =>
    Promise.resolve({ ok: true, diagnostics: [], errors: [], files: [], package: { id: "acme.demo", version: "1.0.0", sources: [] } }),
  }));
  assert.equal(store.has("acme.demo", "1.0.0"), false);
  await bridge.compileDir("/proj/demo");
  assert.equal(store.has("acme.demo", "1.0.0"), true);
});

test("bumpVersion writes the next unused patch to project.plexus (meta-model modelVersion)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "todl-bump-"));
  writeFileSync(join(dir, "project.plexus"), JSON.stringify({ type: "meta-model", id: "tech-architecture", version: 1, modelVersion: "0.1.0" }));
  const packument = { name: "@pragmatic-tech-ai/tech-architecture", "dist-tags": { latest: "0.1.1" }, versions: { "0.1.0": {}, "0.1.1": {} } };
  const bridge = await ready(makeBridge({ transport: new InMemoryNpm(200, [], { "@pragmatic-tech-ai/tech-architecture": packument }) }));

  const next = await bridge.bumpVersion(dir);
  assert.equal(next, "0.1.2"); // above the highest published (0.1.1)
  assert.equal(JSON.parse(readFileSync(join(dir, "project.plexus"), "utf8")).modelVersion, "0.1.2");
});

test("listConnections reports the seeded connection + hasToken; setConnectionToken flips it", async () => {
  const bridge = await ready(makeBridge());
  let conns = await bridge.listConnections();
  assert.equal(conns.length, 1);
  assert.equal(conns[0]!.name, "GitHub Packages");
  assert.equal(conns[0]!.scope, "@pragmatic-tech-ai");
  assert.equal(conns[0]!.isDefault, true);
  assert.equal(conns[0]!.hasToken, false);
  assert.ok(!("token" in conns[0]!)); // token value never crosses the bridge
  await bridge.setConnectionToken(conns[0]!.id, "ghp_x");
  conns = await bridge.listConnections();
  assert.equal(conns[0]!.hasToken, true);
  assert.equal(conns[0]!.tokenSource, "stored");
});

test("useConnectionEnvToken: hasToken reflects process.env, never the value", async () => {
  const bridge = await ready(makeBridge({ env: { GH_PAT: "ghp_fromenv" } }));
  const id = (await bridge.listConnections())[0]!.id;
  await bridge.useConnectionEnvToken(id, "GH_PAT");
  let view = (await bridge.listConnections())[0]!;
  assert.equal(view.tokenSource, "env");
  assert.equal(view.tokenEnvVar, "GH_PAT");
  assert.equal(view.hasToken, true);
  await bridge.useConnectionEnvToken(id, "NOPE");
  view = (await bridge.listConnections())[0]!;
  assert.equal(view.hasToken, false);
});

test("listEnvVars returns sorted defined env keys", async () => {
  const bridge = await ready(makeBridge({ env: { B: "1", A: "2", C: undefined } }));
  assert.deepEqual(await bridge.listEnvVars(), ["A", "B"]);
});

test("updateConnection is reflected in the connection view", async () => {
  const bridge = await ready(makeBridge());
  const id = (await bridge.listConnections())[0]!.id;
  await bridge.updateConnection(id, { org: "acme" });
  assert.equal((await bridge.listConnections())[0]!.org, "acme");
});

test("testConnection returns ok + package count on success", async () => {
  const bridge = await ready(makeBridge({ transport: new InMemoryNpm(200, ["a", "b"]) }));
  const id = (await bridge.listConnections())[0]!.id;
  assert.deepEqual(await bridge.testConnection(id), { ok: true, count: 2 });
});

test("testConnection surfaces the error message on failure (e.g. 401)", async () => {
  const bridge = await ready(makeBridge({ transport: new InMemoryNpm(401) }));
  const id = (await bridge.listConnections())[0]!.id;
  const result = await bridge.testConnection(id);
  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /401/);
});
