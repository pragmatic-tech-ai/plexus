// Shared electron-vite RENDERER fragments for a mural app. Each app composes
// these into its own defineConfig so the mural handling stays identical across
// apps without a monolithic shared config. App-specific bits (the todl→dist
// alias, whose path differs per app, and the rollup input) stay in the app.
export class MuralRendererConfig {
    // resolve.conditions that pin mural to its built dist (drop "development",
    // which points at uncompiled src). As of mural 0.55.14 no shim aliases are
    // needed: mural imports opentype.js's ESM bundle path directly (the one
    // specifier Node and bundlers both treat as real ESM) and no longer imports
    // `node:module` in shipped source, so the compiler runs unchanged in the
    // Chromium renderer.
    public static resolve(): { conditions: string[] } {
        return {
            conditions: ['import', 'module', 'browser', 'default'],
        }
    }

    // Packages to keep out of Vite's dep pre-bundler so a rebuilt framework dist
    // is served live (mural is under active development upstream) and fresco
    // shares the same single mural instance.
    public static optimizeDepsExclude(): string[] {
        return ['@pragmatic-tech-ai/mural', '@pragmatic-tech-ai/fresco']
    }
}
