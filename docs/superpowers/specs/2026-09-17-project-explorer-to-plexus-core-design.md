# Move Project Explorer to plexus-core (via DI) — Design

**Status:** Draft for review
**Date:** 2026-09-17
**Repo:** Plexus (monorepo: `apps/plexus`, `apps/devUI`, `packages/plexus-core`)
**Canonical home:** GitHub Project #1, Kind=Spec (this file is a working copy for review; to be filed into the Project on approval)

## Goal

Relocate the Project Explorer module — and its private substrate — from
`apps/plexus` into `packages/plexus-core`, so it is a reusable capability shared
across apps (plexus today, devUI/others later). Every place the explorer
currently reaches *up* into an app feature module becomes a **dependency-injected
interface**: the interface is defined in `plexus-core`, the concrete
implementation is registered from `apps/plexus`. `plexus-core` must never import
an `apps/plexus` feature module.

## Non-goals

- No behavioral change to the explorer. Same tree, commands, dialogs, drag/drop,
  rename/delete, publish/version, export, run-agent, references — byte-for-byte
  the same UX.
- Not moving the feature modules themselves (arch, skills, meta-model, library,
  diagram-export, problems). They stay in `apps/plexus` and implement the
  injected interfaces.
- `plexus-core` does **not** take on a `@pragmatic-tech-ai/todl` dependency. It
  keeps `todl-runtime` only. Anything todl-heavy (`WorkspaceBaseResolver`,
  `TodlLanguageClient`, the published-bases backends) stays app-side behind an
  interface.
- No new lambda/"participant bag" abstractions. Injected dependencies are real,
  method-bearing interfaces resolved from the DI container.

## Current state — why the coupling exists

`ProjectExplorerService` is the app's **action hub**: project/file actions
physically live on the tree toolbar and context menus, so the service that owns
the tree must reach the features that perform them. It has ~38 outgoing
app-local imports and ~32 files depend back on it.

The 38 imports sort into four buckets:

1. **Its own substrate** — `project.ts` (Project/ProjectNode), `open-project.ts`,
   `project-factory.ts`, the dialog VMs, stores, helpers. These *are* the module;
   they relocate with it.
2. **Generic infra** — document factory/close-guard, storage-provider-registry,
   diagnostics store, environment, path-utils, confirm-dialog. Backend-neutral;
   relocate to core.
3. **Already-loose feature couplings** — resolved optionally via
   `Provider.get(Key)?` and degraded when absent (`HasExport`, `HasAgentSkills`,
   `NodeCommandContributor`, `NewFileParticipant`). The concrete `import` exists
   only to name the static `.Key` and the return type — never to construct the
   feature. Inversion here is relocating the interface + key, not rewriting logic.
4. **Hard feature couplings** — the only four that call *into* a feature module
   non-optionally: the published-bases backends, the skills/agent-chat
   run-menu, `CodeDocument` `instanceof`, and `isTodlProject`.

The raw count overstates the work: ~30 imports are substrate or token-only
references that relocate mechanically. Real inversion is needed in only the
four hard clusters (plus tidying the already-loose ones into real interfaces).

## Target architecture

```
apps/plexus                         packages/plexus-core
────────────                        ─────────────────────
feature modules (arch, skills,      renderer/modules/project-explorer/
 meta-model, library,                 - project-explorer.module.mu
 diagram-export, problems)            - project-explorer.resources.mu
   │  register concrete impls          - project-explorer-service.ts
   │  of core interfaces             renderer/services/projects/
   ▼                                   - project.ts, open-project.ts
core interfaces (implemented up)       - project-factory.ts (+capability guards)
                                       - dialog VMs, stores, behaviors, helpers
                                     renderer/services/... (relocated infra)
                                     + core interfaces the explorer consumes
```

Dependency direction is strictly `apps/plexus → plexus-core`. The explorer
resolves its feature collaborators through `IServiceProvider` by interface key;
`apps/plexus` registers the implementations at composition time.

## Injected interfaces (defined in core, implemented in app)

Signatures grounded in the current call-sites. Names/shapes are the review-
critical part.

- **`PublishedBases`** — the New-Project pickers' catalog.
  - `listMetaModels(): Promise<BaseRef[]>`
  - `listLibraries(): Promise<BaseRef[]>`
  - Replaces direct `ensureMetaModelsBackend` / `ensureLibrariesBackend` calls.
  - App impl enumerates the meta-model/library storage backends.

- **`LiveValidation`** — whole-project validation lifecycle. ← `TodlLanguageClient`
  - `attachProject(rootPath, name, storage)`
  - `detachProject(storage)`
  - `resyncProject(rootPath, storage)`
  - `refreshBases(storage)`

- **`BaseResolver`** — workspace producer resolution. ← `WorkspaceBaseResolver`
  - `workspaceProducers(kind: ProducerKind): Promise<BaseRef[]>`
  - `producedIdOf(storage): string | undefined`
  - `refreshDependentsOfIds(ids: readonly string[]): Promise<void>`
  - Open question: fold `refreshDependentsOfIds` into `LiveValidation`? (see below)

- **`DiagramTreeExport`** — export a diagram file from the tree, headlessly.
  ← `DiagramExportService` + `DiagramHeadlessRenderer`
  - `export(op: OpenProject, path: string, format: ExportFormat): Promise<void>`
  - The app impl does render + save internally, so core calls one method and
    the two-service split stays app-side.

- **`ProjectMenuSource`** — extra project-header menu items (the "Run Agent /
  Skill" submenu today). ← skills + agent-chat
  - `menuFor(op: OpenProject): Promise<readonly ProjectMenuChoice[]>`
  - `ProjectMenuChoice { Label: string; Command: ICommand }`
  - The app impl owns skill discovery/filtering; core just renders the choices.
  - `OpenProject.AgentSkillChoices` / `HasAgentSkills` generalize to
    `ProjectMenuChoices` / `HasProjectMenu`.

- **`ProblemsDock`** — the errors dock. ← `ProblemsService`
  - `expand(): void`

- **`NodeCommandContributor`** — per-node context action (arch "Edit
  Viewpoints…"). Kept, rewritten as a real interface in core.
  - `contribute(op: OpenProject, node: ProjectNode): { label: string; command: ICommand } | undefined`

- **`NewFileParticipant`** — post-create hook (arch viewpoint picker). Kept,
  rewritten as a real interface in core.
  - `onCreated(op: OpenProject, path: string): Promise<boolean | void>`

## Non-DI cleanups (remove the import outright)

- **`isTodlProject`** → a factory capability guard `supportsScaffold(factory)`
  that checks for `updateScaffold` (already an `IProjectFactory`-side method).
  No feature import.
- **`CodeDocument` `instanceof`** in `FindOpenCodeDocByOsPath` → a duck-typed
  guard `isReloadable(doc): doc is { IsDirty: boolean; Reload(): Promise<void> }`,
  mirroring the existing `isRevealable`. No feature import.

## Move manifest (relocates to plexus-core)

**Module:** `project-explorer.module.mu`, `project-explorer.resources.mu`,
`project-explorer-service.ts`.

**Model & VMs:** `project.ts`, `open-project.ts`, `project-factory.ts`,
`new-item-choice.ts`, `base-binding.ts`, and the dialog VMs
(`new-project-dialog-model`, `open-project-dialog-model`, `set-version-dialog-model`,
`manage-references-dialog-model`, `confirm-dialog-model`).

**Stores & helpers:** `open-projects-store.ts`, `recent-projects-service.ts`,
`semver-bump.ts`, `node-move.ts`, `project-node-icon.ts`, `shorten-path.ts`.

**Behaviors:** `tree-selection-behavior.ts`, `tree-drag-drop-behavior.ts`,
`project-tree-template-behavior.ts`.

**Generic infra:** `document-factory.ts` (`IDocumentFactory`),
`document-close-guard.ts`, `diagnostics/*` (store + `diagnostic.ts`),
`storage-provider-registry.ts`, `environment-service.ts`, `path-utils.ts`.

**Stays in apps/plexus (implements a core interface):** the meta-model/library
backends, `WorkspaceBaseResolver`, `TodlLanguageClient`, `DiagramExportService`
+ `DiagramHeadlessRenderer`, `ProblemsService`, the skills/agent-chat run-menu
wiring, `CodeDocument`, and the arch `NodeCommandContributor` / `NewFileParticipant`
implementations.

*(This split is provisional — see Composition below. A couple of the "generic
infra" files may prove app-coupled on closer inspection and stay app-side behind
an interface instead.)*

## Cross-package DI — plain shared-token DI (no new mechanism)

Each feature module is a **provider** of one or more of the injected capabilities;
the explorer is a consumer that resolves them by token. This is **plain DI on the
existing container** — no demand-driven resolution, no `provides` header, no new
compiler support (an earlier "module dependency resolution" companion was
evaluated and dropped: the container is already eager-register + lazy-instantiate,
so shared tokens + eager composition are all this needs; see
[Composition-Root-Agnostic Compilation](2026-09-17-composition-root-agnostic-compilation-design.md),
"Cut: demand-driven resolution"). Concretely:

- The **token / interface** for each capability (`PublishedBases`,
  `LiveValidation`, `BaseResolver`, `DiagramTreeExport`, `ProjectMenuSource`,
  `ProblemsDock`, plus the `NodeCommandContributor` / `NewFileParticipant`
  contribution points) lives in `plexus-core`.
- Each `apps/plexus` feature module registers its implementation under that token
  (its `.services:` block), and the explorer resolves it with `Provider.get(token)`
  / `getRequired(token)` — exactly the idiom in use today.
- The app's bootstrap already composes both `plexus-core`'s explorer module and
  its own feature modules eagerly (they are listed in its `.modules:` block), so
  every token is registered before use. `plexus-core` never imports `apps/plexus`.
- Optional capabilities (export, project-menu, node-contributor) use
  `get(token) → undefined` and degrade gracefully (`HasExport`, `HasProjectMenu`,
  contributor gating). Required ones use `getRequired`, which already throws a
  clear "no service registered for <token>" error.
- The compiler is **not** on this move's critical path. Making `.modules:` /
  `.services:` composable under a non-`Application` root is a separate, independent
  improvement (the console/service-root direction) — see the companion spec.

## Registration & build

- `plexus-core` gains a `renderer/modules` area and exports the module +
  `ProjectExplorerService` (+ the model, factory interface, and the injected
  interface keys) via new `package.json` `exports` entries.
- `compile:mu` in `plexus-core` must compile the relocated `.mu` (module +
  resources). Its `.mu` imports must resolve to core-resident VMs only.
- `apps/plexus` composition root registers one implementation per injected
  interface under its core key, service-locator style (`ServiceBase` + ctor
  `IServiceProvider`), with real interface types — not callback bags.
- The ~32 reverse-dependency imports of `ProjectExplorerService` repoint from
  the module path to `@pragmatic-tech-ai/plexus-core/...` (`app → core`,
  mechanical).
- Open: whether some "generic infra" files belong in core or stay app-side; the
  exact core export surface (one barrel vs several subpath exports).

## Risks & open questions

- **`.mu` composition in core.** The resources `.mu` imports many VMs; all must
  be core-resident. Any that can't move cleanly forces either a further
  relocation or an interface. This is the highest-risk step; validated by
  `plexus-core`'s `compile:mu` + the `apps/plexus` build.
- **Interface granularity.** `LiveValidation` vs `BaseResolver` overlap on
  `refreshDependentsOfIds`. Merge or keep separate? (Recommend keep separate —
  distinct responsibilities.)
- **`DiagnosticsService` placement.** Generic store → core; but if it entangles
  with app-specific problem shaping, keep app-side behind `DiagnosticsSink`.
- **Reverse-dep churn.** 32 import-path edits; low risk but wide. Mechanical.

## Phasing (detailed plan to follow via writing-plans)

1. Branch; define the core interfaces + keys (additive, nothing breaks).
2. Relocate substrate + module into core; fix intra-move imports.
3. Rewrite the service's feature call-sites to resolve the injected interfaces;
   delete all app-feature imports; apply the two non-DI cleanups.
4. Register concrete impls from `apps/plexus`.
5. Repoint the ~32 reverse-dep imports; wire core `exports` + `compile:mu`.
6. Build + full test suite green (both packages).

## Success criteria

- `plexus-core` has zero imports from `apps/plexus`; still `todl-runtime`-only
  (no `todl`).
- `apps/plexus` builds and all unit/e2e tests pass with the explorer served from
  `plexus-core`.
- Every former hard feature coupling is an injected interface with a real
  app-side implementation; `HasExport`/`HasProjectMenu`/contributor gating still
  degrades gracefully when an impl is absent.
