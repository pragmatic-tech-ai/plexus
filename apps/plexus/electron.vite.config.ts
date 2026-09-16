import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { defineConfig } from 'electron-vite'

// @pragmatic-tech-ai/todl's dist entry — probe app-local then hoisted
// workspace-root node_modules (npm workspaces hoist todl to the repo root).
const TODL_DIST: string = (() => {
  const rel = '@pragmatic-tech-ai/todl/dist/index.js'
  const hit = [
    new URL(`./node_modules/${rel}`, import.meta.url),
    new URL(`../../node_modules/${rel}`, import.meta.url),
  ].map(fileURLToPath).find(existsSync)
  if (hit === undefined) throw new Error(`cannot resolve ${rel} in app or workspace-root node_modules`)
  return hit
})()

// electron-vite drives three separate Rollup/Vite builds — main (Node),
// preload (Node, isolated bridge), and renderer (Chromium). The renderer is
// where mural lives: Vite bundles `mural/*` from the
// `file:../..` linked dependency.
export default defineConfig({
  // Don't empty out/main on build: the vendored TODL language-server bundle
  // (out/main/todl-language-server.cjs, produced by scripts/build-todl-server.mjs
  // before electron-vite runs) lives here and must survive the main build.
  main: { build: { emptyOutDir: false } },
  preload: {},
  renderer: {
    resolve: {
      // Pin mural to its BUILT dist (the `default`/`import` export
      // conditions), NOT the `development` condition (which points at
      // src/*.ts). mural's source uses NodeNext `.js` import specifiers that
      // resolve to `.ts` under tsc but that Vite's resolver will not remap —
      // so bundling src would break. Consume the compiled dist instead and
      // rebuild it (root `npm run build`) when framework source changes.
      conditions: ['import', 'module', 'browser', 'default'],
      // Redirect ONLY the bare `opentype.js` specifier (regex-anchored, so
      // the shim's own deep import to dist/opentype.mjs is untouched) to a
      // shim that provides the default export mural imports. opentype.js's
      // ESM bundle ships named exports only; a pure-ESM bundler won't
      // synthesise the default the way Node's CJS interop does.
      alias: [
        {
          find: /^opentype\.js$/,
          replacement: fileURLToPath(new URL('./src/renderer/opentype-shim.mjs', import.meta.url)),
        },
        // @pragmatic-tech-ai/todl exposes only a ROOT ('.') export, whose nested
        // import.default → dist/index.js trips Vite's resolvePackageEntry (as
        // it does for mural's root — hence subpath imports everywhere else).
        // Redirect the bare specifier straight to the built entry.
        {
          find: /^@pragmatic-tech-ai\/todl$/,
          replacement: TODL_DIST,
        },
        // mural's COMPILER (run in-process by LibraryRegistry to compile `.mural`
        // visual templates at runtime) statically imports `createRequire` from
        // `node:module`. In the Chromium renderer that specifier externalises to a
        // proxy that throws on access, crashing the page at module load. Redirect
        // it to a browser shim (no-op createRequire); the compiler's materialBundle
        // try/catch tolerates the empty result. Renderer-only — the Node CLI
        // (`compile:mu`) uses the real builtin.
        {
          find: /^node:module$/,
          replacement: fileURLToPath(new URL('./src/renderer/node-module-shim.mjs', import.meta.url)),
        },
      ],
    },
    // mural is a `file:../..` linked package under active development. Vite's
    // dep pre-bundler snapshots node_modules deps into .vite/deps at dev-server
    // start and does NOT re-optimize when the linked dist changes underneath it —
    // so a framework rebuild (new DPs, services, controls) is silently masked by
    // a stale pre-bundle until the cache is manually cleared. Excluding mural from
    // pre-bundling makes Vite serve the live dist on every request: rebuild the
    // root dist and the renderer picks it up on reload, no cache dance. Safe —
    // exclude only skips bundling, resolution is unaffected.
    optimizeDeps: {
      // Exclude fresco alongside mural: fresco imports @pragmatic-tech-ai/mural,
      // and pre-bundling fresco while mural is excluded leaves fresco's mural
      // import external — a mixed optimized/non-optimized graph that produces
      // stale "504 Outdated Optimize Dep" errors. Excluding both serves them as
      // live dist ESM sharing one mural instance.
      exclude: ['@pragmatic-tech-ai/mural', '@pragmatic-tech-ai/fresco'],
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
  },
})
