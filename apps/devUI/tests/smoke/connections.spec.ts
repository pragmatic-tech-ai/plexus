import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainEntry = resolve(here, "../../out/main/index.js");

// A fake connections bridge (in-memory list) installed over the mutable
// `__todlBridge` override — `window.todl` is frozen by contextBridge, and
// RegistryClient reads `__todlBridge` first (the production injection seam). This
// keeps the smoke deterministic (independent of the real userData connections.json)
// while still exercising the ConnectionsManagerModule VMs + templates end to end.
function installFakeConnections(window: Page): Promise<void> {
  return window.evaluate(() => {
    const rows: any[] = [{
      id: "gh", name: "GitHub Packages", registry: "https://npm.pkg.github.com",
      scope: "@pragmatic-tech-ai", org: "pragmatic-tech-ai", githubApi: "https://api.github.com",
      tokenSource: "stored", tokenEnvVar: "", hasToken: false, isDefault: true,
    }];
    (window as unknown as { __todlBridge: unknown }).__todlBridge = {
      connections: {
        list: () => Promise.resolve(rows.map((r) => ({ ...r }))),
        add: (input: any) => {
          const view = { id: "id-" + (rows.length + 1), hasToken: false, isDefault: false, ...input };
          rows.push(view);
          return Promise.resolve(view);
        },
        update: (id: string, partial: any) => {
          const row = rows.find((r) => r.id === id);
          if (row) Object.assign(row, partial);
          return Promise.resolve(row);
        },
        remove: (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return Promise.resolve(); },
        setToken: (id: string) => { const r = rows.find((x) => x.id === id); if (r) r.hasToken = true; return Promise.resolve(); },
        useEnvToken: () => Promise.resolve(),
        setDefault: () => Promise.resolve(),
        test: () => Promise.resolve({ ok: true, count: 2 }),
        listEnvVars: () => Promise.resolve(["PACKAGES_TOKEN"]),
      },
    };
  });
}

// Rail cells are 48×48 SVG rects stacked from the top.
function railCells(window: Page): Promise<{ x: number; y: number; w: number; h: number }[]> {
  return window.evaluate(() => {
    const byY = new Map<number, { x: number; y: number; w: number; h: number }>();
    for (const el of Array.from(document.querySelectorAll("#app rect"))) {
      const r = (el as Element).getBoundingClientRect();
      if (r.left < 4 && Math.round(r.width) === 48 && Math.round(r.height) === 48) {
        byY.set(Math.round(r.y), { x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    return Array.from(byY.values()).sort((a, b) => a.y - b.y);
  });
}

// Activate a rail capability robustly: wait for the rail to lay out, then click
// its cell and confirm the side panel responded (polling for `expectText`),
// retrying the click — a fresh-startup first rail click is sometimes swallowed.
async function activateCapability(window: Page, index: number, expectText: string): Promise<void> {
  await expect.poll(async () => (await railCells(window)).length, { timeout: 15_000 }).toBeGreaterThan(index);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const c = (await railCells(window))[index]!;
    await window.mouse.click(c.x + c.w / 2, c.y + c.h / 2);
    const landed = await hasTextContaining(window, expectText)
      .then((v) => v || new Promise<boolean>((r) => setTimeout(() => r(hasTextContaining(window, expectText)), 1200)));
    if (await landed) return;
  }
  throw new Error(`capability ${index} did not activate (no "${expectText}")`);
}

// Click an SVG label by coordinate — element-level clicks on lower content are
// swallowed by mural's full-pane hit rect, so click the text's centre via the
// mouse (the same approach the rail uses).
async function clickText(window: Page, text: string): Promise<void> {
  const box = await window.evaluate((t) => {
    for (const el of Array.from(document.querySelectorAll("#app text, #app tspan"))) {
      if ((el.textContent ?? "").trim() === t) {
        const r = (el as Element).getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }
    }
    return null;
  }, text);
  if (box === null) throw new Error(`clickable text "${text}" not found`);
  await window.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
}

function hasTextContaining(window: Page, text: string): Promise<boolean> {
  return window.evaluate(
    (t) =>
      Array.from(document.querySelectorAll("#app text, #app tspan"))
        .map((n) => (n.textContent ?? "").trim())
        .some((s) => s.includes(t)),
    text,
  );
}

test("Connections capability lists connections and renders the editor for the selected one", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  try {
    const window = await app.firstWindow();
    await window.waitForSelector("#app svg", { timeout: 30_000 });
    await installFakeConnections(window);

    // Activate the Connections capability (5th rail item) — OnActivated loads the list.
    // The seeded connection's summary shows in the master list, and the first row
    // auto-selects so the detail editor renders (its labels + Test button).
    await activateCapability(window, 4, "GitHub Packages");
    await expect.poll(() => hasTextContaining(window, "Registry URL"), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => hasTextContaining(window, "Test connection"), { timeout: 10_000 }).toBe(true);

    await app.close();
  } finally {
    // app.close already called on the happy path; guard against a mid-test throw.
  }
});

test("New connection adds a row; Test connection reports the outcome in the status line", async () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const app = await electron.launch({ args: [mainEntry], env });
  const window = await app.firstWindow();
  await window.waitForSelector("#app svg", { timeout: 30_000 });
  await installFakeConnections(window);
  await activateCapability(window, 4, "GitHub Packages");

  // New connection → the fake add() appends a row; its summary appears in the list.
  await clickText(window, "New connection");
  await expect.poll(() => hasTextContaining(window, "New connection"), { timeout: 10_000 }).toBe(true);

  // Test connection → the fake returns ok/count, surfaced in the VM's status line
  // ("Connected — 2 package(s)."). Assert on a single-word token; the full string
  // can split across SVG tspans.
  await clickText(window, "Test connection");
  await expect.poll(() => hasTextContaining(window, "Connected"), { timeout: 10_000 }).toBe(true);

  await app.close();
});
