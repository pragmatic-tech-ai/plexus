# C2 Wave 4 — Plexus SolutionExplorer migration to mural B+C1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. This wave contains an ATOMIC big-bang migration (Tasks 3–7) where the repo does NOT compile until the whole migration lands — see the "Big-bang gate" ruling in Global Constraints. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Adopt todl 0.39.0 + mural 0.61.0 + todl-runtime 0.7.0 in Plexus; migrate the SolutionExplorer off the retired pre-B hierarchy API onto mural's `Hierarchy { }` + default `TreeView` + context-driven `CommandDefinition` actions; rebuild the content provider (todl removed it); retire `ProjectBranchesProvider`/`LeadingBranch`; relocate `background-work-service` into plexus-core; wire per-project Build/Publish through the engine `BuildService` + background-work; delete the legacy templates/behaviors/`PackagePublisher`. End state: plexus-core + apps/plexus compile and their suites are green.

**Architecture:** plexus-core/apps-plexus are a pure interaction layer. The SolutionExplorer is already a mural-hierarchy consumer, but on the pre-B API (`HierarchyModel`/`HierarchyTreeVM`/`HierarchyItemVM`/pre-B `IHierarchyProvider`/`IHierarchyActionContributor`), all REMOVED in mural B. Bumping mural (and todl, which removed `ProjectContentProvider` that `FileTreeContributor` mounts) breaks the whole subsystem at once — this is an atomic rewrite to: `Hierarchy`, `HierarchyItem`, `IHierarchyProvider.Realize(item,ctx):IDisposable`, `IHierarchyContributor extends ICommandDispatcher`, actions as `CommandDefinition`s tagged `Context=HierarchyContext.For(key)` on `HierarchyContributorDefinition.Actions`, dispatched via contributor `Resolve`, and the default `@HierarchyTreeView` + 4-behavior bundle.

**Tech Stack:** TypeScript (ESM), vitest (plexus-core + apps/plexus), mural `.mu` compiler, electron-vite (app). Plexus is an npm **workspace**; `@pragmatic-tech-ai` resolves to **GitHub Packages** (PACKAGES_TOKEN set); todl/mural/todl-runtime are real hoisted installs (NOT symlinks), so the dep bump is `package.json` edits + `npm install`.

**Spec:** `Plexus/docs/superpowers/specs/2026-10-02-plexus-project-explorer-migration-design.md` (Sections 1–6; DR3/DR6/DR7/DR8/DR9/DR10/DR11; Review focus; e2e acceptance).

**Full recon (READ FIRST, exhaustive interfaces + file inventory + deltas):** `C:/Users/Eugene/AppData/Local/Temp/claude/c--Users-Eugene-Projects-architecture-agent/fc2a7aaf-deac-4535-ac5a-6165bbbac515/scratchpad/C2-wave4-recon.md` — Cluster A (current explorer), Cluster B (mural target interfaces + the pre-B→B+C1 delta table + the full Plexus file list), Cluster C (bg-work move, BuildService, signals, package/test setup). Every task below assumes the executor has read the relevant digest section; it carries the exact signatures.

## Global Constraints

- **Branch:** all Wave 4 (and Wave 5) work on ONE branch `c2-plexus-explorer`. Plexus merges to its main at the very end (no inter-wave publish — one repo).
- **Dep adoption:** bump `@pragmatic-tech-ai/todl ^0.39.0`, `@pragmatic-tech-ai/mural ^0.61.0`, `@pragmatic-tech-ai/todl-runtime ^0.7.0` in BOTH `packages/plexus-core/package.json` and `apps/plexus/package.json` (deps AND devDeps), then `npm install` from the Plexus root. `npm install` preserves workspace symlinks (plexus/plexus-core/devui) and fetches the real deps from GitHub Packages. Confirm installed versions after.
- **vitest `todl-shim`:** `packages/plexus-core/vitest.config.ts` (and apps/plexus, devUI) has a `todl-shim` virtual module re-exporting only the mural-free todl surface plexus-core imports. When plexus-core imports `BuildService`/`IBuildProgress`/`BuildSystemRegistryKey`/`BuildPublishOutcome`, EXTEND the shim's re-export list (and verify each is mural-free transitively) or vitest won't resolve them.
- **Big-bang gate (RULING):** Tasks 3–7 are a single atomic migration; the repo will NOT typecheck/compile between them. The normal per-task "green suite" gate is therefore REPLACED for Tasks 3–6 by: "the files this task owns are migrated to the new API and introduce no NEW error category; `tsc --noEmit` total error count is strictly lower than before the task (or the remaining errors are only in not-yet-migrated files)." Task 7 is the integration gate: `tsc --noEmit` is CLEAN across plexus-core + apps/plexus. Task 8 is the test gate: vitest green. Record tsc error counts in the ledger per task. A task reviewer for Tasks 3–6 reviews API-correctness against the delta table, not suite-green.
- **Build scope (RULING):** the build contributor ships **per-project Build + Publish** via the browser-safe engine `BuildService` (main barrel). Solution-node **Build All / Publish All is DEFERRED** — `SolutionBuildManager` is node-only (only on the esbuild-tainted `./todl-build-system` subpath) and cannot be imported into the renderer; a browser-safe `BuildService.BuildAll/PublishAll` is a future todl point-release. Tag project-level build actions with the applicable project-type `Key`(s).
- **Signals:** reuse the existing engine signals (ContentChange, Members, Member.Status, ActiveSolution, StaleMemberIds) and the Plexus view-seams (OnReferencesViewChanged/OnConnectionsViewChanged). No new engine signal.
- **Clean break on canonical paths (DR10):** fresh canonical names from the new provider/contributor segments; discard old persisted reveal-state (don't error on a stale path).
- **House style:** OOP; Allman; no inline reused literals; PascalCase interfaces/public methods; `Observable` VMs; enums over string-unions; `IDisposable` teardown. `.mu.js` generated files keep generator style.
- **What STAYS:** `ProjectExplorerService` survives as lifecycle + mutation back-end (`IContentMutations`) + dialogs; the connection editor launcher, prompts, confirm dialogs stay in plexus-core/apps as thin UI.

## Review Focus

1. **A build system registered mid-session** appears on the next menu open (per-open `BuildSystemRegistry.For(project)` query) — build contributor Task 6.
2. **A project type with no applicable build system** shows no build actions — Task 6.
3. **Reveal-after-reload** resolves on fresh canonical paths; a stale pre-C2 path is discarded, not errored — Task 5 reveal wiring.
4. **A contributor contributing actions-only to a node owned by a different provider** (build action on a content node) resolves to the right owner via the routing dispatcher — Task 6.
5. **Drag-drop across nested rows** targets the row under the cursor + the source stamps a payload (now via mural's default Drag/Drop behaviors) — Task 5 template + Task 3/5 CanDrop/Drop wiring.
6. **External on-disk change** refreshes the content subtree via the `ContentChange` signal — Task 3 ProjectHierarchyProvider.
7. **A long publish** reports progress + terminal success/failure via background-work and surfaces a failure without wedging the tree — Task 6.

---

### Task 1: Relocate `background-work-service` into plexus-core (independent, green)

**Files:** move the entire `apps/plexus/src/renderer/src/modules/background-work/` module into `packages/plexus-core/src/renderer/modules/background-work/` (services/ + `background-work.module.mu`(+.mu.js) + `background-work.resources.mu`(+.mu.js) + services/tests/). Update consumer import paths: `apps/plexus/src/renderer/src/app.mu`, `apps/plexus/src/renderer/src/main.js` (~line 28, ~140), `apps/plexus/src/renderer/src/modules/agent-chat/services/chat-sessions-service.ts` (lines 20-21, ~305), and the module/resources `.mu` self-imports. (The closure is mural-only + local — fully portable; see recon Cluster C.)

**Interfaces:** Produces `BackgroundWorkService` + `BackgroundWorkServiceKey` + `TaskKind`/`BackgroundTask`/`ITaskContext`/`ITaskExecutor` + `TaskHandle` + `InlineExecutor` + `TaskOutputDocument` exported from plexus-core (add to plexus-core's barrel/exports as appropriate). Consumed by the app (status-bar module/resources) and — new in Task 6 — by plexus-core's publish handler.

- [ ] **Step 1:** Move the module directory into plexus-core (preserve file contents; `git mv` where possible). Decide the plexus-core export surface (a `modules/background-work/index.ts` or add to the package's public exports) consistent with how plexus-core exposes other modules.
- [ ] **Step 2:** Repoint every consumer import (listed above) from the old app path to the plexus-core path (`@pragmatic-tech-ai/plexus-core/...` or the workspace import style the app uses for other plexus-core modules — match existing usage). Repoint the `.module.mu`/`.resources.mu` self-imports.
- [ ] **Step 3:** Move the services/tests with the module; fix their relative imports. (Leave the e2e `apps/plexus/e2e/background-work.spec.ts` where it is but repoint any import.)
- [ ] **Step 4:** Verify ON CURRENT DEPS (this task precedes the dep bump): `npm run -w @pragmatic-tech-ai/plexus-core typecheck` and the app typecheck both clean; `npm run -w @pragmatic-tech-ai/plexus-core test` runs the moved bg-work tests green; app vitest still green. Commit: `refactor(plexus): relocate background-work-service into plexus-core`.

(If moving the `.module.mu` StatusBar registration is awkward before the app-compose wave, the service+executors+handle+tests may move now and the `.module.mu`/`.resources.mu` + status-bar registration stay in the app with repointed imports — RULE and ledger whichever keeps both packages green. The service itself MUST be in plexus-core so Task 6's handler uses it directly.)

---

### Task 2: Adopt new deps + extend vitest shim + drop the action registry (the "break it" task)

**Files:** `packages/plexus-core/package.json`, `apps/plexus/package.json`, the three `vitest.config.ts`, `apps/plexus/src/renderer/src/app.mu` (remove `HierarchyActionContributorRegistry` import + root registration ~line 54, 269-273).

- [ ] **Step 1:** Bump the three dep ranges (deps + devDeps) in both package.jsons to `todl ^0.39.0`, `mural ^0.61.0`, `todl-runtime ^0.7.0`. From the Plexus root run `npm install`. Confirm: `node -p "require('./node_modules/@pragmatic-tech-ai/mural/package.json').version"` → 0.61.0, todl → 0.39.0, todl-runtime → 0.7.0. (Workspace symlinks for plexus/plexus-core/devui must remain.)
- [ ] **Step 2:** Extend the `todl-shim` in `packages/plexus-core/vitest.config.ts` (and apps/plexus, devUI if they have the shim) to re-export `BuildService`, `BuildPublishOutcome`, and from `@pragmatic-tech-ai/todl/build-system-core` the `IBuildProgress`/`NoOpBuildProgress` + `BuildSystemRegistryKey` surface plexus-core will import — verifying each is mural-free transitively (BuildService is browser-safe on the main barrel). Also add `InMemoryBuildStorage` only if plexus-core references it (it should not after Task 6 — the engine owns it).
- [ ] **Step 3:** In `app.mu`, remove the `HierarchyActionContributorRegistry` import and its root `.services:` registration (merged into `HierarchyContributorRegistry` in 0.61.0).
- [ ] **Step 4 (gate — NOT green):** `tsc --noEmit` for plexus-core + apps/plexus now reports MANY errors (the whole pre-B hierarchy surface). Capture the error COUNT and the set of files (should be exactly the solution-explorer providers/contributors/service/templates + the app action contributors + anything importing `ProjectContentProvider`). Record this baseline in the ledger as the Task 3–7 work list. Commit: `chore(plexus): adopt todl 0.39.0 + mural 0.61.0 + todl-runtime 0.7.0 (migration in progress)`. Expected: errors are confined to the hierarchy subsystem + ProjectContentProvider importers; if errors appear in UNRELATED modules (e.g. the diagram module's `ICommandTarget`), note them — they are in-scope deltas to fix in Task 7.

---

### Task 3: Rebuild the content provider + migrate the data providers to `Realize`

**Files:** Create `packages/plexus-core/src/renderer/modules/solution-explorer/services/project-hierarchy-provider.ts` (`ProjectHierarchyProvider` — the content provider, rebuilt from todl's removed `ProjectContentProvider`, over the kept `ProjectContentStore` + `ContentChange`). Rewrite `references-provider.ts` and `connections-provider.ts` to the new `IHierarchyProvider`. Update `file-tree-contributor.ts` to mount `ProjectHierarchyProvider`. (Delete `project-branches-provider.ts`, `references-leading-branch.ts`, `active-connection-leading-branch.ts` in Task 5 when the composite is retired — OR here if cleaner; ledger the choice.)

**Interfaces (from recon Cluster B):** implement `IHierarchyProvider { ProviderId; Realize(item, ctx: IRealizeContext): IDisposable; Integrate(item, contributions); GetCanonicalName(item): string; ParseCanonicalName(name): HierarchyItem | undefined; CanAccept(target, drop): boolean }`. Providers push children via `ctx.NewItem(key, init)` + `ctx.InsertChild/RemoveChild`, and return an `IDisposable` that tears down their watch (e.g. the `ProjectContentStore.ObserveChildren` subscription for the content provider; the `OnReferencesViewChanged`/`OnConnectionsViewChanged` seam subscription for refs/conns). Canonical names are item-based now (fresh segments; DR10).

- [ ] **Step 1:** Read the removed todl `ProjectContentProvider` (via `git show v0.38.9:... ` in the TODL repo, or the design doc) for the content→HierarchyItem projection it did, and `ProjectContentStore`'s `ObserveChildren(folder, sink)` API. Build `ProjectHierarchyProvider.Realize(item, ctx)` to populate the item's children from the store and subscribe to `ContentChange` (ContentAdded→`ctx.NewItem`+`InsertChild`, ContentRemoved→`RemoveChild`, ContentUpdated→mutate the existing child's `Caption`/`IconKey`), returning the subscription as its `IDisposable`.
- [ ] **Step 2:** Rewrite `references-provider.ts` from the pre-B `ObserveChildren`/`GetProperty`/`HierarchyItemId`/`ChildAdded` model to `Realize(item,ctx):IDisposable` reading `IReferenceView` (`MemberReferencesView` → Meta-models/Libraries groups → leaves), refreshing on `OnReferencesViewChanged` + `StaleMemberIds`. Item-based `GetCanonicalName`/`ParseCanonicalName` (`references/meta-models/<id>@<ver>` fresh).
- [ ] **Step 3:** Rewrite `connections-provider.ts` similarly over `IConnectionView` (`ConnectionLeafView` → leaves), refresh on `OnConnectionsViewChanged`. Canonical `connections/<id>`.
- [ ] **Step 4:** Point `file-tree-contributor.ts`'s content mount at `ProjectHierarchyProvider` (was todl `ProjectContentProvider`); it returns a `ProviderContribution(new ProjectHierarchyProvider(store, ...))`. Contributor `Contribute(parent: HierarchyItem)`.
- [ ] **Step 5 (gate):** `tsc --noEmit` error count drops (these files clean against the new provider API); residual errors only in the not-yet-migrated service/contributors/templates. Ledger the count. Commit.

Note to implementer: this is the heaviest API rewrite. Follow the delta table in recon Cluster B exactly. A per-file unit test (vitest) for `ProjectHierarchyProvider.Realize` (store delta → child insert/remove/update) is valuable and testable in isolation even before the service migrates — add it.

---

### Task 4: Convert action contributors to `CommandDefinition` + `Resolve`

**Files:** plexus-core: `project-actions-contributor.ts`, `reference-actions-contributor.ts`, `connection-actions-contributor.ts`, and `file-tree-contributor.ts`'s action half. App: `apps/plexus/.../architecture-projects/services/arch-action-contributor.ts`, `.../skills/services/skill-action-contributor.ts`, `.../diagram-export/services/diagram-export-action-contributor.ts`, and their `.module.mu` files (`.hierarchyActions:` → a `Hierarchy { Contributor { CommandDefinition } }` block or `.hierarchyContributors:` with `Actions`).

**Interfaces:** each contributor `implements IHierarchyContributor extends ICommandDispatcher` — add `Resolve(commandId, context): ICommand | undefined` returning a `RelayCommand` closing over `(context as HierarchyActionContext).Anchor`/`.Selection`. Actions become `CommandDefinition`s with `Context = HierarchyContext.For("<nodeKey>")` (or DSL `Context = "<nodeKey>"`), held on `HierarchyContributorDefinition.Actions` (declared in the module `Hierarchy { }` block). Dynamic/async submenus (skills, Add-New formats, export formats, bump-version, set-version) use `CommandDefinition.ChildrenContributor` (lazy `ICommandContributor`) instead of the pre-B `HierarchyAction.Children.Add` mutation. Drop `IHierarchyActionContributor`/`HierarchyAction`/`ActionsFor`/`HierarchyActionDefinition`/`.hierarchyActions:`.

- [ ] **Step 1:** Map each old `ActionsFor(ctx)` action tree to `CommandDefinition`s (Id/Title/Icon/Context/Order/SeparatorBefore + nested Children or ChildrenContributor) + the `Resolve` switch that produces the `ICommand` for each Id (routing to the same `IContentMutations`/`IReferenceView`/`IConnectionView`/engine calls as before). Preserve producer/version gating via each command's `CanExecute` (the resolved `ICommand`).
- [ ] **Step 2:** For each module, author the `Hierarchy { Contributor [Under="<key>", Use=<Contributor>, Order=N] { CommandDefinition [...] } }` block (plexus-core's `solution-explorer.module.mu`; the app modules' own `.module.mu`). Remove `.hierarchyActions:` + `HierarchyActionDefinition`.
- [ ] **Step 3 (gate):** `tsc --noEmit` error count drops for these files. Ledger. Commit.

Note: the four plexus-core contributors were registered imperatively via `RegisterInstance` in `rebuild()`; moving them to the DSL `Hierarchy { }` block is the C1 way, but if a contributor needs runtime-resolved collaborators, `RegisterInstance(contributor, actions?)` (now returns `IDisposable`) is still available — ledger which registration path each uses.

---

### Task 5: Migrate `SolutionExplorerService` + templates + retire the composite/legacy

**Files:** `solution-explorer-service.ts` (HierarchyModel/HierarchyTreeVM → `Hierarchy`; `HierarchyHost` new shape; drop `ActionsFor`; expose `Hierarchy` property + `Host`; `RegisterInstance` disposers → `IDisposable`); `solution-tree-state-service.ts` (reveal via `Hierarchy.Reveal(canonicalName)` + item-based canonical names; clean break on stale paths); `solution-explorer.resources.mu` (reshape to `TreeView [ DataContext=$service(SolutionExplorerService), Style=@HierarchyTreeView ] { .Behaviors:{ HierarchyTreeBehavior HierarchyContextMenuBehavior HierarchyDropBehavior[Host=$Hierarchy.Host] HierarchyDragBehavior } .ItemsSource: $Hierarchy.Roots }`, default `@HierarchyItemTemplate`, delete the `HierarchyAction`/`ContextActions`/custom-item templates); `solution-explorer.module.mu` (the `Hierarchy { }` contributor block from Task 4). DELETE: `project-branches-provider.ts`, `references-leading-branch.ts`, `active-connection-leading-branch.ts`, the four `behaviors/hierarchy-*-behavior.ts`, and the legacy `project-explorer/project-explorer.resources.mu` tree template + `TreeKeyStyle` + the `TreeKeyCommand` path in `project-explorer-service.ts` (keep the dialog templates — move them to a surviving resources file if the legacy `.resources.mu` is deleted wholesale; `app.mu` still merges the dialogs). ProjectsListingContributor + ConnectionsRootContributor gain `Resolve` (even if no-op) to satisfy `IHierarchyContributor`.

**Interfaces:** `SolutionExplorerService implements HierarchyHost { Activate; CommitRename; OnItemRemoved; Delete; CanDrop; Drop }` (NO `ActionsFor`). Builds `new Hierarchy(contributorRegistry, this, { Services })`, `SeedRoot(NodeKey.Solution, init)`, exposes `get Hierarchy()` + (via `Hierarchy.Host`) for the template bindings. References/Connections are now INDEPENDENT peer contributors under the project/solution Key (no `ProjectBranchesProvider` composite).

- [ ] **Step 1:** Migrate the service's hierarchy construction + `HierarchyHost` impl. Delete the composite + leading branches; register References/Connections as peer contributors (DSL or `RegisterInstance`). Wire the key-Delete (no default behavior exists) — either keep a minimal key behavior or a Delete `CommandDefinition`; ledger the choice.
- [ ] **Step 2:** Reshape `solution-explorer.resources.mu` to the default TreeView + 4-behavior bundle + default item template; delete the custom behaviors + action/context-menu templates.
- [ ] **Step 3:** Migrate `solution-tree-state-service.ts` reveal to `Hierarchy.Reveal` + item-based canonical names; discard stale persisted paths gracefully.
- [ ] **Step 4:** Delete the legacy project-explorer template + TreeKeyCommand path; preserve the dialog templates (relocate if needed); keep `ProjectExplorerService` as the mutation/dialog back-end.
- [ ] **Step 5 (gate):** `tsc --noEmit` error count drops sharply (service + templates now on new API). Ledger. Commit.

---

### Task 6: Build contributor + redirect publish through `BuildService` + background-work

**Files:** Create `packages/plexus-core/src/renderer/modules/solution-explorer/services/build-contributor.ts` (a single contributor tagged with project-type Key(s); at `BuildActions` time queries `BuildSystemRegistry.For(project)` and contributes Build / Publish (+ flavor variants as `Build ▸` via `ChildrenContributor`) per applicable system). Modify `project-explorer-service.ts` `publishProject` to run `BuildService.Publish(storage, progress)` as a `background-work` task (TaskKind.Publish) with an `IBuildProgress`→`TaskHandle` adapter; delete `packages/plexus-core/src/renderer/projects/package-publisher.ts` + `in-memory-build-storage.ts` + `scope-flattening-storage.ts`.

**Interfaces (recon Cluster C):** `BuildService` (`BuildService.Key`; `Build(project, buildSystemId, flavorId?, progress?)`, `Publish(project, progress?): Promise<BuildPublishOutcome>`, `static FormatErrors`). `BuildSystemRegistryKey` → `registry.For(project): IBuildSystem[]` (each `Id`/`DisplayName`/`AppliesTo`/`Flavors()`). `IBuildProgress` (SolutionStarted/ProjectStarted/ActionStarted/ActionFinished/ProjectFinished/Diagnostic). `BackgroundWorkService.submit({ kind: TaskKind.Publish, title, payload })` / `run(title, fn)` → `{ handle, done }`; adapt `IBuildProgress` callbacks to `handle.report(fraction, note)` / `handle.log`.

- [ ] **Step 1:** Write an `IBuildProgress` adapter that maps engine build events to a `TaskHandle` (report/log/terminal status). (A unit test for the adapter is testable in isolation.)
- [ ] **Step 2:** Rewrite `publishProject` to resolve `BuildService.Key` + `BackgroundWorkService.Key`, submit a Publish task whose job calls `BuildService.Publish(op.Storage, adapter)`, surface `FormatErrors(outcome.Diagnostics)` on failure via the task + Problems dock, and refresh the tree from the ordinary content/state signal afterward. Delete `PackagePublisher` + the two storage helpers; the `op.PublishCommand` (canExecute `isVersioned`) now routes here.
- [ ] **Step 3:** Build the build contributor: `implements IHierarchyContributor extends ICommandDispatcher`, tagged project-type Key; its `Resolve` runs `BuildService.Build`/`Publish` via background-work; it contributes a `CommandDefinition` per applicable system queried from `BuildSystemRegistry.For(project)` at open (no availability signal — menu rebuilt per open). Flavor variants as a `Build ▸` submenu via `ChildrenContributor`. (Solution-node Build All/Publish All DEFERRED per Global Constraints.)
- [ ] **Step 4 (gate):** `tsc --noEmit` error count drops; this file-group clean. Ledger. Commit.

---

### Task 7: Integration — `tsc --noEmit` clean across plexus-core + apps/plexus

- [ ] **Step 1:** Run `npm run -w @pragmatic-tech-ai/plexus-core typecheck` and the app typechecks (`typecheck:node` + `typecheck:web`). Fix every residual error: cross-file interface mismatches from the migration, any unrelated-but-in-scope delta the dep bump exposed (e.g. the diagram module's `ICommandTarget`→`Resolve` if present, `NodeKey`/icon-converter overlaps). Each fix is a minimal, API-correct change per the delta table.
- [ ] **Step 2:** Run `compile:mu` for plexus-core + apps/plexus (the `.mu` → `.mu.js` compile) and fix any markup errors (the reshaped templates, the `Hierarchy { }` blocks, the removed registry).
- [ ] **Step 3 (gate):** `tsc --noEmit` is CLEAN (0 errors) across plexus-core + apps/plexus; `compile:mu` clean. Ledger the final count (0). Commit.

---

### Task 8: Tests green + e2e acceptance

- [ ] **Step 1:** Run `npm run -w @pragmatic-tech-ai/plexus-core test` (vitest). Migrate/rewrite the ~18 solution-explorer test files to the new API (providers assert via `Realize`+`ctx` and `HierarchyItem`; action contributors assert `Resolve` returns the right `ICommand`; the service asserts `Hierarchy`/`HierarchyHost`). Delete tests for deleted types (project-branches-provider, leading-branches, the 4 behaviors, PackagePublisher). Each behavior-changing fix is TDD (watch it fail against the new API, make it pass).
- [ ] **Step 2:** Run the apps/plexus vitest (incl. the app solution-explorer-service test + the moved bg-work tests + chat-sessions). Fix.
- [ ] **Step 3:** Run the full workspace (`npm test` at root). Confirm green (modulo any documented pre-existing unrelated failures — ledger them).
- [ ] **Step 4 (acceptance, best-effort):** against `plexus_test_projects`, sanity-check (via a vitest integration test or the e2e harness if feasible headless) the Review Focus behaviors: content+References+Connections render; a context action dispatches into the engine; publish runs via background-work with progress+error surfacing; reveal resolves on fresh canonical paths. Where full e2e isn't feasible autonomously, cover the behavior with a plexus-core integration test and ledger what was/wasn't exercised.
- [ ] **Step 5 (gate):** vitest green across plexus-core + apps/plexus. Commit.

---

## Done when

plexus-core + apps/plexus typecheck clean, `compile:mu` clean, vitest green; the SolutionExplorer runs on the default `@HierarchyTreeView` with the 4-behavior bundle; content/References/Connections render via the new providers/contributors; per-project Build/Publish run through `BuildService` + background-work; `ProjectBranchesProvider`/`LeadingBranch`/`PackagePublisher`/legacy templates/behaviors are deleted; `background-work-service` lives in plexus-core. Then Wave 5 (app-shell compose + main-menu chrome + housekeeping) on the same branch, then finishing-a-development-branch (merge Plexus to main). Deferred (ledger): solution-node Build All/Publish All (node-only SolutionBuildManager).
