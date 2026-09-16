import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { MuralRendererConfig } from '@pragmatic-tech-ai/plexus-core/vite/mural-renderer'

// plexus-core is first-party workspace code, not a third-party runtime dep — it
// must be BUNDLED into the app's (CJS) main + preload, not externalized. Left
// external, its ESM dist runs natively in Electron's main and its CommonJS deps
// (electron-updater's `autoUpdater` named export, …) fail the ESM interop that
// esbuild handles when bundling. electron/chokidar/etc. stay external as usual.
const CORE = '@pragmatic-tech-ai/plexus-core'

// @pragmatic-tech-ai/todl's dist entry — probe app-local then hoisted
// workspace-root node_modules (npm workspaces hoist todl to the repo root).
const TODL_DIST: string = (() => {
  const rel = '@pragmatic-tech-ai/todl/dist/index.js'
  const hit = [
    new URL(`./node_modules/${rel}`, import.meta.url),
    new URL(`../../node_modules/${rel}`, import.meta.url),
  ].map((u) => fileURLToPath(u)).find(existsSync)
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
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [CORE] })],
    build: { emptyOutDir: false },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: [CORE] })],
  },
  renderer: {
    resolve: {
      // Shared mural handling (dist-pinning conditions + opentype / node:module
      // shims) comes from plexus-core so every app resolves mural identically.
      conditions: MuralRendererConfig.resolve().conditions,
      alias: [
        ...MuralRendererConfig.resolve().alias,
        // App-specific: @pragmatic-tech-ai/todl exposes only a ROOT ('.') export
        // whose nested import.default → dist/index.js trips Vite's
        // resolvePackageEntry; redirect the bare specifier to the built entry.
        // The path is app-specific (probed above), so it stays here.
        {
          find: /^@pragmatic-tech-ai\/todl$/,
          replacement: TODL_DIST,
        },
      ],
    },
    // Keep mural + fresco out of Vite's dep pre-bundler so a rebuilt framework
    // dist is served live and both share one mural instance (see plexus-core's
    // MuralRendererConfig.optimizeDepsExclude for the rationale).
    optimizeDeps: {
      exclude: MuralRendererConfig.optimizeDepsExclude(),
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
  },
})
