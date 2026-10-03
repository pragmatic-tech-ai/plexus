// Shared electron-vite RENDERER fragments for a mural app. Each app composes
// these into its own defineConfig so the mural handling stays identical across
// apps without a monolithic shared config. App-specific bits (the todl→dist
// alias, whose path differs per app, and the rollup input) stay in the app.
export class MuralRendererConfig
{
    // resolve.conditions that pin mural to its built dist (drop "development",
    // which points at uncompiled src). As of mural 0.55.14 no shim aliases are
    // needed: mural imports opentype.js's ESM bundle path directly (the one
    // specifier Node and bundlers both treat as real ESM) and no longer imports
    // `node:module` in shipped source, so the compiler runs unchanged in the
    // Chromium renderer.
    public static resolve(): { conditions: string[]; dedupe: string[] }
    {
        return {
            conditions: ['import', 'module', 'browser', 'default'],
            dedupe: MuralRendererConfig.dedupe(),
        };
    }

    // Package names that MUST resolve to a single physical copy in the renderer
    // bundle. mural ships module-level singletons (ThemeManager's theme registry,
    // Application.current) and identity-based registries; two physical copies —
    // which npm installs whenever the workspaces disagree on a version and the
    // newer one cannot hoist to the root — bundle two sets of those singletons.
    // The symptom is a boot crash: the first theme copy registers its schemes
    // keyed by name ("PragmaticDark"), but the shell activates the SECOND copy's
    // scheme class, whose esbuild-deduplicated identity name is "PragmaticDark2",
    // so ThemeManager.ActivateTheme can't find it and the app never mounts. Vite's
    // dedupe (matched by package name, covering every subpath) forces one copy
    // resolved from the app root. fresco rides on mural, and the todl engine
    // packages carry their own identity registries, so pin them all.
    public static dedupe(): string[]
    {
        return [
            '@pragmatic-tech-ai/mural',
            '@pragmatic-tech-ai/fresco',
            '@pragmatic-tech-ai/todl',
            '@pragmatic-tech-ai/todl-runtime',
        ];
    }

    // Specifiers to keep out of Vite's dep pre-bundler. mural must be served as
    // live ESM (not esbuild-optimized): the optimize pass mis-orders mural's
    // theme/scheme modules (Material builds before its dark scheme is ready) so
    // ThemeManager.ActivateTheme fails and the shell renders empty. Vite treats
    // each subpath as its own optimize target, so every mural subpath an app can
    // import must be listed explicitly — the bare specifier alone doesn't cover
    // them. fresco shares mural, so exclude it too. This is the canonical list
    // for BOTH apps; excluding a specifier an app never imports is harmless.
    //
    // The todl engine packages (todl + todl-runtime) are ALSO linked workspace
    // deps whose dist changes underneath the app. Vite's pre-bundler caches an
    // optimized copy in .vite/deps and does NOT invalidate it when a *linked*
    // package's dist is rebuilt, so a newly-added export (e.g. EnvironmentKey)
    // reads as "not provided" until the cache is manually cleared. Excluding them
    // serves their built dist as live ESM — a rebuilt engine dist is picked up on
    // the next dev start with no stale-cache SyntaxError. Each subpath the renderer
    // imports is listed explicitly (Vite optimizes per subpath).
    public static optimizeDepsExclude(): string[]
    {
        return [
            '@pragmatic-tech-ai/mural',
            '@pragmatic-tech-ai/mural/runtime',
            '@pragmatic-tech-ai/mural/basic',
            '@pragmatic-tech-ai/mural/framework',
            '@pragmatic-tech-ai/mural/visual-engine',
            '@pragmatic-tech-ai/mural/tooling',
            '@pragmatic-tech-ai/mural/resources/pragmatic',
            '@pragmatic-tech-ai/fresco',
            '@pragmatic-tech-ai/todl',
            '@pragmatic-tech-ai/todl/domain',
            '@pragmatic-tech-ai/todl-runtime',
        ];
    }
}
