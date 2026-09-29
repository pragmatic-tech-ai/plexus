import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// Unit tests only. mural-framework/.mu integration is verified via typecheck,
// compile:mu, and manual `npm run dev`, not Vitest.
//
// mural's dist loads fine under native Node ESM (its circular imports resolve via
// live bindings), but breaks when Vite TRANSFORMS it ("Class extends undefined").
// mural's package exports also nest import.development → ./src/*.ts, which Vite's
// serve-mode resolver picks (dragging in uncompiled TS). Fix: alias every mural
// subpath to its built dist .js (absolute node_modules path → vitest externalizes
// it → Node imports it natively, no transform, cycle intact) and never touch src.
// Same for todl-runtime (mural re-exports its Observable) and todl (root export).
const CONDITIONS = ['import', 'module', 'browser', 'default']

// Locate a package dir: package-local, app-local, then workspace root.
function pkgRoot(spec: string): string
{
    const hit = [
        new URL(`./node_modules/${spec}`, import.meta.url),
        new URL(`../../node_modules/${spec}`, import.meta.url),
    ].map((u) => fileURLToPath(u)).find(existsSync)
    if (hit === undefined) throw new Error(`cannot locate ${spec} in app or workspace-root node_modules`)
    return hit
}

const MURAL = pkgRoot('@pragmatic-tech-ai/mural')
const TODL = pkgRoot('@pragmatic-tech-ai/todl')
const TODL_RT = pkgRoot('@pragmatic-tech-ai/todl-runtime')

// Subpath regex maps e.g. mural/framework/shell/shell.js → <mural>/dist/framework/
// shell/shell.js and mural/runtime → <mural>/dist/runtime (Vite resolves the dir
// to index.js). Bare-root entries map to dist/index.js.
const ALIASES = [
    { find: /^@pragmatic-tech-ai\/mural$/, replacement: `${MURAL}/dist/index.js` },
    { find: /^@pragmatic-tech-ai\/mural\/(.*)$/, replacement: `${MURAL}/dist/$1` },
    { find: /^@pragmatic-tech-ai\/todl-runtime$/, replacement: `${TODL_RT}/dist/index.js` },
    { find: /^@pragmatic-tech-ai\/todl-runtime\/(.*)$/, replacement: `${TODL_RT}/dist/$1` },
    { find: /^@pragmatic-tech-ai\/todl$/, replacement: `${TODL}/dist/index.js` },
    // todl subpath barrels (the composed-build test driver reaches the build manager
    // through them). Same reason as the root: the packed todl ships no src/, so the
    // `development` export condition would dead-end.
    { find: /^@pragmatic-tech-ai\/todl\/build-system-core$/, replacement: `${TODL}/dist/solution-services/build-system-core/index.js` },
    { find: /^@pragmatic-tech-ai\/todl\/todl-build-system$/, replacement: `${TODL}/dist/solution-services/todl-build-system/index.js` },
    { find: /^@pragmatic-tech-ai\/todl\/package-manager$/, replacement: `${TODL}/dist/solution-services/package-manager/index.js` },
]

export default defineConfig({
    resolve: { conditions: CONDITIONS, alias: ALIASES },
    ssr: { resolve: { conditions: CONDITIONS } },
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
        // Inline fresco AND todl/todl-runtime so Vite TRANSFORMS them and routes
        // their `@pragmatic-tech-ai/mural/*` imports through the dist aliases above
        // → the single root mural dist. Left external, an imported module's mural
        // subpath imports are resolved natively by Node, which (a) can't be
        // redirected by a Vite alias and (b) picks mural's `development` export
        // condition → uncompiled `src/*.ts`, and Node refuses to strip types under
        // node_modules. fresco ships a nested mural 0.45.2; todl@0.33.5 declares a
        // real mural dependency (its solution/* view-models extend mural types).
        // mural itself stays external (transforming it breaks its circular init).
        server: {
            deps: {
                inline: [
                    /@pragmatic-tech-ai\/fresco/,
                    /@pragmatic-tech-ai\/todl(?:-runtime)?/,
                    // plexus-core's renderer code (e.g. StorageProviderRegistryBase)
                    // extends mural values; inline it so Vite routes its mural imports
                    // through the dist aliases instead of Node picking mural's src.
                    /@pragmatic-tech-ai\/plexus-core/,
                    // mural's compiled markup (build/**/*.mu.js) self-imports its own
                    // `@pragmatic-tech-ai/mural/basic|runtime`. Left external, Node
                    // resolves that self-reference with vitest's injected
                    // `--conditions development` → mural's src/*.ts ("Stripping types
                    // is currently unsupported … under node_modules"). Inline the
                    // compiled-markup subtree so Vite routes the self-imports through
                    // the dist aliases; the rest of mural stays external (cycle intact).
                    // The theme barrel (dist/resources/**) is the external ENTRY that
                    // RELATIVELY imports the build markup below; inline it too, or Node
                    // resolves the whole subtree (incl. the .mu.js self-imports) natively
                    // and picks the development condition before Vite ever sees it.
                    /@pragmatic-tech-ai\/mural\/dist\/resources\//,
                    /@pragmatic-tech-ai\/mural\/build\//,
                ],
            },
        },
    },
})
