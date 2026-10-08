import { resolve } from 'node:path'
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
// the renderer truly executes is node:path (HtmlAppContributor
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

    // esbuild is pulled into the renderer graph as DEAD code via the shared todl barrels
    // (todl's html-bundle BundleAppAction `import`s it), but the renderer never runs a
    // build — builds execute in the Electron main process over IPC. Unlike a Node builtin,
    // esbuild is a real package whose module body reads the `process` GLOBAL at import time
    // (`process.versions.node` in its worker-thread init), which is undefined in the browser
    // and throws `process is not defined` at boot. Stub it to a no-op like the builtins.
    private static readonly EsbuildModule = 'esbuild'

    // Other dead node PACKAGES in the renderer graph read the `process` global at import
    // time too (readdirp's `process.platform` in its fs-walk init, reachable via the
    // todl-runtime barrels). They never run in the browser, but the top-level read throws
    // `process is not defined`. A minimal `process` global satisfies those dead reads so the
    // renderer links and boots. Injected as an inline <head> classic script via
    // transformIndexHtml (NOT a build-only rollup banner): the dev server applies no rollup
    // `output` options, so a banner leaves `npm run dev` crashing on boot while the packaged
    // build is fine — the HTML injection runs in BOTH dev and build, and a classic head
    // script executes before the deferred entry module.
    public static readonly ProcessShim =
        'globalThis.process = globalThis.process || '
        + '{ platform: "browser", env: {}, versions: {}, argv: [], cwd: function () { return "/"; } };'

    public static Plugin(): Plugin
    {
        const builtins = new Set<string>(builtinModules.flatMap((m) => [m, `node:${m}`]))
        const deadPackages = new Set<string>([RendererNodeBoundary.EsbuildModule])
        const pathIds = new Set<string>(['path', 'node:path'])
        const prefix = RendererNodeBoundary.VirtualPrefix
        return {
            name: RendererNodeBoundary.PluginName,
            enforce: 'pre',
            resolveId(id)
            {
                return builtins.has(id) || deadPackages.has(id) ? `${prefix}${id}` : null
            },
            load(id)
            {
                if (!id.startsWith(prefix)) return null
                const name = id.slice(prefix.length)
                if (pathIds.has(name)) return { code: RendererNodeBoundary.PathModule, syntheticNamedExports: 'default', moduleSideEffects: false }
                return { code: RendererNodeBoundary.DeadStub, syntheticNamedExports: 'default', moduleSideEffects: false }
            },
            // Runs in BOTH dev and build — see ProcessShim. `head-prepend` + a classic
            // (non-module) script guarantees the shim executes before the deferred entry
            // module, so the first dead `process.platform` read already has its global.
            transformIndexHtml()
            {
                return [
                    {
                        tag: 'script',
                        injectTo: 'head-prepend',
                        children: RendererNodeBoundary.ProcessShim,
                    },
                ]
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

// todl + todl-runtime ship ESM-only; main/preload are CJS, so left external the main
// process would require() ESM and fail. Bundle them (esbuild handles the interop). esbuild
// carries a native binary, so it must stay external — but it is only a TRANSITIVE dep (via todl),
// which externalizeDepsPlugin does not cover, so it is listed explicitly as a rollup external.
// mural + fresco are likewise ESM-only (their package.json exports expose ONLY an `import`
// condition — no `require`/`default` a CJS require could resolve), and todl's build pipeline
// couples to the mural compiler/presentation baker, so bundling todl into main transitively
// reaches mural (and fresco). They must be bundled too, or main's CJS require() of them throws
// ERR_PACKAGE_PATH_NOT_EXPORTED at load. Their build-reachable modules run in Node — todl's own
// node build tests compile .mu / bake presentation through mural headlessly.
const ESBUILD = 'esbuild'
const TODL = '@pragmatic-tech-ai/todl'
const TODL_RUNTIME = '@pragmatic-tech-ai/todl-runtime'
const MURAL = '@pragmatic-tech-ai/mural'
const FRESCO = '@pragmatic-tech-ai/fresco'

// electron-vite drives three separate Rollup/Vite builds — main (Node),
// preload (Node, isolated bridge), and renderer (Chromium). The renderer is
// where mural lives: Vite bundles `mural/*` from the
// `file:../..` linked dependency.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [CORE, TODL, TODL_RUNTIME, MURAL, FRESCO] })],
    build: { rollupOptions: { external: [ESBUILD] } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: [CORE, TODL, TODL_RUNTIME] })],
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
