import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

// The Package Manager tree roots are the registry CONNECTIONS; expanding a
// connection lists its packages (connection-scoped), and expanding a package
// lists its category nodes. The fake bridge therefore provides connections.list
// (one connection) plus registry.list / getPackageContents (which now receive a
// trailing connectionId the fakes ignore). `window.todl` is frozen by
// contextBridge, so RegistryClient reads the mutable `__todlBridge` override.
function installFakeRegistry(window: Page): Promise<void>
{
  return window.evaluate(() => {
    (window as unknown as { __pkgNames: string[] }).__pkgNames = ["aws", "azure"];
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      connections: {
        list: () => Promise.resolve([{ id: "gh", name: "GitHub Packages", isDefault: true, hasToken: true }]),
      },
      registry: {
        list: () => Promise.resolve((window as unknown as { __pkgNames: string[] }).__pkgNames),
        getPackageContents: (name: string) =>
          Promise.resolve({
            files: [{ name: name + ".todl", text: "concept " + name + "Root;" }],
            resources: [{ name: "theme.mu", text: "resources " + name + "Theme {}" }],
            packageJson: '{\n  "name": "@scope/' + name + '"\n}',
            metadata: '{\n  "kind": "library"\n}',
            compiled: '{\n  "nodes": []\n}',
            rawModel: '{"nodes":[]}',
            dependencies: ["@scope/base-" + name],
            versions: ["0.1.0"],
            latest: "0.1.0",
          }),
      },
    };
  });
}

function railCells(window: Page): Promise<{ x: number; y: number; w: number; h: number }[]>
{
  return window.evaluate(() => {
    const byY = new Map<number, { x: number; y: number; w: number; h: number }>();
    for (const el of Array.from(document.querySelectorAll("#app rect")))
    {
      const r = (el as Element).getBoundingClientRect();
      if (r.left < 4 && Math.round(r.width) === 48 && Math.round(r.height) === 48)
      {
        byY.set(Math.round(r.y), { x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    return Array.from(byY.values()).sort((a, b) => a.y - b.y);
  });
}

// Activate a rail capability robustly: wait for the rail to lay out, click its
// cell, and confirm the panel responded — a fresh-startup first click is
// sometimes swallowed, so retry.
async function activateCapability(window: Page, index: number, expectText: string): Promise<void>
{
  await expect.poll(async () => (await railCells(window)).length, { timeout: 15_000 }).toBeGreaterThan(index);
  for (let attempt = 0; attempt < 4; attempt += 1)
  {
    const c = (await railCells(window))[index]!;
    await window.mouse.click(c.x + c.w / 2, c.y + c.h / 2);
    const landed = await hasText(window, expectText)
      .then((v) => v || new Promise<boolean>((r) => setTimeout(() => r(hasText(window, expectText)), 1200)));
    if (await landed) return;
  }
  throw new Error(`capability ${index} did not activate (no "${expectText}")`);
}

function hasText(window: Page, text: string): Promise<boolean>
{
  return window.evaluate(
    (t) =>
      Array.from(document.querySelectorAll("#app text, #app tspan"))
        .map((n) => (n.textContent ?? "").trim())
        .some((s) => s === t),
    text,
  );
}

// The bounding box of an SVG tree-row label (first match, in the side panel).
function labelBox(window: Page, label: string): Promise<{ x: number; y: number; w: number; h: number } | null>
{
  return window.evaluate((t) => {
    for (const el of Array.from(document.querySelectorAll("#app text, #app tspan")))
    {
      if ((el.textContent ?? "").trim() === t)
      {
        const r = (el as Element).getBoundingClientRect();
        if (r.left < 360) return { x: r.x, y: r.y, w: r.width, h: r.height };
      }
    }
    return null;
  }, label);
}

// Expand a tree row by clicking its chevron — just left of the label text.
async function expandRow(window: Page, label: string): Promise<void>
{
  const b = await labelBox(window, label);
  if (b === null) throw new Error(`tree row "${label}" not found`);
  await window.mouse.click(b.x - 14, b.y + b.h / 2);
}

// Select a tree row by clicking its label.
async function selectRow(window: Page, label: string): Promise<void>
{
  const b = await labelBox(window, label);
  if (b === null) throw new Error(`tree row "${label}" not found`);
  await window.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
}

// Click an SVG label by coordinate (mural's full-pane hit rect swallows
// element-level clicks on the content).
async function clickText(window: Page, text: string): Promise<void>
{
  const b = await labelBox(window, text);
  if (b === null) throw new Error(`clickable text "${text}" not found`);
  await window.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
}

// The source/JSON renders in a Monaco editor (HTML in a <foreignObject>), not
// SVG <text> — read its rendered lines for content assertions.
function editorText(window: Page): Promise<string>
{
  return window.evaluate(() => {
    const lines = document.querySelector("#app .monaco-editor .view-lines");
    return lines ? (lines.textContent ?? "") : "";
  });
}

test("Packages: connection root lists its packages; Refresh re-fetches", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  await installFakeRegistry(window);

  // Activate Packages → its roots are the connections. Expand the connection to
  // list its packages.
  await activateCapability(window, 1, "GitHub Packages");
  await expandRow(window, "GitHub Packages");
  await expect.poll(() => hasText(window, "aws"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => hasText(window, "azure"), { timeout: 10_000 }).toBe(true);

  // Refresh re-fetches: add a package, Refresh rebuilds the (collapsed) connection
  // roots; re-expand the connection and the new package appears.
  await window.evaluate(() => {
    (window as unknown as { __pkgNames: string[] }).__pkgNames = ["aws", "azure", "gcp"];
  });
  await clickText(window, "Refresh");
  await expect.poll(() => hasText(window, "GitHub Packages"), { timeout: 10_000 }).toBe(true);
  await expandRow(window, "GitHub Packages");
  await expect.poll(() => hasText(window, "gcp"), { timeout: 10_000 }).toBe(true);

  await app.close();
});

test("Packages: expanding a package reveals category nodes; selecting a leaf shows it in the editor", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });

  await installFakeRegistry(window);
  await activateCapability(window, 1, "GitHub Packages");
  await expandRow(window, "GitHub Packages");
  await expect.poll(() => hasText(window, "aws"), { timeout: 10_000 }).toBe(true);

  // Expand the package node → lazy fetch builds the category nodes.
  await expandRow(window, "aws");
  await expect.poll(() => hasText(window, "Metadata"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => hasText(window, "package.json"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => hasText(window, "Compiled code"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => hasText(window, "Resources"), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => hasText(window, "Published versions"), { timeout: 10_000 }).toBe(true);

  // Expand Resources → the mural resource leaf; select it → its text in the editor.
  await expandRow(window, "Resources");
  await expect.poll(() => hasText(window, "theme.mu"), { timeout: 10_000 }).toBe(true);
  await selectRow(window, "theme.mu");
  await expect.poll(async () => (await editorText(window)).includes("awsTheme"), { timeout: 10_000 }).toBe(true);

  // Expand Files → the .todl file leaf; select it → its source in the editor.
  await expandRow(window, "Files");
  await expect.poll(() => hasText(window, "aws.todl"), { timeout: 10_000 }).toBe(true);
  await selectRow(window, "aws.todl");
  await expect.poll(async () => (await editorText(window)).includes("awsRoot"), { timeout: 10_000 }).toBe(true);

  // Select a JSON category → the editor swaps to that content.
  await selectRow(window, "Metadata");
  await expect.poll(async () => (await editorText(window)).includes("library"), { timeout: 10_000 }).toBe(true);

  await app.close();
});
