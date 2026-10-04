# Project-Explorer Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Delete the entire `project-explorer` module from plexus-core, moving its engine logic into todl's SolutionManager (UX-free) and its UI into plexus-core's `solution-explorer`, with every consumer migrated off `ProjectExplorerService`. End state: no `project-explorer` folder exists.

**Architecture:** `ProjectExplorerService` is a 4-in-1 god class — (a) the live `OpenProjects` projection of solution members, (b) the `IContentMutations` member-mutation facade, (c) legacy `ProjectNode` tree-VM wiring, (d) app seams. The C2 Hierarchy already renders the tree from `SolutionManagerService.ActiveSolution.Members`, so (a)+(c) are dropped. (b)+(d) split into UX-free engine ops (→ todl, outcome/event-based, string-free) with UI wrappers (→ solution-explorer, dialogs/prompts/tabs). All ~10 `OpenProjects` consumers migrate to the engine `Members` surface; the `OpenProject` VM is deleted. Cross-member move is dropped (filed as a follow-up).

**Tech Stack:** todl (TS, `node:test` via `tsx --test`, GitHub Packages), plexus-core + apps/plexus (TS, vitest, `.mu` markup, Electron). Two repos: `C:\Users\Eugene\Projects\architecture-agent\TODL` and `...\Plexus`.

**Spec / requirements annex:** the four recon reports are the authoritative member/consumer inventory — treat them as this plan's spec:
- `Plexus/.superpowers/sdd/_pe-retire-recon/A-pe-service.md` (project-explorer-service.ts: 41 public + ~75 private members, bucketed, with seams)
- `Plexus/.superpowers/sdd/_pe-retire-recon/B-pe-helpers.md` (helper files)
- `Plexus/.superpowers/sdd/_pe-retire-recon/C-targets-consumers.md` (solution-explorer + todl targets, all 43 consumers)
- `Plexus/.superpowers/sdd/_pe-retire-recon/SYNTHESIS-triage.md` (end-state + triage)
Every task below cites the annex rows it implements; the implementer reads the cited rows for exact member lists.

## Global Constraints

- **Layering (binding):** the todl engine stays UX-FREE — no mural/view-model/dialog/Visual/ICommand/Observable-UI types, no UI strings. Engine ops return typed outcomes and raise signals; the UI supplies prompts/guards via DI seams (existing `IPromptService`/`ConfirmAsk` in todl-runtime; this plan adds guard seams). An `engine-boundary.test.ts` already guards this in todl — keep it green.
- House style (both repos): OOP (no module-level free functions/data; state in class fields — module-level `const`/enums/types OK); Allman braces (opening brace own line for class/interface/enum/function/method/ctor/getter/setter + every control-flow block; else/catch/finally own line; inline OK only for one-line `if (x) return;`, object literals, block-bodied arrows); reused/user-facing string literals → `private static readonly` PascalCase constants (`.ts` only; `.mu` labels stay inline); VMs extend `Observable` not `MuralBase` unless they need DPs; PascalCase interfaces + public methods; real enums not string-unions; disposers typed `IDisposable`; tests in `tests/` subfolders. Generated `*.mu.js` never hand-edited.
- **Repos & branches:** todl work on `main` (publish authorized when a task says so); Plexus work on branch `pe-retirement` off `main`, merged + pushed only at the final task. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- todl commands: `npm run test:file -- <path>`, `npm test`, `npm run typecheck`. Plexus gate: `npm run -w @pragmatic-tech-ai/plexus-core build` (tsc 0 + compile:mu), `npm run -w @pragmatic-tech-ai/plexus typecheck:node` + `typecheck:web` (0), `npm run -w @pragmatic-tech-ai/plexus test` + `npm run -w @pragmatic-tech-ai/plexus-core test`. Rebuild plexus-core before app typecheck (dist is stale+gitignored).
- **Dependency order is strict:** todl tasks (1–7) publish before plexus-core tasks (8–15) can adopt. Do not start a Plexus task that needs a new engine API before the todl release carrying it is published and adopted.

## Review Focus

- **Engine purity:** every new todl export must be free of mural/UI types and UI strings — a reviewer greps the new files for `mural`, `Dialog`, `ICommand`, `Observable`-UI, and literal user strings. Tested by extending `engine-boundary.test.ts`.
- **No orphaned open editors:** delete/rename/move/close must close or repoint affected tabs BEFORE the disk op (an open editor over a deleted/moved file must not dangle). Covered in Task 9 tests.
- **LiveValidation continuity:** after the projection loop is gone, member add/remove/rescan must still Attach/Detach/Resync LiveValidation and RefreshBases — else Problems/validation silently stops. Covered in Task 11 tests.
- **OpenProjects semantics preserved:** consumers that read `OpenProjects` (title, file-watch, arch, wiki) must still react to members opening/closing (add + remove + subscribe). Covered per-consumer in Task 12 tests.
- **No regression in the shipped menu/commands:** New/Open Project from the title-bar menu and the solution-explorer command bar must still work after the service is replaced. Covered in Task 10/14 tests.

---

## PART 1 — todl engine (UX-free member-ops + lifecycle outcomes)

### Task 1: todl — pure helpers (`uniqueStorageName`, path utils) + fold `SavingSolutionBagPersister`

**Annex:** A §5 (`uniqueStorageName` ENGINE; free path helpers), B (`saving-solution-bag-persister.ts` ENGINE; `buildVantage` ENGINE).

**Files:**
- Create: `TODL/src/solution-services/project-services/content/unique-name.ts` (`UniqueName.For(storage, fileName): Promise<string>`)
- Modify: `TODL/src/solution-services/property-bags/solution-bag-persister.ts` (add a saving variant, or a `SolutionManagerService.BuildVantage(member?)` that returns a `BagVantage` whose Solution persister flushes `Save()` when `HasLocation`)
- Test: `TODL/src/solution-services/project-services/content/tests/unique-name.test.ts`; extend `solution-bag-persister` tests.

**Interfaces:**
- Produces: `class UniqueName { public static For(storage: IStorage, fileName: string): Promise<string> }` (free stem-N.ext, pure IO). `SolutionManagerService.BuildVantage(member?: SolutionMember): Promise<BagVantage>` (global + solution(saving) + project shared/local).

- [ ] Step 1: Write failing test — `UniqueName.For` returns `a.ts` when absent, `a-1.ts` when `a.ts` exists (use `FakeStorage`). Assert.
- [ ] Step 2: Run `npm run test:file -- src/solution-services/project-services/content/tests/unique-name.test.ts` → fails (not defined).
- [ ] Step 3: Implement `UniqueName.For` (port the pure body of plexus-core `project-explorer-service.ts uniqueStorageName`, verbatim logic, as a static method). Implement `SolutionManagerService.BuildVantage` (port `buildVantage` + fold `SavingSolutionBagPersister`'s flush-saves-manager behavior into the Solution persister it installs).
- [ ] Step 4: Run the new + bag-persister tests → pass; `npm run typecheck` 0; `npm test` green.
- [ ] Step 5: Commit `feat(solution-services): UniqueName helper + saving solution-bag vantage`.

### Task 2: todl — engine content-mutation API over `ProjectContentStore`, keyed by `SolutionMember`

**Annex:** A §5 rows RenameMemberFile/DeleteMemberFiles/NewFileForMember/NewFolderForMember/ImportFilesForMember/ImportFolderForMember/MoveMemberNodes (engine cores); §7 seams 1–3; C PART 2 "NEW … member-keyed mutation API"; Review Focus "no orphaned editors".

**Files:**
- Create: `TODL/src/solution-services/project-services/content/member-content-ops.ts` (`MemberContentOps`)
- Create: `TODL/src/solution-services/project-services/content/content-lifecycle.ts` (seam interfaces + events)
- Test: `.../content/tests/member-content-ops.test.ts`

**Interfaces:**
- Produces (all UX-free; return typed outcomes, no strings, no dialogs):
  - `interface IContentLifecycleGuard { CanRemove(member: SolutionMember, paths: readonly string[]): Promise<boolean>; OnMoved(member: SolutionMember, from: string, to: string): void; OnRemoved(member: SolutionMember, paths: readonly string[]): void }` (the UI implements this; engine calls it around disk ops so tabs close/repoint).
  - `class MemberContentOps` ctor `(member: SolutionMember, guard?: IContentLifecycleGuard)` with: `Rename(path, newName): Promise<RenameResult>` (validate name, collision check, `store.Rename`, `guard.OnMoved`), `Delete(paths): Promise<void>` (await `guard.CanRemove`, filter to roots, `store.Delete`, `guard.OnRemoved`), `NewFile(folder, name, content): Promise<string>`, `NewFolder(folder, name?): Promise<string>` (default name param, NOT ignored — fix the `NewFolderForMember` `_name` bug, annex §5), `ImportBytes(target, files: {name,bytes}[]): Promise<string[]>`, `Move(paths, destFolder): Promise<MoveResult>` (plan via a ported pure `planNodeMoves`, Exists-skip, `store.Rename`, `guard.OnMoved`).
  - `type RenameResult = { ok: true; to: string } | { ok: false; error: RenameError }`; `enum RenameError { Empty, Collision, Invalid }`; `type MoveResult = { moved: readonly {from:string;to:string}[]; skipped: readonly string[] }`.
- Consumes: todl `ProjectContentStore` (CreateFile/CreateFolder/Rename/Delete/Move), `IStorage`, `UniqueName` (Task 1).

- [ ] Step 1: Write failing tests (FakeStorage + a fake guard recording calls): Rename collision → `{ok:false,error:Collision}`; Rename ok → `store` renamed + `guard.OnMoved` called; Delete → `guard.CanRemove` awaited, veto (false) skips disk delete, accept deletes + `guard.OnRemoved`; NewFolder honors passed name and dedupes; Move skips existing dest + reports skipped; NewFile writes content + returns unique path.
- [ ] Step 2: Run → fails.
- [ ] Step 3: Implement `MemberContentOps` + `content-lifecycle.ts` (port the engine cores from `project-explorer-service.ts` renameFile/deleteFiles/newFileIn/newFolderIn/importFilesInto/moveNodes + `planNodeMoves` from plexus-core `projects/node-move.ts`; strip ALL mural/Status/dialog; prompts/guards via the seam).
- [ ] Step 4: Run tests → pass; typecheck 0; full suite green; confirm no new UI imports.
- [ ] Step 5: Commit `feat(solution-services): member content-mutation ops (rename/delete/new/import/move) with lifecycle guard seam`.

### Task 3: todl — version ops, scaffold refresh, bases refresh, capability queries

**Annex:** A §5 BumpMemberVersion (ENGINE), SetMemberVersion (engine core), UpdateMemberAgentMetadata (ENGINE), RefreshMemberBases (ENGINE via resolver Invalidate), FormatsFor/IsVersionedMember/CanRefreshBasesMember/SupportsScaffoldMember (ENGINE capability queries); C PART 2.

**Files:**
- Create: `TODL/src/solution-services/project-services/core/member-project-ops.ts` (`MemberProjectOps`)
- Modify: `TODL/src/solution-services/.../semver.ts` (port `semver-bump` + `VersionPart` enum from plexus-core `projects/semver-bump.ts`)
- Test: `.../core/tests/member-project-ops.test.ts`

**Interfaces:**
- Produces: `enum VersionPart { Major, Minor, Patch }`; `class MemberProjectOps` with `BumpVersion(member, part): Promise<string>` (factory.getVersion→semver bump→setVersion, returns new version), `SetVersion(member, version): Promise<void>`, `UpdateScaffold(member): Promise<readonly string[]>` (factory.updateScaffold, returns written files), `RefreshBases(member): void` (resolver.Invalidate), and capability queries `FormatsFor(member): readonly ProjectFileFormat[]`, `IsVersioned(member): boolean`, `CanRefreshBases(member): boolean`, `SupportsScaffold(member): boolean` (all via `IProjectFactory`, which is engine-visible). Capability queries read `member`'s factory through `ProjectFactoryRegistry`.
- Note: `ProjectFileFormat` must be an engine type — if it currently lives in plexus-core, define/move it to todl (check annex A imports: `ProjectFileFormat` is plexus-core-internal today → relocate to todl project-services as part of this task).

- [ ] Step 1: Failing tests (FakeProjectFactory with getVersion/setVersion/updateScaffold/formats + requiresMetaModel): BumpVersion patch 1.2.3→1.2.4; SetVersion writes; UpdateScaffold returns written; capability queries reflect factory flags.
- [ ] Step 2: Run → fails.
- [ ] Step 3: Implement; relocate `ProjectFileFormat` + `VersionPart` + semver bump into todl.
- [ ] Step 4: Tests pass; typecheck 0; full suite green.
- [ ] Step 5: Commit `feat(solution-services): member version/scaffold/bases ops + capability queries`.

### Task 4: todl — reference editing (catalog / write / classify)

**Annex:** B hard-call 1 (ReferenceEditingService ENGINE split); A §5 References/manageReferences; C PART 2 "reference-editing orchestration (NEW)".

**Files:**
- Create: `TODL/src/solution-services/project-services/references/reference-editor.ts` (`ReferenceEditor`)
- Test: `.../references/tests/reference-editor.test.ts`

**Interfaces:**
- Produces (UX-free, DTOs only): `class ReferenceEditor` ctor `(member, resolver: SolutionBaseResolver, storage: IStorage)` with `ReadManifest(): Promise<ReferenceManifest>`, `WriteReferences(bindings: BaseBindings): Promise<void>` (mutate project manifest metaModels/libraries, write, then `resolver.Invalidate` + raise `ReferencesChanged` via the engine `ProjectEventsKey`), `Classify(ref): ReferenceResolutionKind`, `AvailableReferencesFor(): Promise<readonly RefChoiceDTO[]>`, `AvailableVersionsFor(ref): Promise<readonly string[]>` (sorted by a ported `CompareVersionsDesc`). `enum ReferenceResolutionKind { LiveWorkspace, Published, Unresolved }`. All DTOs plain (no mural, no OpenProject).
- Note: port the manifest read/write/classify/compareVersionsDesc from plexus-core `reference-editing-service.ts`; drop its `OpenProject`/`LiveValidationKey`/`IServiceProvider`/status-string usage; the UI host interface (`IReferenceHost`, `IReferenceView`, status strings) stays in plexus-core (Task 10).

- [ ] Step 1: Failing tests (FakeStorage with a project.plexus manifest + fake resolver exposing WorkspaceProducers/published): WriteReferences mutates+persists+invalidates+raises ReferencesChanged; Classify returns Live/Published/Unresolved correctly; versions sorted desc.
- [ ] Step 2: Run → fails.
- [ ] Step 3: Implement.
- [ ] Step 4: Tests pass; typecheck 0; full suite green; grep new file for mural/UI → none.
- [ ] Step 5: Commit `feat(solution-services): UX-free reference editor (catalog/write/classify)`.

### Task 5: todl — connection-selection ops

**Annex:** B hard-call 1 (ConnectionEditingService bag ops ENGINE); A §5 Connections/EffectiveConnectionIdForConsumer (ENGINE), §6 memberForConsumerId (ENGINE); C PART 2.

**Files:**
- Create: `TODL/src/solution-services/property-bags/connection-selection.ts` (`ConnectionSelection`)
- Test: `.../property-bags/tests/connection-selection.test.ts`

**Interfaces:**
- Produces (UX-free): `class ConnectionSelection` ctor `(manager, resolver)` with `SetSolutionDefault(spec): Promise<void>` (adopt a global connection at solution scope via BagCatalog), `SetActiveConnectionFor(member, connectionId): Promise<void>` (project-local `connection-selection` write), `ClearActiveFor(member): Promise<void>`, `EffectiveConnectionIdForConsumer(consumerId): Promise<string | undefined>` (resolve `SolutionBaseResolver.ConsumerIdOf` → member → effective connection via `ConnectionResolution`), `MemberForConsumerId(consumerId): SolutionMember | undefined`. No mural, no `IConnectionsClient` (the global inventory stays app-side in the UI layer).

- [ ] Step 1: Failing tests (fake BagVantage/BagCatalog + resolver): SetActiveConnectionFor writes selection; EffectiveConnectionIdForConsumer resolves via ConsumerIdOf; clear removes.
- [ ] Step 2: Run → fails.
- [ ] Step 3: Implement (port ConnectionEditingService bag ops; drop ConnectionLeafView/ConnectionHealth/status strings/IConnectionsClient → those stay UI, Task 10).
- [ ] Step 4: Tests pass; typecheck 0; full suite green.
- [ ] Step 5: Commit `feat(solution-services): UX-free connection-selection ops`.

### Task 6: todl — project lifecycle outcomes (Create/Open/Close/Restore) + events

**Annex:** A §5 CreateProject/RestoreSession, §6 openProjectAt/createProjectAt/validateNewProject/closeProject/raiseLifecycleEvent; §7 seams 2,5; C PART 2 "CreateProject orchestration (NEW)", existing SolutionManagerService OpenProject/CloseProject.

**Files:**
- Modify: `TODL/src/solution-services/solution-manager/engine/solution-manager-service.ts`
- Create: `.../engine/project-lifecycle.ts` (`ProjectLifecycle` + outcome types) if the service file would grow unwieldy.
- Test: `.../engine/tests/project-lifecycle.test.ts`

**Interfaces:**
- Produces (UX-free): `type CreateProjectSpec = { type: ProjectType; name: string; location: string; bindings: BaseBindings }`; `type CreateOutcome = { created: true; member: SolutionMember; folder: string } | { created: false; error: CreateError }`; `enum CreateError { FolderHasManifest, NoFactory, Invalid }`. Methods: `CreateProject(spec): Promise<CreateOutcome>` (validate via a ported `validateNewProject` returning a typed error, mkdir unique subfolder, `factory.createProject`, `manager.OpenProject`, recents add, raise `Created`), `OpenProjectAt(folder): Promise<OpenOutcome>` (dedupe, `manager.OpenProject`, recents, raise `Opened`), `CloseProject(member, guard?: ICloseGuard): Promise<boolean>` (await `guard.CanClose`, then `manager.CloseProject` + session-store removal, raise `MemberRemoved`), `RestoreSession(): Promise<void>` (reopen persisted folders, prune missing manifests). `interface ICloseGuard { CanClose(member): Promise<boolean> }`. Add `ProjectEventKind.MemberRemoved`.
- Note: `CreateOutcome` shape replaces plexus-core `project-create-contract.ts` `CreateOutcome` (keep structurally identical for agent-chat, annex A §5).

- [ ] Step 1: Failing tests: CreateProject into empty folder → created + Created raised + member added; into folder-with-manifest → `{created:false,error:FolderHasManifest}`; CloseProject with guard returning false → not closed; RestoreSession reopens stored, prunes missing.
- [ ] Step 2: Run → fails.
- [ ] Step 3: Implement.
- [ ] Step 4: Tests pass; typecheck 0; full suite green; `engine-boundary.test.ts` still green.
- [ ] Step 5: Commit `feat(solution-services): UX-free project lifecycle outcomes + MemberRemoved event`.

### Task 7: todl — boundary guard + release

**Files:** extend `TODL/src/solution-services/.../tests/engine-boundary.test.ts`; `TODL/package.json` + lock.

- [ ] Step 1: Extend engine-boundary test to assert the new files (member-content-ops, member-project-ops, reference-editor, connection-selection, project-lifecycle, unique-name) import no mural/UI module. Run → it should already pass if Tasks 1–6 were pure; if it fails, FIX the offending import (do not weaken the test).
- [ ] Step 2: `npm run typecheck` 0 + `npm test` green (gate).
- [ ] Step 3: Bump todl version (minor), commit `release: todl vX.Y.0 (member-ops + lifecycle outcomes for PE retirement)`, 2 lock fields only.
- [ ] Step 4: `git push origin main`; `npm publish`; verify `npm view @pragmatic-tech-ai/todl@X.Y.0 version --registry https://npm.pkg.github.com`.

---

## PART 2 — plexus-core solution-explorer (UI consolidation). Branch `pe-retirement`.

### Task 8: plexus — adopt new todl; relocate `IContentMutations`; repoint contributors

**Annex:** B hard-call 2 (IContentMutations → UI, relocate); C seam 2; A §2.

**Files:**
- Modify: `apps/plexus/package.json` + `packages/plexus-core/package.json` (todl → ^X.Y.0); `npm install`.
- Move: `packages/plexus-core/src/renderer/modules/project-explorer/services/content-mutations.ts` → `.../solution-explorer/services/content-mutations.ts` (drop `ContentMutationsKey` — dead); repoint the 3 contributors (`build-contributor.ts`, `file-tree-contributor.ts`, `project-actions-contributor.ts`) + their 3 tests to the new path.
- Test: existing contributor tests must stay green.

- [ ] Step 1: branch `pe-retirement`; bump todl range both package.json; `npm install`; verify workspace symlinks intact + todl version.
- [ ] Step 2: `git mv` content-mutations.ts into solution-explorer/services; delete `ContentMutationsKey`; repoint the 3 contributors + 3 tests' imports (`../../project-explorer/services/content-mutations.js` → `./content-mutations.js`).
- [ ] Step 3: `npm run -w @pragmatic-tech-ai/plexus-core build` + plexus-core test (contributor tests green).
- [ ] Step 4: Commit `refactor(solution-explorer): relocate IContentMutations, drop dead ContentMutationsKey, adopt todl X.Y.0`.

### Task 9: plexus — new UI `SolutionWorkspaceService` implementing `IContentMutations` over engine ops

**Annex:** A groups C/D/E/F/G UI sides + §7 all seams; B (IContentMutations UI wrapper, MemberProjection DROP); C "delegates to ProjectExplorerService today".

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-workspace-service.ts` (`SolutionWorkspaceService implements IContentMutations`, implements the engine `IContentLifecycleGuard` + `ICloseGuard`)
- Create: `.../services/doc-ownership.ts` (the member+path → open-doc map, ported from docOwners/docPaths)
- Test: `.../services/tests/solution-workspace-service.test.ts`

**Interfaces:**
- `SolutionWorkspaceService` wraps `MemberContentOps`/`MemberProjectOps`/`ReferenceEditor`/`ConnectionSelection`/lifecycle (Tasks 2–6) per member: each `IContentMutations` method = engine op + UI (confirm dialog via DialogService, tab close/repoint via DocOwnership, NewFileParticipant orchestration for NewFile, SetVersion dialog, ManageReferences dialog). Implements `IContentLifecycleGuard.CanRemove` (dirty-tab confirm + close), `.OnMoved`/`.OnRemoved` (repoint/close tabs), and `ICloseGuard.CanClose` (DocumentCloseGuard). Provides `OpenMemberFile/OpenPath/OpenFileInProject/FindOpenCodeDocByOsPath` (doc layer). Keeps status as structured state or drops it (no dormant panel reads it — annex A headline 5).
- Publish orchestration stays in `BuildContributor` (annex §7 seam 4), which calls engine `BuildService.Publish` + the UI BackgroundWork/Problems it already has.

- [ ] Step 1: Failing tests mirroring the kept behaviors from the 1911-line app test (annex C PART 4) relevant to mutation+docs: delete confirms then closes tabs before engine delete; rename repoints open tab; new file runs participant (veto deletes); close member runs dirty guard. Use fakes for DialogService/ContentHost/engine ops.
- [ ] Step 2: Run → fails.
- [ ] Step 3: Implement `SolutionWorkspaceService` + `doc-ownership.ts` (port UI sides of groups D/E/F/G; the engine cores are now called, not re-implemented).
- [ ] Step 4: Tests pass; plexus-core build + test green.
- [ ] Step 5: Commit `feat(solution-explorer): SolutionWorkspaceService (IContentMutations over engine ops) + doc-ownership`.

### Task 10: plexus — reference/connection UI views + dialog resources + wire solution-explorer

**Annex:** B hard-call 1 (UI sides: IReferenceHost/IConnectionHost, ConnectionLeafView, status, views); A §5 References/Connections, I (New-project form, commands); C seam 1, PART 1 resources.

**Files:**
- Move/adapt: reference/connection UI (keep `IReferenceView`/`IConnectionView` in solution-explorer where they already live; add thin host adapters over `ReferenceEditor`/`ConnectionSelection`); New/Open project commands + `NewProjectFormFor`/`applyPrefill` into `SolutionWorkspaceService` or a `ProjectCommandsService` in solution-explorer.
- Move: `project-explorer/project-explorer.resources.mu` dialog templates → `solution-explorer/` (a new `solution-dialogs.resources.mu`), EXCEPT `ConfirmDialogModel` which stays shared (verify save-prompt still resolves it).
- Modify: `solution-explorer-service.ts` — resolve `SolutionWorkspaceService` instead of `ProjectExplorerService`; pass it as `IContentMutations`/reference view/connection view; `OpenProjectCommand`/`NewProjectCommand`/`OpenMemberFile` from the new service.
- Test: solution-explorer-service.test.ts updated (FakeExplorer → FakeWorkspace); dialog resources compile.

- [ ] Step 1: Failing test — solution-explorer-service resolves SolutionWorkspaceService and exposes Open/New commands + references/connections views (update the existing test's fake).
- [ ] Step 2: Run → fails.
- [ ] Step 3: Implement (host adapters, command service, move resources, rewire solution-explorer-service). Keep ConfirmDialogModel shared.
- [ ] Step 4: plexus-core build (compile:mu clean) + test green; verify save-prompt dialog still resolves ConfirmDialogModel.
- [ ] Step 5: Commit `feat(solution-explorer): own project commands + reference/connection views + dialog resources`.

### Task 11: plexus — LiveValidation Members-subscriber (replaces projection side effects)

**Annex:** A group A re-home list, §8 LiveValidation lifecycle risk; Review Focus "LiveValidation continuity".

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/live-validation-sync.ts` (`LiveValidationSync`)
- Test: `.../services/tests/live-validation-sync.test.ts`

**Interfaces:**
- `LiveValidationSync` subscribes to `SolutionManagerService.ActiveSolution.Members` (CollectionChange) and calls `LiveValidationKey` Attach on add, Detach on remove, and `RefreshBases`/Resync on rescan + on the engine `ReferencesChanged`/content events. Replaces the Attach/Detach/Resync the old projection loop did.

- [ ] Step 1: Failing test — adding a member Attaches, removing Detaches, ReferencesChanged triggers RefreshBases (fake LiveValidation + fake manager with an ObservableCollection of members).
- [ ] Step 2: Run → fails.
- [ ] Step 3: Implement; register in solution-explorer module.
- [ ] Step 4: plexus-core build + test green.
- [ ] Step 5: Commit `feat(solution-explorer): LiveValidation sync over Solution.Members`.

---

## PART 3 — consumer migration (apps/plexus + core)

### Task 12: migrate `OpenProjects` consumers to engine `Members`

**Annex:** A §5 OpenProjects row (consumer list), C PART 3(c) + "usage patterns"; decision: migrate to Members, delete OpenProject VM.

**Files (each a sub-step; one commit for the batch, or split if a consumer needs real logic):**
- `apps/plexus/.../window/plexus-title-source.ts`, `services/wiki/wiki-locator.ts`, `services/file-watch/file-watch-service.ts`, `services/file-watch/project-rescan-service.ts`, `modules/diagram/services/diagram-panel-services.ts`, `modules/architecture-projects/services/{arch-model-gateway,arch-diagram-binding-service,architecture-model-service}.ts`, `services/workspace/workspace-refresh-service.ts` + their tests.

**Interfaces:**
- Replace `explorer.OpenProjects` (ObservableCollection<OpenProject>, read+Subscribe) with `manager.ActiveSolution.Members` (+ `member.Storage`/`member.Project`/`member.Ref.path`/`member.Factory`). Where a consumer used `op.Project.RootPath`, use `member.Project?.RootPath ?? member.Ref.path`. Subscriptions move to the Members CollectionChange + ActiveSolution change.

- [ ] Step 1: For each consumer, update its test first to inject a fake `SolutionManagerService` with a Members collection instead of a fake explorer (TDD: red).
- [ ] Step 2: Run the affected tests → fail.
- [ ] Step 3: Migrate each consumer to Members; delete OpenProject usage.
- [ ] Step 4: All affected tests + plexus build/typecheck green.
- [ ] Step 5: Commit `refactor: migrate OpenProjects consumers to SolutionManager Members`.

### Task 13: migrate remaining seam consumers

**Annex:** A §5 rows ProjectedOpFor/OpenPath/OpenFileInProject/RefreshProjects/EffectiveConnectionIdForConsumer/CreateProject/NewProjectFormFor/CreateOutcome; C PART 3(c).

**Files:** `modules/architecture-projects/services/{arch-action-contributor,arch-node-command-contributor,arch-navigation-service}.ts`, `modules/diagram-export/services/diagram-export-action-contributor.ts`, `modules/problems/problems-service.ts`, `services/file-watch/editor-reload-service.ts`, `services/projects/storage-service-backends.ts`, `modules/agent-chat/services/{chat-sessions-service,new-project-card,template-gallery-service}.ts`, `modules/connections/connection-editor-launcher.ts` + tests.

**Interfaces:**
- `ProjectedOpFor`/`OpenPath`/`OpenFileInProject`/`FindOpenCodeDocByOsPath` → `SolutionWorkspaceService` (Task 9) keyed by member+path. `RefreshProjects` → engine `MemberProjectOps.RefreshBases`/resolver.Invalidate + the file-watch call site. `EffectiveConnectionIdForConsumer` → engine `ConnectionSelection` (Task 5). `CreateProject`/`NewProjectFormFor`/`CreateOutcome` → `SolutionWorkspaceService`/`ProjectCommandsService` + engine `CreateProject` outcome. `.Connections` (launcher) → the new connection view.

- [ ] Step 1: Update each consumer's test (red).
- [ ] Step 2: Run → fail.
- [ ] Step 3: Repoint each consumer to its new home.
- [ ] Step 4: Affected tests + build/typecheck green.
- [ ] Step 5: Commit `refactor: migrate PE seam consumers (arch/diagram/problems/agent-chat/connections) to new homes`.

### Task 14: rewire composition (main.js, app.mu, menu bar)

**Annex:** C PART 3(a); A §2.

**Files:** `apps/plexus/src/renderer/src/main.js`, `.../app.mu`, `.../window/plexus-window.resources.mu`.

- [ ] Step 1: `main.js` — remove ProjectExplorerService import, `ProjectTreeHostKey` registration (annex A §8: only read by dead skills path — verify, then drop the key or leave registered to the new service only if still read), `OpenFileInProject` call → SolutionWorkspaceService, `Start()`/`RestoreSession()` → engine `RestoreSession` (Task 6) + `LiveValidationSync` start. `app.mu` — remove `ProjectExplorerModule` from `.modules:` + its import; remove `ProjectExplorerResources` merge → merge the moved `solution-dialogs.resources.mu`. `plexus-window.resources.mu` — `$service(ProjectExplorerService).New/OpenProjectCommand` → the new command service.
- [ ] Step 2: plexus-core build + app compile:mu + typecheck:node/web.
- [ ] Step 3: Run full app test suite (menu-binding test, solution-explorer tests) → green.
- [ ] Step 4: Commit `refactor(app): compose solution-explorer workspace + engine lifecycle; drop ProjectExplorer composition`.

---

## PART 4 — deletion

### Task 15: delete project-explorer; relocate/split tests; drop exports; icon + follow-up; final gate

**Annex:** B (index/module DROP), C PART 3(b)+(d)+PART 4, A §8.

**Files:**
- Delete: the entire `packages/plexus-core/src/renderer/modules/project-explorer/` folder (service + member-projection + reference/connection-editing + saving-bag-persister + project-create-contract + index + .module.mu + .resources.mu + services/tests).
- Delete (if now unused — verify by grep): `renderer/projects/` legacy `OpenProject`, `Project`/`ProjectNode` VM, `project-tree-host.ts` (IProjectTreeHost), the legacy tree behaviors (project-tree-template-behavior, tree-selection-behavior, tree-drag-drop-behavior), `member-projection`'s VM deps, `node-move.ts` (ported to engine Task 2).
- Modify: `packages/plexus-core/package.json` — remove `./renderer/modules/project-explorer` + `/*` exports.
- Relocate tests: the 1911-line `apps/plexus/.../modules/project-explorer/tests/project-explorer-service.test.ts` → split into solution-explorer workspace tests (kept behaviors) + delete the projection/legacy/OpenProject parts; `project-lifecycle-events.test.ts` → `TODL/.../project-services/generators/tests/` (engine behavior). Delete `apps/plexus/.../modules/project-explorer/` dir.
- Icon: `@ProjectExplorer` in `plexus-icons.mu` is still referenced by `solution-explorer.module.mu` — keep the icon, just ensure no dangling ref; update `e2e/connector-save.spec.ts:261` comment.
- Follow-up: file a GitHub issue (pragmatic-tech-ai/plexus) "Cross-member drag/move: add engine-side move op" (the dropped capability, decision 2).

- [ ] Step 1: Grep-verify nothing imports `project-explorer` or the legacy VM/tree-host/behaviors anymore (repo-wide, non-dist). Any remaining hit → fix its consumer first.
- [ ] Step 2: Delete the folder + newly-dead legacy files; drop package.json exports; relocate/split the two app tests.
- [ ] Step 3: FULL GATE both repos: plexus-core build (tsc 0 + compile:mu), plexus typecheck:node/web 0, plexus-core test, apps/plexus test — all green. `git grep -i project-explorer` returns only intentional history/comments.
- [ ] Step 4: File the cross-member-move follow-up issue; note its number in the commit.
- [ ] Step 5: Commit `refactor: delete project-explorer module entirely (retirement complete)`.
- [ ] Step 6: Merge `pe-retirement` → main, push (final integration).
