# Milestone C2 — Plexus Project/Solution Explorer Migration — Design

**Status:** Spec (design-approved in dialogue 2026-10-02). Supersedes the research stub
`2026-10-01-plexus-project-explorer-migration-C2-research.md`, whose six open questions are
answered in the appendix.
**Part of:** Mural hierarchy/command roadmap — Phase 0 → A → B → C1 → **C2**.
**Depends on:** Milestone B (hierarchy consolidation) + Milestone C1 (`Hierarchy { }` DSL +
default `TreeView`, context-driven actions), both published (`@pragmatic-tech-ai/mural@0.60.0`).
**Repos touched:** `todl-runtime`, `todl`, `mural`, `plexus-core`, `apps/plexus`.

## Goal

Complete and enforce the split of Plexus's project/solution explorer into a **UX-free engine**
(in todl's `solution-services` + build systems) and a **pure interaction layer** (SolutionExplorer
in `plexus-core`), migrate it onto the B+C1 mural model, retire the hand-built
`ProjectBranchesProvider`/`LeadingBranch` composite, wire the build system into the solution
hierarchy, and clear every parked leftover from Phase 0 → C1.

## The five ground goals (user, 2026-10-02)

1. Fix the leftovers from C1 and before.
2. Split ProjectExplorer into an **engine** (lifecycle) that lives in todl `solution-services`, and
   a **UX** part that becomes the **SolutionExplorer**.
3. Ensure todl depends on nothing UX — no imports, no calls, no references.
4. Create proper hierarchy definitions (providers, contributors) and migrate the command handlers
   there, giving SolutionExplorer a clean structure.
5. Wire the build-system routines into the solution hierarchy (overlaps goal 4; wires what 4 leaves
   and tests the whole thing end to end).

## Architecture summary

Three strictly ordered layers: **`todl-runtime` → `todl` (engine) → `mural` (UI framework) /
`plexus-core` (UX) → `apps/plexus` (shell)**. A lower layer never depends on a higher one; the only
upward communication is a **signal** the upper layer subscribes to (see the "Layering: the engine
never calls up — it only signals" rule in the global CLAUDE.md). `plexus-core` and `apps/plexus` are
a *pure interaction layer*: they render engine state and translate user gestures into engine API
calls, and contain no functional logic. All functional work — file/reference/connection mutation,
build, publish, base resolution, member lifecycle — lives in the todl engine.

## Global Constraints

- The engine (todl) carries **no** UI specificity: no hierarchy / provider / contributor /
  view-model / control / DP-authoring types, and no import of `@pragmatic-tech-ai/mural/framework`.
  The **single sanctioned exception** is the build-system **bootstrapper** modules (the `.mu.js`
  composition modules + the presentation-bake / `mural-compiler` path).
- UI layers (`plexus-core`, `apps/plexus`) contain no functional logic; they call **down** into the
  engine and refresh from engine **signals**. They never hand the engine a callback or an
  upper-layer type; a DI `ServiceKey` seam is allowed only when its contract is declared at/below the
  resolving layer and is free of upper-layer types.
- This is a **breaking** release chain; version bumps are minor. Each publish (todl-runtime, todl,
  mural if needed, Plexus adoption) is a **human-gated** stop point.
- When code moves into `plexus-core`, its whole dependency closure moves with it (no half-move that
  leaves an upward import); only a dependency genuinely bound to the app shell stays behind a
  host-free DI seam.
- Scope is **solution-services + solution-explorer + build systems**. The same UX-is-pure-translation
  treatment of other subsystems is future work, out of C2.
- House style applies throughout (OOP; Allman; no inline reused literals; `Observable` VMs;
  PascalCase interfaces/public methods; enums over string-literal unions; `IDisposable` teardown).

---

## Section 1 — Layers & relocations

**`plexus-core` owns** every hierarchy, provider, contributor, command handler, and the
**SolutionExplorer** itself; it depends on both mural and todl.

**Out of todl** (to make goal 3 true):
- The `IHierarchyProvider` implementation in `project-content-provider.ts` → becomes
  **`ProjectHierarchyProvider` in plexus-core**. todl keeps the UX-free `ProjectContentStore` /
  `ProjectContentNode` *data* and its `ContentChange` signal; plexus-core adapts it to the mural tree.
- `SettingDefinition` / `SettingKind` → **todl-runtime**, reshaped as `Observable` types; the engine's
  bags and the UI both consume the same observable schema from the shared runtime. (Compiler ripple:
  the markup `.settings:` lowering retargets the new todl-runtime type.)
- `SolutionTreeVM` and `SettingBagGrid` → **dissolved** (not relocated): their behavior is
  re-expressed as providers/contributors + `HierarchyItem`s in the C1 model (see Sections 2–3).
- The `@pragmatic-tech-ai/mural` runtime dependency drops from todl's `package.json`, except the
  build-system bootstrapper modules.

**Into todl** (engine operation bodies, from Plexus's 2147-line `ProjectExplorerService`): file
mutations (new/delete/rename), reference edits, connection *model* edits, and build/publish
orchestration (`PackagePublisher` → an engine `BuildService`). Member-projection logic consolidates
into `SolutionManagerService`; plexus-core keeps only "members/content changed → rebuild the view,"
driven by signals. The connection **editor** UI, prompts, and confirmations stay in plexus-core.

**Guard:** extend `engine-boundary.test.ts` so *no* todl file (not just the engine subdir) imports
`mural/framework`, with only the build bootstrapper allowlisted; assert todl's `package.json` has no
`mural` runtime dep outside the bootstrapper.

## Section 2 — Tree model (provider + virtual-folder contributors)

- **`ProjectHierarchyProvider`** (plexus-core) — one provider per project node; owns the project's
  real **content** subtree; projects todl's `ProjectContentStore` into `HierarchyItem`s; realizes
  lazily / disk-watched via B's `Realize(item, ctx): IDisposable` mutating `Children`, refreshing from
  the engine's `ContentChange` signal. One owner per subtree.
- **Virtual-folder contributors** (plexus-core) — independent peers under the project `Key`, composing
  via B's process-all, ordered solely by `Order`:
  - **References** — a "References" folder + reference children (reads engine reference / base-resolver
    data; refreshes on signal).
  - **Connections** — the active-connection row for a consumer project.
- **Solution node** — the **global Connections root** is a contributor tagged with the solution `Key`;
  solution-level build actions attach here too (Section 4).
- `ProjectBranchesProvider`, `LeadingBranch`, and the per-consumer composite building are **deleted**.
  No cross-branch coupling; ordering is `Order` alone; B's `Integrate` hook is not needed here.
- **Settings** are *not* a tree folder — they are a context-menu command (Section 3).
- **Canonical names** are defined fresh from the new provider/contributor segments; old persisted
  reveal-paths are discarded (clean break).

## Section 3 — Commands, actions, handlers

Actions are C1 `CommandDefinition`s (id/title/icon) tagged with a `Context` interned from a node
`Key`, held per-contributor on `HierarchyContributorDefinition.Actions`. `BuildActions` gathers the
ones whose `Context` matches the selected node's `Key` and dispatches each through its owning
contributor via the per-open routing dispatcher. The pre-B `IHierarchyActionContributor` /
`HierarchyActionDefinition` / `HierarchyActionContributorRegistry` are retired; registration is the
`Hierarchy { }` DSL.

Current action groups migrate to per-contributor `Actions`, tagged by node `Key`:
- **File/folder:** Add New ▸ / New Folder / Import File… / Import Folder… / Rename / Delete →
  file·folder·project Keys.
- **Project:** Remove from Solution / Bump Version ▸ / Set Version… / Manage References… /
  Refresh Bases / Update Agent Metadata / **Settings** → project Key. (Build/Publish come from the
  build contributor, Section 4.)
- **Reference:** Add Meta-model ▸ / Add ▸ / Set Version ▸ / Remove → reference Key.
- **Connection:** New / Edit… / Test / Make Default / Make Solution Default / Remove /
  Active connection ▸ → connection Key.
- **App-side, declarative (stay in app modules via the DSL):** `ArchActionContributor`
  (Edit Viewpoints…), `DiagramExportActionContributor` (Export ▸ SVG/PPTX) → diagram Key.

Handlers are **thin translators**: each contributor is the `ICommandDispatcher` for its actions; a
handler takes the gesture and calls *down* into the matching todl engine operation. The engine does
the work and **emits a signal**; the SolutionExplorer refreshes from it. The handler never mutates
the model and never receives an upward callback. The connection editor launcher, prompts, and
confirmations stay in plexus-core. The **Settings** command opens the settings editor (a plexus-core
view; `SettingBagGrid`'s responsibility re-expressed there).

## Section 4 — Build-system wiring (goal 5)

**Engine (todl):** `BuildSystemRegistry` (in `build-system-core`) lists the registered build systems;
each build system **declares the project type(s) it applies to**. Build and publish become engine
**operations** — `PackagePublisher`'s orchestration moves here as a `BuildService` /
`SolutionBuildManager` facade: `Build(project, system, flavor)`, `Publish(project)`, and solution-wide
`BuildAll` / `PublishAll`. Operations are **async**. The browser-safe vs node-only split is preserved:
the UI touches only the browser-safe engine surface (`TodlProjectBuildManager` on the main barrel);
the node-only `HtmlBundleBuildSystem` stays quarantined behind the `/project-system` subpath.

**UI (plexus-core):** a **single build contributor** that, at per-open `BuildActions` time, **queries
`BuildSystemRegistry`** and contributes Build / Publish (+ any flavor variants as a `Build ▸` submenu)
per applicable system — no availability signal is needed because the menu is rebuilt on every open, so
late-arriving/removed build systems are always reflected. Project-level actions are tagged with the
applicable **project-type `Key`(s)** (type-gating falls out of the Key/Context match); **Build All /
Publish All** are tagged with the **solution `Key`**. Handlers run the async engine operation **as a
`background-work-service` task** (status-bar dock); the engine's existing `Project*` / `Action*` build
events feed the task's progress; results/errors surface there; the tree refreshes from the ordinary
content/state signal afterward.

`background-work-service` **moves into plexus-core** (with its dependency closure) so the handlers use
it directly.

## Section 5 — Engine→UI signal surface

Every engine state change the SolutionExplorer must reflect arrives as a **signal the UI subscribes
to**, never an engine→UI call. The surface is small and reuses existing channels:
- **Content changed** (per project) — `ProjectContentStore`'s existing `ContentChange` deltas;
  `ProjectHierarchyProvider` re-realizes the affected subtree.
- **Members changed** (solution) — `SolutionManagerService` / `Solution` emits on member add/remove/
  status change; the SolutionExplorer rebuilds the project node set.
- **References / connections changed** — the engine emits when a project's references or the
  connection set / active connection change; the References/Connections contributors re-contribute.
- **Base staleness** — `SolutionBaseResolver.StaleMemberIds` (already wired to editor refresh) stays.

Build availability is a per-open registry query; build progress rides `background-work-service` —
neither needs a signal. New signals are added only where a genuine refresh need has no existing
carrier.

## Section 6 — Sequencing, scope, guards, acceptance

**Sequencing (bottom-up, each publish human-gated):**
1. **todl-runtime** — add `SettingDefinition` / `SettingKind` as `Observable`; publish.
2. **todl** — remove `IHierarchyProvider` from `project-content-provider.ts` (keep store + signal),
   move engine operation bodies in, dissolve `SolutionTreeVM` / `SettingBagGrid`, point bags at the
   todl-runtime schema, drop the mural dep (except bootstrapper), extend the boundary guard; publish.
3. **mural** — adopt the new todl-runtime, re-export the schema; fold in the C2 mural leftovers
   (`when(){ Behaviors{} }` host-binding fix; `CanExecute→IsEnabled` menu-item dimming capability);
   publish if needed.
4. **plexus-core** — in **one move**: bump to the new todl + mural; migrate the pre-B→C1 mural API;
   build `ProjectHierarchyProvider` + References/Connections contributors + the build contributor;
   delete `ProjectBranchesProvider` / `LeadingBranch`; convert handlers to thin dispatchers; put
   SolutionExplorer on the default `TreeView` (drop the hand-written `solution-explorer.resources.mu`
   templates + singleton context menu; delete the legacy `project-explorer.resources.mu` + the
   `TreeKeyCommand` path); pull in `background-work-service` + closure.
5. **apps/plexus** — compose, supply host seams, verify boot; wire the main-menu shell chrome +
   `@WindowMenuItems` swap (an A leftover).

**Scope boundary:** solution-services + solution-explorer + build systems only.

**Guards:** `engine-boundary.test.ts` extended to forbid `mural/framework` across all of todl
(bootstrapper allowlisted) + assert no mural runtime dep in todl's `package.json`;
`browser-safe-composition.test.ts` kept/extended.

**e2e acceptance** (against `plexus_test_projects`): open a multi-project solution; content +
References + Connections render; context actions dispatch into the engine; build/publish run via
background-work with progress + error surfacing; drag-drop reorders/moves across nested rows;
reveal-after-reload works on fresh canonical paths.

---

## Debt cleared in C2 (goal 1 — every leftover, grouped by repo)

- **mural:** C1 drag-**source** wiring (stamp the drag payload so drag-drop works end to end) +
  nested-row drop targeting (deep trees); the `when(){ Behaviors{} }` `behaviorHostVar` host-binding
  gap; the A `CanExecute→IsEnabled` menu-item dimming capability; regenerate the stale demo `*.mu.js`
  (Pen `SetterFactory` drift).
- **todl-runtime:** the `ServiceProvider.registerInstance()` stale-cache bug (returns a stale cached
  instance under a previously-resolved token).
- **mural + plexus-core:** B's parked provider-driven **reveal** + canonical-name surface
  (`GetCanonicalName` / `ParseCanonicalName` / `CanAccept`) — wired here against the fresh clean-break
  paths; the keyed-under-keyed grandchild orphan; provider-driven reconciliation on contributor change.
- **apps/plexus:** the A live main-menu shell-chrome wiring + `@WindowMenuItems` swap.
- **Housekeeping:** resolve the working-tree `third_party/Pragmatic Design System/` deletion
  (restore or commit the removal deliberately); gitignore/settle `graphify-out/`, `.graphifyignore`,
  `.gitattributes`.

## Design rulings

- **DR1 — Layering.** `todl-runtime → todl → mural/plexus-core → apps`; engine never calls up, only
  signals (CLAUDE.md rule). Downward calls (UI → engine, awaiting async) are normal.
- **DR2 — Contract stays in mural.** The hierarchy/command contract is UI-specific; todl carries none
  of it. (Rejected: sinking the contract into todl-runtime.)
- **DR3 — UI is pure translation.** plexus-core / apps do nothing functional; all operations in todl.
- **DR4 — Settings schema → todl-runtime as `Observable`.**
- **DR5 — `SolutionTreeVM` / `SettingBagGrid` dissolve** into the Hierarchy model; settings reached via
  a context-menu "Settings" command, not a tree folder.
- **DR6 — Content provider + virtual-folder contributors.** One `ProjectHierarchyProvider` per project
  over todl's store; References/Connections as independent peer contributors; `LeadingBranch` /
  `ProjectBranchesProvider` deleted; no cross-branch coupling.
- **DR7 — C1 actions + thin dispatchers.** Pre-B action API retired; handlers translate to engine ops.
- **DR8 — Build via per-open registry query + background-work.** One build contributor queries
  `BuildSystemRegistry` per open (no availability signal); build/publish async via
  `background-work-service` (moved to plexus-core); type-gated per project-type Key + solution
  Build All / Publish All.
- **DR9 — Signals only, reuse existing channels** (`ContentChange`, members-changed,
  refs/connections-changed, `StaleMemberIds`).
- **DR10 — Clean break on canonical paths.**
- **DR11 — Move-the-closure rule.** Moving code into plexus-core moves its dependency closure; only
  genuinely app-shell-bound leaves stay behind a host-free seam.
- **DR12 — All leftovers cleared in C2** (see Debt cleared).
- **DR13 — Bottom-up, human-gated publish sequence.**
- **DR14 — Boundary guards** enforce DR1–DR2 in CI.

## Review focus (input classes the happy path won't exercise)

1. A build system **registered mid-session** (after first menu open) shows up on the next open; one
   removed disappears — because actions are rebuilt per open.
2. A **project type with no applicable build system** shows no build actions (not an empty/broken
   submenu).
3. **Reveal-after-reload** resolves to the right node on the *fresh* canonical paths; a stale
   pre-C2 persisted path is discarded cleanly, not errored.
4. A **contributor contributing actions-only** to a node owned by a different provider (e.g. a build
   action on a `ProjectHierarchyProvider` node) resolves and dispatches to the right owner.
5. **Drag-drop across nested rows** targets the row under the cursor, not the root ancestor (the C1
   nested-drop leftover), and the drag **source** actually stamps a payload (the C1 drag-source
   leftover).
6. An **external on-disk change** (file added/removed outside the app) refreshes the content subtree
   via the `ContentChange` signal.
7. A **long build/publish** reports progress and terminal success/failure through
   `background-work-service`, and a failure surfaces diagnostics without wedging the tree.

## Appendix — resolution of the research stub's six questions

1. **Provider decomposition** → DR6: each former leading branch is an independent peer contributor
   under the project `Key`, ordered by `Order`; the content tree is the one provider; composite
   deleted.
2. **`Integrate` hook fit** → not needed here; branches are self-contained owners (DR6).
3. **Canonical-name parity** → DR10 clean break; fresh paths, old persisted reveal-state discarded.
4. **`Realize` contract fit** → `ProjectHierarchyProvider.Realize(item, ctx): IDisposable` over the
   disk-watched `ProjectContentStore`, refreshed by the `ContentChange` signal (Section 2/5).
5. **Base-resolution interplay** → the solution-services adoption is done (Waves 1–3);
   `SolutionBaseResolver` + `StaleMemberIds` are reused as-is (Section 5), not reworked.
6. **Version pin / divergence window** → DR13 bottom-up sequence; Plexus does the one-move bump to the
   new todl + mural during the plexus-core step.
