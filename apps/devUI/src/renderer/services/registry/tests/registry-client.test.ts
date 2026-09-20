import { test, afterEach } from "vitest";
import assert from "node:assert/strict";
import { RegistryClient } from "../registry-client.js";

const calls: Array<[string, unknown[]]> = [];
function stubWindow(overrides: Record<string, (...a: any[]) => any> = {})
{
  const record = (name: string) => (...args: any[]) => {
    calls.push([name, args]);
    return overrides[name]?.(...args) ?? Promise.resolve(undefined);
  };
  (globalThis as any).window = {
    todl: {
      registry: { list: record("list"), versions: record("versions"), getContent: record("getContent"), getPackage: record("getPackage"), getMeta: record("getMeta"), resolveClosure: record("resolveClosure"), publishDir: record("publishDir"), getSources: record("getSources") },
      connections: { list: record("connections.list"), add: record("add"), update: record("update"), remove: record("remove"), setToken: record("setToken"), useEnvToken: record("useEnvToken"), setDefault: record("setDefault"), test: record("test"), listEnvVars: record("listEnvVars") },
      dialog: { pickDirectory: record("pickDirectory") },
    },
  };
}
afterEach(() => {
  calls.length = 0;
  delete (globalThis as any).window;
});

test("list forwards to window.todl.registry.list and returns its result", async () => {
  stubWindow({ list: () => Promise.resolve(["aws"]) });
  assert.deepEqual(await new RegistryClient().list(), ["aws"]);
  assert.deepEqual(calls[0], ["list", [undefined]]); // connectionId omitted ⇒ default connection
});

test("versions/getPackage/resolveClosure forward their arguments", async () => {
  stubWindow();
  const client = new RegistryClient();
  await client.versions("microsoft");
  await client.getPackage({ name: "aws" });
  await client.resolveClosure(["@pragmatic-tech-ai/aws"]);
  await client.getSources({ name: "aws" });
  assert.deepEqual(calls.map((c) => c[0]), ["versions", "getPackage", "resolveClosure", "getSources"]);
  assert.deepEqual(calls[0]![1], ["microsoft"]);
  assert.deepEqual(calls[1]![1], [{ name: "aws" }]);
  assert.deepEqual(calls[2]![1], [["@pragmatic-tech-ai/aws"]]);
  assert.deepEqual(calls[3]![1], [{ name: "aws" }]);
});

test("connection CRUD + token ops forward to the connections namespace", async () => {
  stubWindow({ "connections.list": () => Promise.resolve([{ Id: "gh", DisplayName: "GitHub" }]) });
  const client = new RegistryClient();
  assert.deepEqual(await client.listConnections(), [{ Id: "gh", DisplayName: "GitHub" }]);
  await client.setConnectionToken("gh", "ghp_x");
  await client.updateConnection("gh", { Settings: { org: "acme" } });
  await client.testConnection("gh");
  assert.deepEqual(calls.map((c) => c[0]), ["connections.list", "setToken", "update", "test"]);
  assert.deepEqual(calls[1]![1], ["gh", "ghp_x"]);
  assert.deepEqual(calls[2]![1], ["gh", { Settings: { org: "acme" } }]);
});
