import { test, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionStore } from "../connection-store.js";
import { TokenSource, type ConnectionInput } from "../registry-connection.js";

let dir: string;
let store: ConnectionStore;

const INPUT: ConnectionInput = {
  name: "GitHub Packages",
  registry: "https://npm.pkg.github.com",
  scope: "@pragmatic-tech-ai",
  org: "pragmatic-tech-ai",
  githubApi: "https://api.github.com",
  tokenSource: TokenSource.Stored,
  tokenEnvVar: "",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conn-store-"));
  store = new ConnectionStore(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("a fresh store is empty and has no default", () => {
  assert.equal(store.isEmpty(), true);
  assert.deepEqual(store.list(), []);
  assert.equal(store.defaultId(), undefined);
});

test("add mints a slug id from the name and makes the first one default", () => {
  const c = store.add(INPUT);
  assert.equal(c.id, "github-packages");
  assert.equal(store.isEmpty(), false);
  assert.equal(store.defaultId(), "github-packages");
  assert.equal(store.get("github-packages")?.registry, "https://npm.pkg.github.com");
});

test("adding a second connection with the same name de-duplicates the id", () => {
  store.add(INPUT);
  const second = store.add({ ...INPUT, name: "GitHub Packages" });
  assert.equal(second.id, "github-packages-2");
  assert.equal(store.list().length, 2);
  // default stays the first one
  assert.equal(store.defaultId(), "github-packages");
});

test("update merges a partial edit and never changes the id", () => {
  store.add(INPUT);
  const updated = store.update("github-packages", { org: "acme", scope: "@acme" });
  assert.equal(updated?.id, "github-packages");
  assert.equal(updated?.org, "acme");
  assert.equal(store.get("github-packages")?.scope, "@acme");
});

test("update of an unknown id returns undefined", () => {
  assert.equal(store.update("nope", { org: "x" }), undefined);
});

test("remove drops the connection and promotes a new default", () => {
  store.add(INPUT);
  const second = store.add({ ...INPUT, name: "Internal" });
  assert.equal(store.defaultId(), "github-packages");
  store.remove("github-packages");
  assert.equal(store.get("github-packages"), undefined);
  assert.equal(store.defaultId(), second.id);
});

test("setDefault switches the default; unknown ids are ignored", () => {
  store.add(INPUT);
  const second = store.add({ ...INPUT, name: "Internal" });
  store.setDefault(second.id);
  assert.equal(store.defaultId(), second.id);
  store.setDefault("ghost");
  assert.equal(store.defaultId(), second.id);
});

test("state persists across store instances", () => {
  store.add(INPUT);
  const reopened = new ConnectionStore(dir);
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.defaultId(), "github-packages");
});
