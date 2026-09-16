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

    // Specifiers to keep out of Vite's dep pre-bundler. mural must be served as
    // live ESM (not esbuild-optimized): the optimize pass mis-orders mural's
    // theme/scheme modules (Material builds before its dark scheme is ready) so
    // ThemeManager.ActivateTheme fails and the shell renders empty. Vite treats
    // each subpath as its own optimize target, so every mural subpath an app can
    // import must be listed explicitly — the bare specifier alone doesn't cover
    // them. fresco shares mural, so exclude it too. This is the canonical list
    // for BOTH apps; excluding a specifier an app never imports is harmless.
    public static optimizeDepsExclude(): string[] {
        return [
            '@pragmatic-tech-ai/mural',
            '@pragmatic-tech-ai/mural/runtime',
            '@pragmatic-tech-ai/mural/basic',
            '@pragmatic-tech-ai/mural/framework',
            '@pragmatic-tech-ai/mural/visual-engine',
            '@pragmatic-tech-ai/mural/tooling',
            '@pragmatic-tech-ai/mural/resources/material',
            '@pragmatic-tech-ai/fresco',
        ]
    }
}
