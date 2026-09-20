import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Unit tests only. mural-framework/.mu integration is verified via the
// electron-vite build and manual `npm run dev`, not Vitest.
//
// mural's dist loads fine under native Node ESM (its circular imports resolve via
// live bindings), but breaks when Vite TRANSFORMS it ("Class extends undefined").
// mural's package exports also nest import.development -> ./src/*.ts, which Vite's
// serve-mode resolver picks (dragging in uncompiled TS). Fix: alias every mural
// subpath to its built dist .js (absolute node_modules path -> vitest externalizes
// it -> Node imports it natively, no transform, cycle intact) and never touch src.
// Same for todl-runtime (mural re-exports its Observable) and todl (root + the
// subpaths these tests import: package-manager, domain).
const CONDITIONS = ["import", "module", "browser", "default"];

// Locate a package dir: app-local, then workspace root (npm workspaces hoist).
function pkgRoot(spec: string): string
{
  const hit = [
    new URL(`./node_modules/${spec}`, import.meta.url),
    new URL(`../../node_modules/${spec}`, import.meta.url),
  ]
    .map((u) => fileURLToPath(u))
    .find(existsSync);
  if (hit === undefined) throw new Error(`cannot locate ${spec} in app or workspace-root node_modules`);
  return hit;
}

const MURAL = pkgRoot("@pragmatic-tech-ai/mural");
const TODL = pkgRoot("@pragmatic-tech-ai/todl");
const TODL_RT = pkgRoot("@pragmatic-tech-ai/todl-runtime");

// Subpath regex maps e.g. mural/framework/shell/shell.js -> <mural>/dist/framework/
// shell/shell.js and todl/package-manager -> <todl>/dist/package-manager (Vite
// resolves the dir to index.js). Bare-root entries map to dist/index.js.
const ALIASES = [
  { find: /^@pragmatic-tech-ai\/mural$/, replacement: `${MURAL}/dist/index.js` },
  { find: /^@pragmatic-tech-ai\/mural\/(.*)$/, replacement: `${MURAL}/dist/$1` },
  { find: /^@pragmatic-tech-ai\/todl-runtime$/, replacement: `${TODL_RT}/dist/index.js` },
  { find: /^@pragmatic-tech-ai\/todl-runtime\/(.*)$/, replacement: `${TODL_RT}/dist/$1` },
  // package-manager lives under dist/solution-services/ (the src/solution-services
  // tree); this specific rule must precede the generic todl/* map, which would
  // otherwise point at a non-existent dist/package-manager.
  { find: /^@pragmatic-tech-ai\/todl\/package-manager\/connections$/, replacement: `${TODL}/dist/solution-services/package-manager/engine/registry-connection.js` },
  { find: /^@pragmatic-tech-ai\/todl\/package-manager$/, replacement: `${TODL}/dist/solution-services/package-manager/index.js` },
  { find: /^@pragmatic-tech-ai\/todl\/(.*)$/, replacement: `${TODL}/dist/$1` },
  { find: /^@pragmatic-tech-ai\/todl$/, replacement: `${TODL}/dist/index.js` },
];

export default defineConfig({
  resolve: { conditions: CONDITIONS, alias: ALIASES },
  ssr: { resolve: { conditions: CONDITIONS } },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Inline ONLY fresco: it ships a nested mural whose imports would otherwise
    // resolve (natively) to that copy's uncompiled src. Transforming fresco
    // routes its `@pragmatic-tech-ai/mural/*` imports through the dist aliases
    // above -> the single root mural dist. mural itself stays external
    // (transforming it breaks its circular init).
    server: { deps: { inline: [/@pragmatic-tech-ai\/fresco/] } },
  },
});
