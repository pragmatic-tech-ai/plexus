import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// Unit tests for plexus-core. mural's dist loads fine under native Node ESM (its
// circular imports resolve via live bindings) but breaks when Vite TRANSFORMS it
// ("Class extends undefined"); its package exports also nest import.development →
// ./src/*.ts, which Vite's serve resolver picks (uncompiled TS). Fix: alias every
// mural (and todl-runtime) subpath to its built dist .js — an absolute
// node_modules path vitest externalizes, so Node imports it natively with the
// cycle intact. Any core test importing a mural value (ServiceBase, ServiceKey,
// …) needs this. See mural_vitest_resolution.
const CONDITIONS = ['import', 'module', 'browser', 'default']

// Locate a package dir: package-local, then hoisted workspace root.
function pkgRoot(spec: string): string {
    const hit = [
        new URL(`./node_modules/${spec}`, import.meta.url),
        new URL(`../../node_modules/${spec}`, import.meta.url),
    ].map((u) => fileURLToPath(u)).find(existsSync)
    if (hit === undefined) throw new Error(`cannot locate ${spec} in package or workspace-root node_modules`)
    return hit
}

const MURAL = pkgRoot('@pragmatic-tech-ai/mural')
const TODL_RT = pkgRoot('@pragmatic-tech-ai/todl-runtime')

const ALIASES = [
    { find: /^@pragmatic-tech-ai\/mural$/, replacement: `${MURAL}/dist/index.js` },
    { find: /^@pragmatic-tech-ai\/mural\/(.*)$/, replacement: `${MURAL}/dist/$1` },
    { find: /^@pragmatic-tech-ai\/todl-runtime$/, replacement: `${TODL_RT}/dist/index.js` },
    { find: /^@pragmatic-tech-ai\/todl-runtime\/(.*)$/, replacement: `${TODL_RT}/dist/$1` },
]

export default defineConfig({
    resolve: { conditions: CONDITIONS, alias: ALIASES },
    ssr: { resolve: { conditions: CONDITIONS } },
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
})
