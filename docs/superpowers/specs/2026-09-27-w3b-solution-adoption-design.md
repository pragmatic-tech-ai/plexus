# Wave 3b — Plexus adopts TODL solution-services (the keystone) — design

**Status:** design / spec
**Date:** 2026-09-27
**Depends on:** `@pragmatic-tech-ai/todl@0.38.1` (published as component A of this wave)

## Context

The final Wave-3 sub-wave. W3a shipped the TODL primitives (`@pragmatic-tech-ai/todl@0.38.0`): per-project `OpenProject`/`CloseProject` over an ambient untitled solution, and the editor-facing surface on `SolutionBaseResolver` (`ResolveBasesFor`, `ReferencedPublishedRefs`, `WorkspaceProducers`, `ProducedIdOf`). W3b makes Plexus adopt them "in its entirety": `ProjectExplorerService` becomes a projection of `SolutionManagerService.ActiveSolution.Members`, `WorkspaceBaseResolver` is deleted, and the language client is driven by the `StaleMemberIds` push (this wave merges the originally-separate W3c refresh-signal work, because retiring `WorkspaceBaseResolver` removes the imperative `RefreshDependentsOfIds` fan-out that the push replaces).

Grounding facts (from exploration; cite during implementation):
- `main.js`: `LiveValidationKey`→`TodlLanguageClient` (95), `BaseResolverKey`→`WorkspaceBaseResolver` (96), `ProjectTreeHostKey`→`ProjectExplorerService` (98); `WorkspaceBaseResolver` eagerly constructed (143); language client init (174-191); `ProjectExplorerService.RestoreSession()` (226-227).
- `SolutionManagerService.Key` is registered in the renderer (dormant) via `SolutionServicesEngine` (app.mu:432), but its collaborators `StorageRegistryKey`/`PromptServiceKey`/`PackageSourceKey`/`NotificationServiceKey` are **not** wired in the Plexus app (only devUI). `ProjectFactoryRegistryKey` **is** (the composer). `PackageStoreKey`→`PlexusPackageStore` **is** (meta-model.module.mu:29). `SolutionBaseResolver.Key` **is** registered by `ProjectSystemComposer.Compose` (lazy singleton) but disconnected from `BaseResolverKey`.
- `OpenProject` (`packages/plexus-core/src/renderer/projects/open-project.ts`) is a `MuralBase` VM: set-once `factory`/`storage`, mutable `project` (via `Adopt`), the reconciled `Root` tree, ~16 command DPs (incl. `RefreshBasesCommand`), selection/menu/expand view state. `SolutionMember` carries only `Ref{path,type}`/`Project`/`Storage`/`Title`/`IsResolved`.
- `ProjectExplorerService` mutates `OpenProjects` only in `addOpenProject` (492-506: build VM, `wireProjectCommands`, `wireNodes`, `Add`, `LiveValidation.AttachProject`, `openStore.Add`) and `closeProject` (1237-1262: `DocumentCloseGuard` per owned doc — Cancel aborts the whole close — then `DetachProject`, `Remove`, `openStore.Remove`). `openProjectAt` (389-439) reads the manifest, resolves the factory, creates storage, `factory.openProject`, `addOpenProject`. `RestoreSession` (472-486) replays `OpenProjectsStore` folders through `openProjectAt`.
- `IBaseResolver` (`packages/plexus-core/src/renderer/projects/capabilities/base-resolver.ts:12-17`): `WorkspaceProducers(kind: ProducerKind): Promise<BaseRef[]>`, `ProducedIdOf(storage): string | undefined`, `RefreshDependentsOfIds(ids): Promise<void>`. Consumers: `project-explorer-service.ts` `manageReferences` (1167/1172), `RefreshProjects` (1228/1231-1232).
- Direct `WorkspaceBaseResolver.Key` consumers: `ResolveForStorage` → language client `basesFor` (todl-language-client.ts:270), arch-model-gateway (54), architecture-model-service (94, uses `originOf`); `referencedPublishedRefs` → arch-diagram-binding-service (152-153).
- `OpenProjects` consumers read `op.Storage`/`op.Factory`/`op.Project`/`op.Folder`/`op.Name` and the `ObservableCollection` surface (`.ToArray`/`.Subscribe`/`.Count`/`.Get` + change notifications); TreeView binds `$OpenProjects` (project-explorer.resources.mu:242).

## Global Constraints

- **OOP, no free functions / module state.** Methods or `private static` members only (existing test-helper free functions may follow the nearest local precedent, as in W3a).
- **Allman braces**; **no inline reused/user-facing string literals** (hoist to `private static readonly` / message-builders); **PascalCase** public methods + interfaces; **view models extend `Observable`** (not `MuralBase`) unless they need the dependency-property system — `OpenProject` already uses `MuralBase` and stays as-is.
- **TODL stays host-free** (component A): no Plexus/mural/node imports; published lookups via `inner()`.
- **Plexus:** never run `npm install` (breaks sibling symlinks); refresh `@pragmatic-tech-ai/todl` in `node_modules` via the scratchpad `refresh-todl.sh` (pack the worktree, extract into `node_modules`); run `npm run build:core` before any Plexus typecheck/test; TODL tests use `node:test`, Plexus tests use `vitest`.
- **Enums over string-literal unions**; **tests in `tests/` subfolders**.
- **Merge/publish/push are norms-gated** — component A's 0.38.1 publish and any push are confirmed with the user at execution, not done unprompted.

## Review Focus

Inputs most likely to bite that no single happy-path test covers:
1. **Close cancelled by the save-guard** — `DocumentCloseGuard.TryCloseDocument` returns Cancel on a dirty doc: the project must stay open (member NOT removed, `CloseProject` not called), exactly as today. (Component C.)
2. **`RestoreSession` with a persisted folder whose manifest is now missing/unreadable** — must prune the `OpenProjectsStore` entry and not create a broken member, as `openProjectAt`/`RestoreSession` do today. (Component C.)
3. **`OpenProject` dedupe** — opening an already-open folder (via recents, file-watch, or restore) must not create a second member/VM. (Components B/C.)
4. **`StaleMemberIds` fires for a member whose editor isn't open / whose storage maps to no registered project** — the language-client handler must no-op safely, not throw. (Component E.)
5. **Boot order** — `SolutionBaseResolver` (composer-constructed lazily) and the language-client `StaleMemberIds` subscription must be established after the ambient-solution wiring, and `RestoreSession` must run after the `Members` subscription is live, or restored projects never produce `OpenProject` VMs. (Components B/E.)

---

## Component A — TODL 0.38.1: live-closure fix

**Repo/worktree:** TODL `build-modules` worktree, a fresh branch off `main` (60fbd8f / v0.38.0).
**Files:** `src/solution-services/solution-manager/engine/solution-base-resolver.ts`; tests in the adjacent `tests/`.

Resolve the parked W3a findings #1/#2:
- In `resolveOneBase`, the DFS walk gains a `seenLive: Set<IStorage>` (threaded like `seenPub`). On a successful live compile, before `return`, also push each doc in `child.bases` into the parent `bases` and merge `child.originOf` into the parent `originOf` (first-writer-wins), so a consumer binding an open producer receives that producer's **transitive** live bases too — symmetric with the published branch. `seenLive` (keyed by producer `IStorage`) ensures a live diamond compiles/pushes once; the existing DFS `path` still catches cycles.
- Add tests: a **live diamond** (C→A, C→B, both→D open; D resolves once, no cyclic problem, D's nodes present with an OpenProject origin); a two-level live chain (consumer→L→M open; M's nodes appear in the consumer's closure). Add the deferred **versionless-producer** fixture to the `WorkspaceProducers` test. Inline the now-passthrough `liveProducerOfKind` at its call sites (keep the explanatory comment).
- Bump `0.38.0`→`0.38.1`, full `node:test` suite green, publish `--userconfig`, tag `v0.38.1`, push (norms-gated — confirm at execution).

Then Plexus bumps its three `@pragmatic-tech-ai/todl` deps `^0.38.0`→`^0.38.1` and refreshes `node_modules` via `refresh-todl.sh`.

## Component B — Make `SolutionManagerService` live in the Plexus renderer

**Files:** `apps/plexus/src/renderer/src/main.js` (or the bootstrap it calls); a small renderer registration module if cleaner.

- Register the missing collaborators before the service is resolved:
  - Reuse `SolutionStudioSeams.Register(app.Services)` (plexus-core) for `PromptServiceKey`→`DialogPromptService` (over `DialogService`) and `StorageRegistryKey`→`StorageService`.
  - Register `PackageSourceKey` (`'SolutionPackageSource'`) to a thin renderer `PackageSource` over the packages backend (the ctor requires it; the ambient `OpenProject`/`CloseProject` flow does not exercise `Compose`, so a minimal published-package-backed source suffices). Name the class and keep it small.
  - `ProjectFactoryRegistryKey` and `PackageStoreKey` are already registered — leave them.
- The ambient untitled solution is created lazily by `SolutionManagerService.OpenProject` (`EnsureActiveSolution`); no explicit `NewUntitledSolution` at boot is required, but the service must be **resolved** (constructed) before `RestoreSession` so its `ActiveSolution` subscription chain is live.

## Component C — `ProjectExplorerService` → `Members`-derived façade

**Files:** `packages/plexus-core/src/renderer/modules/project-explorer/services/project-explorer-service.ts`; possibly a small `MemberProjection` helper in the same module.

- ProjectExplorerService gains a dependency on `SolutionManagerService.Key` (plexus-core already depends on `@pragmatic-tech-ai/todl`). It keeps `OpenProjects: ObservableCollection<OpenProject>` as the UI read-model but stops being its owner of record — the collection is **synced** from `ActiveSolution.Members`:
  - Subscribe to `ActiveSolution.Members` collection changes, and re-wire that subscription whenever `ActiveSolution` itself changes (same pattern `SolutionBaseResolver.rewireMembers` uses).
  - **Member added** → resolve the factory via `ProjectFactoryRegistryKey.factoryFor(member.Ref.type)`; build `new OpenProject(member.Project as Project, factory, member.Storage!)`; `wireProjectCommands`/`wireNodes`; `OpenProjects.Add`; `LiveValidation.AttachProject(project.RootPath, project.Name, storage)`; `openStore.Add(op.Folder)`. Dedupe by folder (a member already projected keeps its `OpenProject`).
  - **Member removed** → find the `OpenProject`, `LiveValidation.DetachProject(op.Storage)`, doc cleanup (docOwners/docPaths), `OpenProjects.Remove`, `openStore.Remove(op.Folder)`.
  - Keep a `Map<SolutionMember, OpenProject>` (or by folder) so add/remove reconcile.
- Rewrite the imperative entry points to delegate:
  - `openProjectAt(folder)` → `await SolutionManagerService.OpenProject(folder)` (the manifest read + factory + storage + `factory.openProject` now happen inside `OpenProject`); the Members-sync produces the VM. Keep `recents.Add` and the `Opened` status.
  - `createProjectAt(...)` → create the project on disk as today (`factory.createProject`), then `OpenProject(folder)`.
  - `closeProject(op)` → run the existing `DocumentCloseGuard` loop over `op`'s owned docs FIRST; if any cancels, return (project stays open); otherwise `await SolutionManagerService.CloseProject(memberOf(op))`. The Members-sync does `DetachProject`/`Remove`/un-persist.
  - `RestoreSession()` → for each `openStore.List()` folder whose manifest still exists, `await SolutionManagerService.OpenProject(folder)`; prune missing ones (unchanged pruning logic).
- No `OpenProjects` consumer changes: `op.Storage`/`op.Factory`/`op.Project`/`op.Folder`/`op.Name` and the `ObservableCollection` surface are preserved.

## Component D — Retire `WorkspaceBaseResolver`; rebind seams onto `SolutionBaseResolver`

**Files:** delete `apps/plexus/src/renderer/src/services/projects/workspace-base-resolver.ts` (+ its tests); `main.js`; `packages/plexus-core/src/renderer/projects/capabilities/base-resolver.ts`; the direct consumers.

- **`IBaseResolver` reshape** to match the TODL surface and bind `BaseResolverKey` directly to `SolutionBaseResolver` (no adapter):
  - `WorkspaceProducers(kind: ProjectType): Promise<readonly DependencyRef[]>` (was `ProducerKind`/`BaseRef[]`), `ProducedIdOf(storage: IStorage): Promise<string | undefined>` (now async), and **drop `RefreshDependentsOfIds`**.
  - Update the two call sites in `project-explorer-service.ts`: `manageReferences` uses `ProjectType.MetaModel`/`ProjectType.Library` and `DependencyRef`; `RefreshProjects` awaits `ProducedIdOf` and, instead of `RefreshDependentsOfIds`, calls `SolutionBaseResolver.Invalidate(producedId)` per changed producer (the Component-E subscription fans out the refresh). `ProducerKind`/`BaseRef` usages migrate to `ProjectType`/`DependencyRef` (both re-exportable from `@pragmatic-tech-ai/todl`; `DependencyRef` was exported in W3a).
  - `main.js:96` → `register(BaseResolverKey, (p) => p.getRequired(SolutionBaseResolver.Key))`. Remove the eager `WorkspaceBaseResolver` construction at 143 (the resolver is composer-registered and subscribes on construction; ensure it is resolved once at boot after Component B wiring — pin in `main.js`).
- **Direct consumers** move to `SolutionBaseResolver.Key`:
  - language client `basesFor` → `ResolveBasesFor(storage)` (same `{bases, problems, originOf}` shape; `originOf` is the TODL `WikiOrigin`, already the re-exported type Plexus uses since W2).
  - arch-model-gateway, architecture-model-service → `ResolveBasesFor`.
  - arch-diagram-binding-service → `ReferencedPublishedRefs`.

## Component E — `StaleMemberIds` push (merged W3c) + `Invalidate`

**Files:** `apps/plexus/src/renderer/src/services/todl/todl-language-client.ts`; the producer-change trigger sites.

- `TodlLanguageClient` subscribes once (at init, after Component B) to `SolutionBaseResolver.PropertyChanged('StaleMemberIds')`. On change, read `resolver.StaleMemberIds`; for each stale member id, find its member in `SolutionManagerService.ActiveSolution.Members` (match by manifest `id`/producer id), take `member.Storage`, and run the existing per-storage refresh (`baseCache.delete`, `todl/refreshBases` with freshly-resolved bases, `fireSemanticStale`). Coalesce (dedupe storages; a microtask/batch guard so one `Invalidate` → one refresh pass). A stale id with no open/registered project storage no-ops.
- Producer-change triggers call `SolutionBaseResolver.Invalidate(producedId)` instead of the old fan-out: `RefreshProjects` (file-watch/agent rescan), and the publish path if it changes a producer. `Invalidate` evicts the member + transitive dependents and raises `StaleMemberIds`, which the subscription turns into editor refreshes.
- **Single-project manual refresh stays direct:** `op.RefreshBasesCommand`/`refreshBases` and the pre-publish refresh still call `LiveValidation.RefreshBases(op.Storage)` for just that project (no cascade intended).
- `RefreshDependentsOfIds` and `DependentsOf` (Plexus) are gone; the TODL resolver's internal `dependentsOf` graph drives the cascade.

## Testing

- **Component A (TODL):** `node:test` — live diamond resolves once with transitive live bases + OpenProject origins; two-level live chain surfaces the grandparent's nodes; versionless-producer skipped; full suite green.
- **Plexus (`vitest`, after `build:core`):**
  - Member↔façade sync: adding a member yields one wired `OpenProject` (commands + `Root`), removing disposes it; dedupe on re-open; `RestoreSession` replays folders and prunes a missing manifest (Review Focus #2/#3).
  - Close-guard cancel leaves the member open and does not call `CloseProject` (Review Focus #1).
  - Seam rebind: `BaseResolverKey` resolves `SolutionBaseResolver`; `manageReferences`/`RefreshProjects` compile and behave against a fake solution; direct consumers call `ResolveBasesFor`/`ReferencedPublishedRefs`.
  - `StaleMemberIds`→refresh: a fake `SolutionBaseResolver` raising `StaleMemberIds` drives the language client to refresh exactly the affected storages, and no-ops for an unknown id (Review Focus #4).
- Full suites: TODL `node:test`, Plexus `vitest` (core + app + devUI), Plexus `typecheck`.

## Sequencing

A (TODL 0.38.1 publish) → Plexus dep bump `^0.38.1` + `node_modules` refresh → B (wire `SolutionManagerService`) → C (façade) → D (retire + rebind) → E (signal). D and E depend on C (a live member set) and on A/B (a live resolver + manager).

## Out of scope

- `SolutionExplorerService`/solution-studio (`.pksln` UI) unification — it already uses `SolutionManagerService`; W3b doesn't merge it into the explorer.
- Incremental (non-coarse) cache patching in `SolutionBaseResolver` (the Members-change coarse clear stays).
- Any change to `TryGet`/build-time composition beyond what W3a shipped.
