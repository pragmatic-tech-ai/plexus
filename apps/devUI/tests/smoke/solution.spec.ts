import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

// The Solutions flow uses REAL storage now: window.api.fs (shared FileSystemService,
// FileSystemStorage module) → the real node:fs handlers (registerFileSystemHandlers),
// so these tests point the folder picker at a real temp dir and assert against real
// files — mirroring Plexus's e2e (no fs stub). Only the native directory picker is
// stubbed, via the mutable `__todlBridge` override (contextBridge freezes
// `window.todl`); RegistryClient reads `__todlBridge` first. Navigation goes through
// the Home welcome page's own "New Solution" / "Open Solution" buttons (text, not
// rail geometry — robust to the shell chrome).
function setPickDir(window: Page, pickDir: string): Promise<void>
{
  return window.evaluate((pickDir) => {
    // Merge the REAL bridge so registry/connections keep working — only the
    // native directory picker is stubbed. (RegistryClient reads __todlBridge
    // wholesale, so a bare { dialog } would hide connections.list, etc.)
    const real = (window as unknown as { todl: Record<string, unknown> }).todl;
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      ...real,
      dialog: { pickDirectory: () => Promise.resolve(pickDir) },
    };
  }, pickDir);
}

function makeTempDir(): Promise<string>
{
  return mkdtemp(join(tmpdir(), "devui-sol-"));
}

function allText(window: Page): Promise<string>
{
  return window.evaluate(() =>
    Array.from(document.querySelectorAll("#app text, #app tspan"))
      .map((n) => n.textContent ?? "")
      .join(" "),
  );
}


test("Solutions: New Solution → settings pane renders → Save writes solution.json", async () => {
  const dir = await makeTempDir();
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  try
  {
    const window = await app.firstWindow();
    await window.waitForSelector("#app svg", { timeout: 30_000 });
    await expect.poll(async () => (await allText(window)).includes("Welcome to TODL"), { timeout: 10_000 }).toBe(true);

    await setPickDir(window, dir);

    // New Solution (Home) → an empty solution becomes active in the Solutions view;
    // its title + the cross-project Connection picker appear in the side pane. The
    // real bridge migrated one "GitHub Packages" connection, so the picker lists it.
    await window.getByText("New Solution", { exact: true }).first().click();
    await expect.poll(async () => (await allText(window)).includes("Untitled Solution"), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await allText(window)).includes("Connection"), { timeout: 10_000 }).toBe(true);

    // Save → the manifest is written to solution.json in the picked folder (real disk).
    await window.getByText("Save", { exact: true }).first().click();
    await expect
      .poll(async () => readFile(join(dir, "solution.json"), "utf8").catch(() => ""), { timeout: 10_000 })
      .toContain("todl-solution");
  }
  finally
  {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Home welcome is the startup landing; New Solution navigates to the Solutions view", async () => {
  const dir = await makeTempDir();
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  try
  {
    const window = await app.firstWindow();
    await window.waitForSelector("#app svg", { timeout: 30_000 });

    // Startup lands on Home — now a welcome page, not the empty scaffold placeholder.
    await expect.poll(async () => (await allText(window)).includes("Welcome to TODL"), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await allText(window)).includes("New Solution"), { timeout: 10_000 }).toBe(true);

    // Clicking New Solution creates one AND switches to the Solutions capability,
    // so its settings pane (npm-registry fields) is now visible.
    await setPickDir(window, dir);
    await window.getByText("New Solution", { exact: true }).first().click();
    await expect.poll(async () => (await allText(window)).includes("Untitled Solution"), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await allText(window)).includes("Connection"), { timeout: 10_000 }).toBe(true);
  }
  finally
  {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Solutions: Open a solution with a todl-package member shows the member row", async () => {
  const dir = await makeTempDir();
  // Pre-seed the solution folder on real disk: a manifest naming one ./api member
  // (type todl-package) + that member's project.plexus manifest.
  const solutionJson = JSON.stringify({
    kind: "todl-solution",
    version: 1,
    name: "Seeded Solution",
    members: [{ path: "./api", type: "todl-package" }],
    settings: {},
  });
  const projectPlexus = JSON.stringify({ type: "todl-package", name: "API", version: 1 });
  await writeFile(join(dir, "solution.json"), solutionJson, "utf8");
  await mkdir(join(dir, "api"), { recursive: true });
  await writeFile(join(dir, "api", "project.plexus"), projectPlexus, "utf8");

  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  try
  {
    const window = await app.firstWindow();
    await window.waitForSelector("#app svg", { timeout: 30_000 });
    await expect.poll(async () => (await allText(window)).includes("Open Solution"), { timeout: 10_000 }).toBe(true);

    await setPickDir(window, dir);

    // Open Solution (Home) → picks the seeded folder, loads the manifest.
    await window.getByText("Open Solution", { exact: true }).first().click();
    await expect.poll(async () => (await allText(window)).includes("Seeded Solution"), { timeout: 10_000 }).toBe(true);
    // The member row (its relative path "api", normalized from "./api") appears in
    // the Solution Explorer tree.
    await expect.poll(async () => (await allText(window)).includes("api"), { timeout: 10_000 }).toBe(true);
  }
  finally
  {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Solutions: the connection picker lists the migrated GitHub Packages connection", async () => {
  const dir = await makeTempDir();
  // A clean userData profile so migration seeds exactly one "GitHub Packages"
  // connection, independent of this machine's real state.
  const userDataDir = await makeTempDir();
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry, `--user-data-dir=${userDataDir}`], env });
  try
  {
    const window = await app.firstWindow();
    await window.waitForSelector("#app svg", { timeout: 30_000 });
    await expect.poll(async () => (await allText(window)).includes("Welcome to TODL"), { timeout: 10_000 }).toBe(true);

    await setPickDir(window, dir);
    await window.getByText("New Solution", { exact: true }).first().click();
    await expect.poll(async () => (await allText(window)).includes("Connection"), { timeout: 10_000 }).toBe(true);

    // The picker's ItemsSource is populated from the real connections bridge
    // (migrated "GitHub Packages"). Assert the connection reached the combo — the
    // selection→persist round-trip (bag.Set + Save) is covered by unit tests, as a
    // mural ComboBox dropdown can't be realized under the Playwright harness.
    const comboItems = await window.evaluate(() => {
      const REF = Symbol.for("mural:visual-backref");
      let labelY = -1;
      let labelX = -1;
      for (const el of Array.from(document.querySelectorAll("#app text, #app tspan")))
      {
        if ((el.textContent ?? "").trim() === "Connection")
        {
          const r = (el as Element).getBoundingClientRect();
          labelY = r.y; labelX = r.x; break;
        }
      }
      for (const el of Array.from(document.querySelectorAll("#app *")))
      {
        const v = (el as unknown as Record<symbol, { constructor?: { name?: string }; ItemsSource?: { ToArray(): unknown[] } }>)[REF];
        if (v?.constructor?.name !== "ComboBox") continue;
        const r = (el as Element).getBoundingClientRect();
        if (r.y >= labelY && Math.abs(r.x - labelX) < 40)
        {
          return (v.ItemsSource?.ToArray() ?? []).map((x) => String(x));
        }
      }
      return [];
    });
    expect(comboItems).toContain("GitHub Packages");
  }
  finally
  {
    await app.close();
    await rm(dir, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
});
