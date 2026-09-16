import { fileURLToPath } from 'node:url'

// Shared electron-vite RENDERER fragments for a mural app. Each app composes
// these into its own defineConfig so the mural handling stays identical across
// apps without a monolithic shared config. App-specific bits (the todl→dist
// alias, whose path differs per app, and the rollup input) stay in the app.
export class MuralRendererConfig {
    // Absolute path to a shipped shim under src/renderer/shims. Resolved from
    // THIS built file (dist/vite/mural-renderer.js) up to the package root, then
    // into src — the workspace symlink always exposes src (private package).
    private static shim(rel: string): string {
        return fileURLToPath(new URL(`../../src/renderer/shims/${rel}`, import.meta.url))
    }

    // resolve.conditions that pin mural to its built dist (drop "development",
    // which points at uncompiled src) + the shim redirects mural needs in a
    // pure-ESM bundler: opentype.js default-export shim and a browser no-op for
    // the compiler's `node:module` createRequire import.
    public static resolve(): { conditions: string[]; alias: Array<{ find: RegExp; replacement: string }> } {
        return {
            conditions: ['import', 'module', 'browser', 'default'],
            alias: [
                { find: /^opentype\.js$/, replacement: MuralRendererConfig.shim('opentype-shim.mjs') },
                { find: /^node:module$/, replacement: MuralRendererConfig.shim('node-module-shim.mjs') },
            ],
        }
    }

    // Packages to keep out of Vite's dep pre-bundler so a rebuilt framework dist
    // is served live (mural is under active development upstream) and fresco
    // shares the same single mural instance.
    public static optimizeDepsExclude(): string[] {
        return ['@pragmatic-tech-ai/mural', '@pragmatic-tech-ai/fresco']
    }
}
