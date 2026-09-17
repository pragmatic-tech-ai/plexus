import { test, expect, _electron as electron } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

test("connections.* round-trips renderer -> preload -> ipcMain -> stores -> renderer", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"]; // else Electron runs as plain Node (known gotcha)

  // A clean userData profile → deterministic migration output (one seeded
  // connection, no token) regardless of any real connections.json on this machine.
  const userDataDir = mkdtempSync(join(tmpdir(), "todl-e2e-"));

  const app = await electron.launch({ args: [mainEntry, `--user-data-dir=${userDataDir}`], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 }); // renderer mounted

  // First run migrated the legacy single-registry defaults into ONE connection.
  const connections = await window.evaluate(() => window.todl.connections.list());
  expect(connections).toHaveLength(1);
  expect(connections[0]).toMatchObject({
    name: "GitHub Packages",
    registry: "https://npm.pkg.github.com",
    scope: "@pragmatic-tech-ai",
    org: "pragmatic-tech-ai",
    tokenSource: "stored",
    hasToken: false, // fresh userData → no token
    isDefault: true,
  });
  // The token value is never exposed across the bridge — only `hasToken`.
  expect(connections[0]).not.toHaveProperty("token");

  // Storing a token round-trips through the encrypted keyed store and flips
  // hasToken — still without ever returning the value.
  const id = connections[0]!.id;
  const afterSet = await window.evaluate((connId) => {
    return window.todl.connections
      .setToken(connId, "ghp_e2e_secret")
      .then(() => window.todl.connections.list());
  }, id);
  expect(afterSet[0]!.hasToken).toBe(true);
  expect(afterSet[0]).not.toHaveProperty("token");

  await app.close();
});
