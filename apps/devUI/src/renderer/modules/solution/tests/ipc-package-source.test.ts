import { test } from "vitest";
import assert from "node:assert/strict";
import { IpcPackageSource } from "../ipc-package-source.js";
import type { RegistryClient } from "../../../services/registry/registry-client.js";

test("resolve/versions delegate to the RegistryClient with the default connection", async () => {
  const calls: string[] = [];
  const client = {
    resolvePackage: async (ref: { model: string; version?: string }, connectionId?: string) => {
      calls.push(`resolve:${ref.model}:${connectionId ?? "default"}`);
      return { ref: { model: ref.model, version: "1.0.0" }, manifest: new Uint8Array(), dependencies: [] };
    },
    packageVersions: async (model: string, connectionId?: string) => {
      calls.push(`versions:${model}:${connectionId ?? "default"}`);
      return ["1.0.0"];
    },
  } as unknown as RegistryClient;

  const src = new IpcPackageSource(client);
  const resolved = await src.resolve({ model: "acme.a", version: "1.0.0" });
  assert.equal(resolved.ref.model, "acme.a");
  assert.deepEqual(await src.versions("acme.a"), ["1.0.0"]);
  assert.deepEqual(calls, ["resolve:acme.a:default", "versions:acme.a:default"]);
});

test("SetConnection routes subsequent resolve/versions at that connection", async () => {
  const seen: Array<string | undefined> = [];
  const client = {
    resolvePackage: async (ref: { model: string }, connectionId?: string) => {
      seen.push(connectionId);
      return { ref: { model: ref.model, version: "1.0.0" }, manifest: new Uint8Array(), dependencies: [] };
    },
    packageVersions: async (_model: string, connectionId?: string) => {
      seen.push(connectionId);
      return ["1.0.0"];
    },
  } as unknown as RegistryClient;

  const src = new IpcPackageSource(client);
  src.SetConnection("internal");
  await src.resolve({ model: "acme.a" } as never);
  await src.versions("acme.a");
  assert.deepEqual(seen, ["internal", "internal"]);

  src.SetConnection(undefined); // back to the default connection
  await src.versions("acme.b");
  assert.equal(seen[2], undefined);
});
