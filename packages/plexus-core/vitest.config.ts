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
    // The todl dist nests its subpath barrels under solution-services/, so the generic
    // todl/* alias below (dist/$1) misses ./build-system-core. Map it explicitly to the
    // real nested index so the Build progress enums/types resolve under vitest (the prod
    // exports map already resolves ./build-system-core correctly).
    { find: /^@pragmatic-tech-ai\/todl\/build-system-core$/, replacement: `${TODL}/dist/solution-services/build-system-core/index.js` },
    // Same nesting as build-system-core: the package-manager subpath barrel lives under
    // solution-services/, so the generic todl/* alias (dist/$1) misses it. Map explicitly
    // so the connections tests (file-connection-store / package-engine) resolve it.
    { find: /^@pragmatic-tech-ai\/todl\/package-manager$/, replacement: `${TODL}/dist/solution-services/package-manager/index.js` },
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
            // Task 4 (W3b): ProjectExplorerService projects OpenProjects from
            // SolutionManagerService.ActiveSolution.Members. Verified mural-free
            // transitively (solution.js/solution-manifest.js/solution-session.js/
            // host-services.js/package-manager/manifest.js and, through
            // solution-session's domain/compiler-services imports, down through
            // manifest/reflection + binary-codec — none reach mural).
            `export { SolutionManagerService } from ${p('solution-services/solution-manager/engine/solution-manager-service.js')}`,
            // Task 5 (W3b): the retired project explorer's manageReferences/
            // RefreshProjects (now in the solution-explorer services) import the ProjectType enum (a runtime value) and
            // resolve SolutionBaseResolver.Key directly (for Invalidate) alongside
            // BaseResolverKey. ProjectType lives in the already-shimmed manifest.js
            // (no imports of its own — trivially mural-free). SolutionBaseResolver's
            // full transitive closure (59 files: package-store/publish/compiler-
            // services/project-model-provider/wiki-origin/…) was traced and contains
            // no mural import.
            `export { ProjectType } from ${p('solution-services/package-manager/manifest.js')}`,
            `export { SolutionBaseResolver } from ${p('solution-services/solution-manager/engine/solution-base-resolver.js')}`,
            // Wave 2: every base-resolution consumer resolves the SolutionLanguageService facade
            // (IBaseResolver + StaleMembers signal) instead of the raw resolver.
            `export { SolutionLanguageService } from ${p('solution-services/lsp/host/solution-language-service.js')}`,
            // P2 (solution-hierarchy): the Solution Explorer contributors/capability consume
            // the P1 content store + provider and member status/kind. ProjectContentProvider
            // imports @pragmatic-tech-ai/mural/framework/hierarchy, which the mural dist alias
            // resolves + externalizes (native load, cycle intact) — same as any other mural value.
            `export { Solution } from ${p('solution-services/solution-manager/engine/solution.js')}`,
            // P5b (connections): SolutionConnectionOverrides persists per-project connection
            // choices in solution.json via a `connections` setting bag. SettingBagDefinition
            // imports only a TYPE from mural (SettingDefinition) — mural-free at runtime.
            `export { SettingBagDefinition } from ${p('solution-services/solution-manager/engine/setting-bag-definition.js')}`,
            // P6a (property bags): the scope-based bag subsystem. bag-address (pure enums + class)
            // and record-property-bag (imports only todl-runtime) are both mural-free.
            `export { BagAddress, BagScope, ProjectStore } from ${p('solution-services/property-bags/bag-address.js')}`,
            `export { RecordPropertyBag } from ${p('solution-services/property-bags/record-property-bag.js')}`,
            `export { BagCatalog } from ${p('solution-services/property-bags/bag-catalog.js')}`,
            `export { SolutionBagPersister } from ${p('solution-services/property-bags/solution-bag-persister.js')}`,
            `export { ProjectSharedBagPersister, ProjectLocalBagPersister } from ${p('solution-services/property-bags/project-bag-persisters.js')}`,
            // connection-bag / connection-resolution import mural/framework VALUES (SettingDefinition,
            // SettingKind) — the mural dist alias resolves + externalizes them (native load, cycle intact).
            `export { ConnectionBag, ConnectionBagKind, TokenSource } from ${p('solution-services/property-bags/connection-bag.js')}`,
            `export { ConnectionResolution, ConnectionPurpose, ConnectionSelectionKind } from ${p('solution-services/property-bags/connection-resolution.js')}`,
            `export { ConnectionSelection } from ${p('solution-services/property-bags/connection-selection.js')}`,
            `export { BagMigration } from ${p('solution-services/property-bags/bag-migration.js')}`,
            `export { SolutionMemberStatus } from ${p('solution-services/solution-manager/engine/solution-member-status.js')}`,
            `export { ProjectContentStore } from ${p('solution-services/project-services/content/project-content-store.js')}`,
            `export { ProjectContentNode } from ${p('solution-services/project-services/content/content-node.js')}`,
            `export { ContentNodeKey } from ${p('solution-services/project-services/content/content-node-key.js')}`,
            // The content-change deltas the plexus-core ProjectHierarchyProvider maps onto
            // mural's ChildAdded/Updated/Removed. todl removed its own ProjectContentProvider
            // (W2); plexus-core owns the provider now, over these mural-free store deltas.
            `export { ContentChange, ContentAdded, ContentUpdated, ContentRemoved } from ${p('solution-services/project-services/content/content-change.js')}`,
            // Task 6 (W4): publishProject + the Build contributor consume BuildService (moved
            // into the engine), the composed BuildSystemRegistryKey and parseManifest from the
            // bare barrel. BuildService's closure (TodlProjectBuildManager / InMemoryBuildStorage
            // / ScopeFlatteningStorage / LocalNpmRegistry / already-shimmed SolutionManagerService)
            // is the mural-free core build path — it never reaches the node-only html-bundle /
            // SolutionBuildManager subtree, so it is safe to inline here.
            `export { BuildService } from ${p('solution-services/todl-build-system/build-service.js')}`,
            `export { BuildSystemRegistryKey } from ${p('solution-services/project-services/composition/build-system-registry-key.js')}`,
            `export { parseManifest } from ${p('solution-services/package-manager/manifest.js')}`,
            // Task 9 (SolutionWorkspaceService): the member-keyed mutation UI over the engine ops
            // (todl 0.40.1 exports all of these from its index; the service imports them bare, so the
            // shim must mirror them). MemberProjectOps imports only project-factory.js (already
            // shimmed, mural-free) + semver.js (pure); SemVer/VersionPart (semver.js) have no imports;
            // UniqueName (content/unique-name.js) imports only a todl-runtime IStorage type;
            // MemberContentOps (content/member-content-ops.js) imports only UniqueName; ReferenceEditor
            // (references/reference-editor.js) imports manifest/project-factory/project-events;
            // ProjectLifecycle (solution-manager/engine/project-lifecycle.js) imports the already-
            // shimmed SolutionManagerService + project-events/manifest/project-factory; ProjectEventsKey
            // (generators/project-events.js) imports only ServiceKey from todl-runtime — all mural-free.
            `export { MemberProjectOps } from ${p('solution-services/project-services/core/member-project-ops.js')}`,
            `export { SemVer, VersionPart } from ${p('solution-services/project-services/core/semver.js')}`,
            `export { UniqueName } from ${p('solution-services/project-services/content/unique-name.js')}`,
            `export { ProjectEvents, ProjectEventsKey, ProjectEventKind } from ${p('solution-services/project-services/generators/project-events.js')}`,
            `export { MemberContentOps, RenameError } from ${p('solution-services/project-services/content/member-content-ops.js')}`,
            `export { ReferenceEditor, ReferenceResolutionKind } from ${p('solution-services/project-services/references/reference-editor.js')}`,
            `export { ProjectLifecycle, CreateError, OpenError } from ${p('solution-services/solution-manager/engine/project-lifecycle.js')}`,
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
        server: {
            // Inline the todl dist files the shim re-exports so Vite TRANSFORMS them and applies
            // the mural alias to their bare '@pragmatic-tech-ai/mural/*' imports (otherwise they
            // are externalized and Node resolves those imports to mural's dev condition = src .ts,
            // which Node cannot type-strip). todl dist is compiled JS, so transforming it is safe
            // (unlike mural, whose circular class hierarchy breaks under transform — mural stays
            // externalized via the dist alias).
            deps: { inline: [/[\\/]@pragmatic-tech-ai[\\/]todl[\\/]/] },
        },
    },
})
