# devUI Solution/Project Explorer Adoption — Design Spec

**Status:** Draft for review
**Date:** 2026-10-01
**Author:** native session (Claude Opus 4.8) + Eugene
**Related:** [[project_solution_hierarchy_design]] P6 leftovers; supersedes the P6a §10 leftover
(devUI solution-studio connection UI on the legacy `solution-connection` bag).

## 1. Purpose & Intent

Retire the legacy plexus-core `solution-studio` presentation module and move **apps/devUI**
onto the same modern solution stack apps/plexus uses: `TodlProjectSystemModule` +
`ProjectExplorerModule` + `ConnectionsModule` + the new `SolutionExplorerModule`, with
connections resolved through the P6a **bag catalog** rather than the old single-combo
`solution-connection` bag.

**Why:** this is the last P6 leftover. devUI is the only remaining consumer of the old
`solution-studio` panel, which still reads the legacy connection bag; keeping it alive splits
the codebase across two solution UIs and blocks deleting dead plexus-core code.

**Success criteria:**
- devUI's solution/project experience is the same as apps/plexus's explorer (member projects,
  file trees, References/Connections branches, mutations), hosted in devUI's shell.
- devUI connections flow through the P6a catalog (`ConnectionEditingService` +
  `ConnectionResolution`), never the legacy `CONNECTION_BAG_ID` bag.
- The `solution-studio` presentation code (old service, commands VM, workspace-host seam,
  connection-bag/fields/labels + their tests) is deleted; only the reusable seams survive.
- apps/plexus is behaviorally unchanged.
- devUI's own **Registry Connections manager** rail (its registry/publish tool) is unchanged.
- Typecheck (newly wired for devUI), vitest unit, and playwright smoke are green.

## 2. Decisions (settled)

These were decided in brainstorming and are binding for this spec:

1. **Full match, not a subset.** devUI adopts the whole modern explorer experience, not a
   trimmed one.
2. **Project system = `TodlProjectSystemModule`.** devUI replaces its single
   `TodlPackageProjectFactory` registration with the full project system from
   `@pragmatic-tech-ai/todl` (built-in project types + build/generator registries), exactly
   as apps/plexus does.
3. **Drop Home + Compose.** devUI's Home welcome page (New/Open/Recent Solution) and the
   solution Compose flow are removed; devUI opens **projects** into an ambient/untitled
   solution like apps/plexus (no solution welcome page, no compose toolbar).
4. **Connection client = adapter, not a second bridge.** devUI's main process already
   composes the identical `PackageEngine` (plexus-core `main/connections`) and exposes
   connection CRUD over `window.todl.connections.*`. Add a thin renderer `IConnectionsClient`
   that maps the new stack's PascalCase calls onto that existing bridge, plus a new
   `connections:resolve` path — no new `window.api.connections`, no channel-name collisions.
5. **Keep devUI's Registry Connections manager (Surface A).** That rail panel
   (`ConnectionsManagerModule` over `RegistryBridge`) is devUI's registry/publish tool, not
   part of `solution-studio` and not the leftover. It stays as-is. devUI will therefore have
   both the registry-manager rail *and* the explorer's Connections branch, sharing one engine.

## 3. Key assumption to confirm at review

**devUI is a `ViewerShell` app** (a navigation rail of capabilities with a central
`ContentHostService`), whereas **apps/plexus is an `EditorShell`** (document-tab workspace).
"Match apps/plexus fully" is therefore read as: **the solution/project explorer *experience*,
hosted inside devUI's existing ViewerShell as a rail capability** — not converting devUI to an
EditorShell. Concretely:
- The new `SolutionExplorerModule` is composed as a devUI rail capability (the slot
  `solution-studio` occupies today).
- Row activation (`ProjectExplorerService.OpenMemberFile`) is routed to **devUI's own Monaco
  editor / `ContentHostService`** (devUI has a full editor under `src/renderer/editor/`), since
  devUI has no EditorShell document manager.

If instead you want devUI converted to an EditorShell workspace, that is a materially larger
effort and this spec must change. **Confirm this hosting interpretation at review.**

## 4. Current State (as explored)

- **devUI renderer** (`apps/devUI/src/renderer/app.mu`): a `ViewerShell` with rail modules
  `Storage`, `HomeModule`, `PackageManagerModule`, `PackageCompilerModule`,
  `SolutionStudioModule`, `ConnectionsManagerModule`, `PragmaticWindowChrome`.
- **devUI bootstrap** (`main.ts`): registers `NavigationService`/`ContentHostService`/
  `DialogService`, adds `SolutionServicesEngine`, calls `SolutionStudioSeams.Register`,
  `SolutionServicesRegistration.Register`, `DurableStoreRegistration.Register`,
  `BagMigrationRunner.RunGlobal`, then `RestoreSession`.
- **devUI main** (`src/main/index.ts`): already composes `PackageEngine` from plexus-core
  `main/connections` + a `LegacyRegistryMigration`; exposes connection CRUD over
  `window.todl.connections.*` via `RegistryBridge`/`register-ipc.ts`. **No `Resolve`.**
- **Old panel** (`packages/plexus-core/.../solution-studio/`): `solution-explorer-service.ts`
  (member tree + New/Open/Save/Compose + single connection combo over `CONNECTION_BAG_ID`),
  `solution-commands-vm.ts`, `solution-workspace-host.ts` (`ISolutionWorkspaceHost`),
  `connection-bag.ts`/`connection-fields.ts`/`connection-labels.ts`, plus
  `solution-studio-seams.ts` + `dialog-prompt-service.ts` (**still used by apps/plexus**).
- **HomeVM** (`apps/devUI/.../home/home-vm.ts`): calls the *old* service's
  `NewSolution`/`OpenSolution`/`OpenSolutionAt` + `SolutionManagerService.RecentSolutions`.
- **New stack app-side wiring** (apps/plexus, to replicate): `TodlProjectSystemModule` (from
  `@pragmatic-tech-ai/todl`), `ProjectExplorerModule`, `ConnectionsModule` (app-local editor
  launcher + `ConnectionsClient`), `SolutionExplorerModule`, `HierarchyContributorRegistry` +
  `HierarchyActionContributorRegistry`, `ProjectTreeHostKey → ProjectExplorerService`, and the
  `ProjectExplorerService.Start()`/`SolutionExplorerService.Start()` lifecycle.

## 5. Architecture — End State

devUI's renderer composition (rail modules), replacing `HomeModule` + `SolutionStudioModule`:

```
Storage
TodlProjectSystemModule            (project types + build/generator registries; from todl)
ProjectExplorerModule              (lifecycle service; no capability)
ConnectionsModule (devUI)          (IConnectionsClient + connection selection in the branch)
SolutionExplorerModule             (the rail capability: the hierarchy panel)
PackageManagerModule               (unchanged)
PackageCompilerModule              (unchanged)
ConnectionsManagerModule           (unchanged — devUI's registry/publish tool, Surface A)
PragmaticWindowChrome
```

Plus root `.services:` `HierarchyContributorRegistry` + `HierarchyActionContributorRegistry`;
bootstrap adds `ProjectTreeHostKey → ProjectExplorerService`, the file-open seam to devUI's
editor, and the `.Start()` lifecycle. The connection authority (`PackageManagerService` in
devUI main) is unchanged; only a renderer `IConnectionsClient` adapter + a `connections:resolve`
path are added.

## 6. Units

Each unit is an independently reviewable slice with a clear boundary.

### U0 — Prune `solution-studio` to its seams (no relocation, apps/plexus untouched)

Keep the `solution-studio` subpath and its two survivors so apps/plexus's import
(`SolutionStudioSeams`) is unchanged; delete the presentation files in U4.
- **Keep:** `solution-studio-seams.ts`, `dialog-prompt-service.ts`, `dialog-prompt-service.test.ts`,
  a trimmed `index.ts` re-exporting only `SolutionStudioSeams` (+ `DialogPromptService` if any
  external use).
- **Interfaces:** `SolutionStudioSeams.Register(provider)` and `DialogPromptService` keep their
  current signatures and subpath (`@pragmatic-tech-ai/plexus-core/renderer/modules/solution-studio`).
- Deletion of the panel files happens in U4 (kept separate so U1–U3 can build against a still-intact
  tree, then U4 removes dead code once nothing imports it).

### U1 — devUI connection client + `Resolve` (main/preload/renderer adapter)

- **Main:** add a `connections:resolve` IPC handler that lifts
  `ConnectionsBridge.Resolve(id, version, connectionId?)` semantics (already validated by the
  P6b integration test) over devUI's existing `PackageManagerService` — read tarball via
  `PackageRegistryClient.getContent` + `TarReader`, map `package/model.json` + `package/resources/*`
  → `SourcedPackage`. (devUI main already imports the needed pieces.)
- **Preload:** expose the `resolve` method on devUI's existing connections surface.
- **Renderer:** a `DevUiConnectionsClient` implementing `IConnectionsClient` (PascalCase) that
  delegates to devUI's `window.todl.connections.*` (lowercase), registered under
  `ConnectionsClientKey`; and a devUI `AppConnectionPackageResolver` equivalent wired into the
  package-source path.
- **Interfaces produced:** `ConnectionsClientKey → IConnectionsClient`; a resolve function of
  shape `(id, version, connectionId?) => Promise<SourcedPackage | undefined>`.
- **Secrets:** unchanged — tokens stay main-side; only `HasToken`/refs cross IPC.

### U2 — devUI renderer stack adoption

- **app.mu:** add `TodlProjectSystemModule`, `ProjectExplorerModule`, devUI `ConnectionsModule`,
  `SolutionExplorerModule`; merge their resources (`ProjectExplorerResources`,
  `SolutionExplorerResources`, connections resources). Remove `SolutionStudioModule` from the
  module list (its seams still come from `SolutionStudioSeams.Register` in main.ts).
- **Root services:** register `HierarchyContributorRegistry` + `HierarchyActionContributorRegistry`.
- **Bootstrap (main.ts):** alias `ProjectTreeHostKey → ProjectExplorerService`; wire the
  **file-open seam** so `ProjectExplorerService.OpenMemberFile` opens the file in devUI's Monaco
  editor via `ContentHostService` (devUI's editor host), not an EditorShell document; add the
  `ProjectExplorerService.Start()` + `SolutionExplorerService.Start()` (+ `RestoreSession`)
  lifecycle in the documented order.
- **Connections branch = selection/default only.** The explorer's Connections branch handles
  choosing the effective connection + marking a default, flowing through `ConnectionEditingService`
  / `ConnectionResolution`. Add/edit/test of connections stays in devUI's existing **Registry
  Connections manager** rail (Surface A) — no duplicate editor is built. If the branch needs an
  "add" affordance, it navigates the user to that rail rather than launching a new dialog.
- **Interfaces consumed:** U1's `ConnectionsClientKey`; the new modules' public module consts +
  service keys from plexus-core/todl.

### U3 — Retire Home + Compose + workspace host; ambient-solution entry

- Remove `HomeModule` from the rail and delete it entirely: `home-vm.ts`, `recent-solution-vm.ts`,
  `home.module.mu`, `home.resources.mu` (+ any tests). `HomeVM` is solution-only today (New/Open/
  Recent Solution + `goToSolutions`), so nothing non-solution is lost.
- devUI opens into an **ambient/untitled solution** on startup (as apps/plexus does): keep
  `DurableApplicationStore.Restore()` + `RestoreSession()`; the first rail capability becomes the
  Solution Explorer.
- Retire `RegistrySolutionWorkspaceHost` + `SolutionServicesRegistration`'s
  `SolutionWorkspaceHostKey` binding and the single-type `TodlPackageProjectFactory` registration
  (project types now come from `TodlProjectSystemModule`). Reconcile `ipc-package-source.ts` with
  the new package-source/Resolve path.
- **No Compose:** the compose flow + `ComposeStatus` are dropped.

### U4 — Delete the old panel + export map entries

Once U1–U3 land and nothing imports the panel:
- Delete `solution-explorer-service.ts` (old), `solution-commands-vm.ts`,
  `solution-workspace-host.ts`, `connection-bag.ts`, `connection-fields.ts`,
  `connection-labels.ts`, `solution-studio.module.mu` (+ compiled), and their tests
  (`connection-fields.test.ts`, `connection-labels.test.ts`).
- Remove the `./renderer/modules/solution-studio/*` panel exports that are now dead (keep the
  seams export).

## 7. Data Flow

- **Connection resolution:** renderer `ConnectionEditingService` (catalog) computes the effective
  connection via `ConnectionResolution` → package source calls the devUI `AppConnectionPackageResolver`
  → `connections:resolve` IPC → main lifts the tarball → `SourcedPackage` (byte-faithful resources).
- **File open:** explorer row activate → `SolutionExplorerService.onActivate` →
  `ProjectExplorerService.OpenMemberFile(member, path, kind)` → devUI file-open seam → Monaco editor
  in the content host.

## 8. Risks & Mitigations

1. **ViewerShell vs EditorShell hosting** (§3) — mitigated by hosting the explorer as a rail
   capability + routing file-open to devUI's editor; **confirm the interpretation at review**.
2. **HomeVM coupling to the old service** — the entry point is re-homed onto `SolutionManagerService`
   (ambient solution) and Home is dropped; no old-service call survives.
3. **Project-factory collision** — devUI's single-type factory is removed in U3; `TodlProjectSystemModule`
   becomes the sole `ProjectFactoryRegistryKey` registrant (last-wins collision avoided).
4. **No e2e over the replaced panel** — safety net is the new devUI `typecheck` script + vitest units
   (U1 adapter/resolve) + playwright smoke (must stay green); the existing Registry Connections smoke
   is untouched.
5. **Connection editor UX parity** — devUI keeps its richer Registry Connections manager; the branch
   handles selection/default, so no editor capability is lost.

## 9. Testing Strategy

- **Add a `typecheck` script to apps/devUI** (`tsc --noEmit` over its node + web tsconfigs), so the
  root `typecheck --workspaces` stops silently skipping devUI. Gate every unit on it.
- **U1:** vitest unit for `DevUiConnectionsClient` (PascalCase→bridge mapping) and for the
  `connections:resolve` main handler (reuse the P6b fake-transport pattern: in-memory registry +
  `FakeEncryptor`, assert byte-faithful `SourcedPackage`).
- **U2/U3:** typecheck + `electron-vite build` clean; playwright smoke (`solution.spec.ts`,
  `connections.spec.ts`, `package-manager.spec.ts`) green; add/adjust a smoke that the Solution
  Explorer rail renders and opens a project from the corpus.
- **U4:** full devUI vitest + apps/plexus vitest green (prove the seam prune didn't break apps/plexus).

## 10. Global Constraints (house style — apply to all units)

- **OOP, no globals:** behavior in classes/methods; no module-level free functions or mutable
  module state.
- **Allman braces**, hand-maintained.
- **PascalCase** for interfaces and public methods; private members keep their casing.
- **No inline string literals** — hoist reused/user-facing strings (labels, keys, channel names,
  property names) to `private static readonly` constants.
- **VMs extend `Observable`**, not `MuralBase`, unless a DP is genuinely needed.
- **Enums over string-literal unions.**
- **Secrets never in a bag or across IPC** — only `TokenRef`/`TokenEnvVar`/`HasToken`.
- **Tests live in `tests/` subfolders** beside their source.
- **Always adopt the latest published workspace package versions.**

## 11. Out of Scope

- Converting devUI to an EditorShell (see §3).
- Changing devUI's Registry Connections manager (Surface A) or its publish/compile (`RegistryBridge`).
- apps/plexus behavior (only the untouched `solution-studio` seams subpath is shared).
- Any change to the P6a catalog engine itself (todl/todl-runtime) — this is a consumer migration.
