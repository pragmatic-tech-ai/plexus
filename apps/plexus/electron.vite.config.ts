import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import { MuralRendererConfig } from '@pragmatic-tech-ai/plexus-core/vite/mural-renderer'

// The renderer runs WITHOUT Node integration (webPreferences.nodeIntegration defaults to
// false; sandbox:false only drops the OS sandbox), so Node builtins are not available at
// runtime. Modules reachable from the shared todl/todl-runtime barrels pull some Node
// builtins into the renderer graph — node:zlib via the registry tar reader, node:stream via
// readdirp's fs walk — as DEAD code: the renderer does all real fs/registry work over IPC
// and never executes them. Vite's default `__vite-browser-external` stub lacks their named
// exports (gunzipSync, Readable, …) so the production Rollup build errors. The ONE builtin
// the renderer truly executes is node:path (DiskBuildStorageProvider + HtmlAppContributor
// `join` display/disk paths that are then handed to main over IPC) — it gets a real POSIX
// browser impl; every other builtin resolves to a harmless no-op so the dead code links.
// Renderer-only (added to `renderer.plugins`): main/preload keep real Node via externalize.
class RendererNodeBoundary
{
    private static readonly VirtualPrefix = '\0node-boundary:'
    private static readonly PluginName = 'plexus:renderer-node-boundary'
    private static readonly PathModule =
        'const str = (p) => String(p);\n'
        + 'const join = (...parts) => parts.filter((p) => p !== undefined && p !== null && p !== "").map(str).join("/").replace(/\\/{2,}/g, "/");\n'
        + 'const resolve = (...parts) => { const j = join(...parts); return j.startsWith("/") ? j : "/" + j; };\n'
        + 'const basename = (p) => { const s = str(p).split(/[\\\\/]/); return s[s.length - 1]; };\n'
        + 'const dirname = (p) => { const s = str(p).split(/[\\\\/]/); s.pop(); return s.join("/") || "."; };\n'
        + 'const extname = (p) => { const b = basename(p); const i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; };\n'
        + 'const relative = (_from, to) => str(to);\n'
        + 'const sep = "/";\n'
        + 'const impl = { sep, join, resolve, basename, dirname, extname, relative };\n'
        + 'const fallback = () => "";\n'
        + 'export default new Proxy(impl, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : fallback) });\n'
    private static readonly DeadStub =
        'const noop = function () {};\n'
        + 'export default new Proxy(noop, { get: () => noop, apply: () => undefined });\n'

    public static Plugin(): Plugin
    {
        const builtins = new Set<string>(builtinModules.flatMap((m) => [m, `node:${m}`]))
        const pathIds = new Set<string>(['path', 'node:path'])
        const prefix = RendererNodeBoundary.VirtualPrefix
        return {
            name: RendererNodeBoundary.PluginName,
            enforce: 'pre',
            resolveId(id)
            {
                return builtins.has(id) ? `${prefix}${id}` : null
            },
            load(id)
            {
                if (!id.startsWith(prefix)) return null
                const name = id.slice(prefix.length)
                if (pathIds.has(name)) return { code: RendererNodeBoundary.PathModule, syntheticNamedExports: 'default', moduleSideEffects: false }
                return { code: RendererNodeBoundary.DeadStub, syntheticNamedExports: 'default', moduleSideEffects: false }
            },
        }
    }
}

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
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [CORE] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: [CORE] })],
  },
  renderer: {
    // Keep Node builtins out of the browser bundle (dead fs/registry code from the
    // shared todl barrels) while giving node:path a real browser impl. See
    // RendererNodeBoundary above.
    plugins: [RendererNodeBoundary.Plugin()],
    resolve: {
      // Shared mural handling (dist-pinning conditions + single-copy dedupe)
      // comes from plexus-core so every app resolves mural identically. mural
      // 0.55.14+ needs no shim aliases (opentype ESM-bundle import + no
      // node:module in shipped source). dedupe forces one physical mural/fresco/
      // todl copy into the bundle even when the workspaces' versions disagree —
      // without it two theme copies load and the shell crashes on boot.
      conditions: MuralRendererConfig.resolve().conditions,
      dedupe: MuralRendererConfig.resolve().dedupe,
      alias: [
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
