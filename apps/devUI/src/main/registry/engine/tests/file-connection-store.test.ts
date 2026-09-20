import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileConnectionStore } from "../file-connection-store.js";
import { TokenSource, type ConnectionSpec } from "@pragmatic-tech-ai/todl/package-manager";

const freshDir = () => mkdtempSync(join(tmpdir(), "todl-connstore-"));

function spec(id: string, registry = "https://npm.pkg.github.com"): ConnectionSpec
{
  return { Id: id, DisplayName: id, RegistryType: "npm", Settings: { registry }, TokenSource: TokenSource.Stored, TokenEnvVar: "" };
}

test("saves and reads back connection specs; first becomes default", async () => {
  const store = new FileConnectionStore(freshDir());
  await store.Save(spec("a"));
  await store.Save(spec("b"));

  assert.deepEqual((await store.All()).map((c) => c.Id), ["a", "b"]);
  assert.equal((await store.Get("a"))?.Settings["registry"], "https://npm.pkg.github.com");
  assert.equal(await store.DefaultId(), "a");
});

test("Save updates an existing spec in place", async () => {
  const store = new FileConnectionStore(freshDir());
  await store.Save(spec("a", "https://one"));
  await store.Save(spec("a", "https://two"));

  assert.equal((await store.All()).length, 1);
  assert.equal((await store.Get("a"))?.Settings["registry"], "https://two");
});

test("SetDefault changes the default; Delete promotes the first remaining", async () => {
  const store = new FileConnectionStore(freshDir());
  await store.Save(spec("a"));
  await store.Save(spec("b"));

  await store.SetDefault("b");
  assert.equal(await store.DefaultId(), "b");

  await store.Delete("b");
  assert.equal(await store.DefaultId(), "a");
});

test("reads the pre-engine flat connections.json format", async () => {
  const dir = freshDir();
  writeFileSync(join(dir, "connections.json"), JSON.stringify({
    version: 1,
    defaultId: "github-packages",
    connections: [
      {
        id: "github-packages",
        name: "GitHub Packages",
        registry: "https://npm.pkg.github.com",
        scope: "@pragmatic-tech-ai",
        org: "pragmatic-tech-ai",
        githubApi: "https://api.github.com",
        tokenSource: "env",
        tokenEnvVar: "GH_PAT",
      },
    ],
  }));
  const store = new FileConnectionStore(dir);

  const loaded = await store.Get("github-packages");
  assert.equal(loaded?.DisplayName, "GitHub Packages");
  assert.equal(loaded?.Settings["scope"], "@pragmatic-tech-ai");
  assert.equal(loaded?.Settings["org"], "pragmatic-tech-ai");
  assert.equal(loaded?.TokenSource, TokenSource.Env);
  assert.equal(loaded?.TokenEnvVar, "GH_PAT");
  assert.equal(await store.DefaultId(), "github-packages");
});
