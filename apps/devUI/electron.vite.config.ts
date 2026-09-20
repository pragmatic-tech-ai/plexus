import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { vitePluginMural } from "@pragmatic-tech-ai/mural/tooling";
import { MuralRendererConfig } from "@pragmatic-tech-ai/plexus-core/vite/mural-renderer";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const rendererSrc = resolve(here, "src/renderer");
// apps/devUI -> workspace root. npm workspaces hoist deps to the ROOT
// node_modules, so every path into a dependency must probe app-local first,
// then the workspace root.
const workspaceRoot = resolve(here, "../..");

function depFile(rel: string): string
{
  const hit = [
    resolve(here, "node_modules", rel),
    resolve(workspaceRoot, "node_modules", rel),
  ].find(existsSync);
  if (hit === undefined)
  {
    throw new Error(`cannot resolve ${rel} in app or workspace-root node_modules`);
  }
  return hit;
}

// @pragmatic-tech-ai/todl is consumed from the registry (^0.33.4) as a normal
// workspace dependency. Its exports map nests import.default -> dist/*/index.js,
// which Vite's resolvePackageEntry mishandles (the same quirk Plexus aliases
// around); resolve the installed package's dist dir and alias each USED subpath
// to its concrete built entry.
const TODL_DIST = resolve(dirname(depFile("@pragmatic-tech-ai/todl/package.json")), "dist");
const todlAliases = [
  { find: /^@pragmatic-tech-ai\/todl\/package-manager\/connections$/, replacement: resolve(TODL_DIST, "solution-services/package-manager/engine/registry-connection.js") },
  { find: /^@pragmatic-tech-ai\/todl\/package-manager$/, replacement: resolve(TODL_DIST, "solution-services/package-manager/index.js") },
  { find: /^@pragmatic-tech-ai\/todl\/domain$/, replacement: resolve(TODL_DIST, "domain/index.js") },
  { find: /^@pragmatic-tech-ai\/todl\/language-server$/, replacement: resolve(TODL_DIST, "language-server/index.js") },
  { find: /^@pragmatic-tech-ai\/todl\/language-service$/, replacement: resolve(TODL_DIST, "language-service/index.js") },
  { find: /^@pragmatic-tech-ai\/todl$/, replacement: resolve(TODL_DIST, "index.js") },
];

// The filesystem-backed `include` resolver (SVG -> Geometry resource) isn't on
// the tooling barrel, so pull it from mural's compiled dist. Imported at RUNTIME
// via a computed URL (not a string literal) so esbuild leaves it external when
// it bundles this config -- otherwise its transitive visual-engine/runtime graph
// gets hoisted into the app context and a bare `todl-runtime` import fails to
// resolve. As a real runtime import, Node resolves the resolver's deps from
// mural's own node_modules. Passing it to the plugin makes `include "...svg" as
// Key` work at compile time; the app authors capability icons under
// src/renderer/icons.
type IncludeOpt = NonNullable<Parameters<typeof vitePluginMural>[0]>["include"];
const { makeIncludeResolver } = (await import(
  pathToFileURL(depFile("@pragmatic-tech-ai/mural/dist/tooling/include-resolver.js")).href
)) as { makeIncludeResolver: (baseDir: string) => IncludeOpt };

export default defineConfig({
  main: {
    // todl's dist is ESM ("type":"module"); left external it would be
    // `require()`d from the CJS main, which only works on Node builds new enough
    // for require(ESM). Excluding it from externalization (so it isn't marked
    // external) + the absolute alias below makes esbuild BUNDLE todl's
    // package-manager (and its transitive graph) into the CJS main — no runtime
    // ESM-interop dependency on Electron's Node version.
    plugins: [
      externalizeDepsPlugin({
        // plexus-core is first-party ESM: bundle it into the CJS main (don't
        // externalize) so its updater is inlined and CJS interop holds.
        exclude: ["@pragmatic-tech-ai/todl", "@pragmatic-tech-ai/todl-runtime", "@pragmatic-tech-ai/plexus-core"],
      }),
    ],
    resolve: {
      alias: [todlAliases[0]],
    },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    // `include` paths in .mu resolve relative to rendererSrc (where app-icons.mu
    // lives), so a capability's `Icon = @Home` splices src/renderer/icons/home.svg.
    plugins: [vitePluginMural({ include: makeIncludeResolver(rendererSrc) })],
    // Mural resolves themes/DataTemplates by runtime Class.name - do not rename.
    esbuild: { keepNames: true },
    // Do NOT pre-bundle mural: its esbuild optimizeDeps bundle mis-orders the
    // theme/scheme modules (Material builds before its dark scheme is ready) ->
    // ThemeManager.ActivateTheme fails and the shell renders empty in dev. Served
    // as real ESM, live bindings + URL dedup keep a single, correctly-ordered
    // mural. The shared exclude list (canonical for both apps) lives in
    // plexus-core; the condition set below still routes mural to dist, not src.
    optimizeDeps: {
      exclude: MuralRendererConfig.optimizeDepsExclude(),
      esbuildOptions: { conditions: ["module", "browser"] },
    },
    build: { target: "esnext" }, // top-level await in the renderer bootstrap
    resolve: {
      // Consume published mural via its compiled `dist` (the tested artifact),
      // NOT its `src`. The shared condition set drops "development", so the mural
      // exports map resolves to `default` (dist) even in `electron-vite dev`.
      // Its `development` -> `./src` path relies on a src/build theme-registration
      // seam that only holds when bundled (build), so under native-ESM dev it
      // left the Material dark scheme unregistered -> ThemeManager.ActivateTheme
      // threw and the shell rendered empty. We no longer live-edit mural source
      // here (it's a published dep), so dist-in-dev is both correct and matches
      // the build. Shared with Plexus via plexus-core's MuralRendererConfig.
      conditions: MuralRendererConfig.resolve().conditions,
      alias: [...todlAliases],
    },
    // Allow Vite to serve files from the whole workspace (hoisted node_modules
    // live at the workspace root, not app-local).
    server: { fs: { allow: [workspaceRoot] } },
  },
});
