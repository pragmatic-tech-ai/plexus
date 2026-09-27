import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vitest/config'

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
function pkgRoot(spec: string): string
{
    const hit = [
        new URL(`./node_modules/${spec}`, import.meta.url),
        new URL(`../../node_modules/${spec}`, import.meta.url),
    ].map((u) => fileURLToPath(u)).find(existsSync)
    if (hit === undefined) throw new Error(`cannot locate ${spec} in package or workspace-root node_modules`)
    return hit
}

const MURAL = pkgRoot('@pragmatic-tech-ai/mural')
const TODL = pkgRoot('@pragmatic-tech-ai/todl')
const TODL_RT = pkgRoot('@pragmatic-tech-ai/todl-runtime')

const ALIASES = [
    { find: /^@pragmatic-tech-ai\/mural$/, replacement: `${MURAL}/dist/index.js` },
    { find: /^@pragmatic-tech-ai\/mural\/(.*)$/, replacement: `${MURAL}/dist/$1` },
    { find: /^@pragmatic-tech-ai\/todl\/(.*)$/, replacement: `${TODL}/dist/$1` },
    { find: /^@pragmatic-tech-ai\/todl-runtime$/, replacement: `${TODL_RT}/dist/index.js` },
    { find: /^@pragmatic-tech-ai\/todl-runtime\/(.*)$/, replacement: `${TODL_RT}/dist/$1` },
]

// The bare '@pragmatic-tech-ai/todl' entry (its dist/index.js barrel) re-exports
// MuralHost (./application/mural-host.js), which bare-imports
// '@pragmatic-tech-ai/mural' itself. vitest ALWAYS forces Node's `development`
// condition on for every test run (visible in the worker's real --conditions
// execArgv, independent of the `conditions` option above), so once that nested
// bare import reaches Node's real ESM resolver — which it does, because mural's
// dist is deliberately left externalized/natively-loaded (see the comment above)
// — it picks mural's package.json `import.development` branch (an unbuilt .ts
// under node_modules), which Node refuses to type-strip. Forcing the whole graph
// through Vite instead (ssr.noExternal) dodges THAT crash but reintroduces the
// original one (mural's circular class hierarchy breaks when Vite transforms it).
// Neither knob resolves both at once, so: alias the bare barrel specifier to a
// virtual module that re-exports only the solution-services / project-services
// surface plexus-core actually consumes from todl, bypassing the application/*
// subtree (and its mural import) entirely. Real (non-test) builds still resolve
// '@pragmatic-tech-ai/todl' via its real package.json/exports — this only affects
// vitest's module graph.
const TODL_SHIM_ID = '\0todl-shim'
const todlShimPlugin: Plugin = {
    name: 'todl-shim',
    enforce: 'pre',
    resolveId(id)
    {
        return id === '@pragmatic-tech-ai/todl' ? TODL_SHIM_ID : null
    },
    load(id)
    {
        if (id !== TODL_SHIM_ID) return null
        const p = (rel: string): string => JSON.stringify(`${TODL}/dist/${rel}`)
        return [
            `export { SolutionMember } from ${p('solution-services/solution-manager/engine/solution-member.js')}`,
            `export { SolutionPath } from ${p('solution-services/solution-manager/engine/solution-member-ref.js')}`,
            `export { Project, ProjectNode, ProjectNodeKind } from ${p('solution-services/project-services/core/project.js')}`,
            `export { ProjectFactoryRegistryKey } from ${p('solution-services/solution-manager/engine/host-services.js')}`,
            `export { PROJECT_MANIFEST_FILENAME, ProducerKind, isPublishable, isVersioned } from ${p('solution-services/project-services/core/project-factory.js')}`,
        ].join('\n')
    },
}

export default defineConfig({
    resolve: { conditions: CONDITIONS, alias: ALIASES },
    ssr: { resolve: { conditions: CONDITIONS, alias: ALIASES } },
    plugins: [todlShimPlugin],
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
})
