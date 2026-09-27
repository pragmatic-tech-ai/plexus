# Wave 3b — Plexus adopts TODL solution-services — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plexus adopt TODL solution-services wholesale — `ProjectExplorerService` becomes a projection of `SolutionManagerService.ActiveSolution.Members`, `WorkspaceBaseResolver` is deleted in favor of `SolutionBaseResolver`, and the language client is driven by the `StaleMemberIds` push (the merged W3c) — on top of a TODL 0.38.1 that flattens the live base closure.

**Architecture:** One TODL patch (0.38.1, component A) then a five-part Plexus adoption. Plexus already depends on `@pragmatic-tech-ai/todl`; `SolutionManagerService.Key`, `PackageStoreKey`→`PlexusPackageStore`, and `SolutionBaseResolver.Key` (via the composer) are already registered in the renderer but dormant/disconnected. This wave wires them together.

**Tech Stack:** TypeScript. TODL: `node:test`/`node:assert/strict`. Plexus: `vitest`, mural DI (`ServiceKey`/`IServiceContainer`), `MuralBase`/`Observable`.

**Spec:** `docs/superpowers/specs/2026-09-27-w3b-solution-adoption-design.md`

## Global Constraints

- **OOP, no free functions / module state** (existing test-helper free functions may follow the nearest local precedent).
- **Allman braces**; **no inline reused/user-facing string literals** (hoist to `private static readonly` / message-builder methods); **PascalCase** public methods + interfaces; **VMs extend `Observable`** unless they need dependency properties (`OpenProject` stays `MuralBase`); **enums over string-literal unions**; **tests in `tests/` subfolders**.
- **TODL host-free** (component A): no Plexus/mural/node imports; published lookups via `inner()`.
- **Plexus:** NEVER `npm install`. Refresh `@pragmatic-tech-ai/todl` in `node_modules` via the scratchpad `refresh-todl.sh` (pack the worktree → extract into `node_modules`). Run `npm run build:core` before any Plexus `typecheck`/`test`. TODL tests `node:test`; Plexus tests `vitest`.
- **Merge/publish/push are norms-gated** — the 0.38.1 publish (after Task 1) and any push pause for the controller to confirm with the user.

## Review Focus

- **Close cancelled by the save-guard** — `DocumentCloseGuard.TryCloseDocument` returns Cancel on a dirty doc: the project stays open, the member is NOT removed, `CloseProject` is NOT called. → Task 4.
- **`RestoreSession` with a persisted folder whose manifest is missing/unreadable** — prune the `OpenProjectsStore` entry, create no member. → Task 4.
- **`OpenProject` dedupe** — re-opening an already-open folder creates no second member/VM. → Tasks 3/4.
- **`StaleMemberIds` fires for an id with no open/registered storage** — the language-client handler no-ops, does not throw. → Task 6.
- **Boot order** — `SolutionBaseResolver` and the language-client `StaleMemberIds` subscription are established after the ambient-solution wiring; `RestoreSession` runs after the `Members` subscription is live. → Tasks 2/6.

## File Structure

- TODL worktree `src/solution-services/solution-manager/engine/solution-base-resolver.ts` (+ tests) — Task 1.
- Plexus `apps/plexus/src/renderer/src/main.js` — Tasks 2, 5, 6 (wiring/boot order).
- Plexus new `apps/plexus/src/renderer/src/services/projects/renderer-package-source.ts` — Task 2.
- Plexus `packages/plexus-core/src/renderer/modules/project-explorer/services/project-explorer-service.ts` (+ tests) — Task 4.
- Plexus `packages/plexus-core/src/renderer/projects/capabilities/base-resolver.ts` — Task 5.
- Plexus delete `apps/plexus/src/renderer/src/services/projects/workspace-base-resolver.ts` (+ its tests) — Task 5.
- Plexus `apps/plexus/src/renderer/src/services/todl/todl-language-client.ts` (+ tests) — Task 6; the arch/direct consumers — Task 5.

---

## Task 1: TODL 0.38.1 — flatten the live base closure

**Working dir:** `C:/Users/Eugene/Projects/architecture-agent/TODL/.claude/worktrees/build-modules`, on a fresh branch off `main` (v0.38.0, 60fbd8f).
**Files:** `src/solution-services/solution-manager/engine/solution-base-resolver.ts`; `src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts`.

**Interfaces:**
- Consumes: existing `resolveBindingsInto`/`resolveOneBase`/`resolvePublishedBase`/`tagOrigin`/`liveProducerFor`/`liveProducerOfKind` from W3a.
- Produces: `ResolveBasesFor` that, for an open producer, returns the producer's own doc **plus its transitive live bases**, deduped so a live diamond resolves once.

- [ ] **Step 1: Write failing tests** — append to `tests/solution-base-resolver.test.ts` (reuse `Fixtures`):
```ts
test('ResolveBasesFor surfaces an open producer\'s transitive live bases (two-level live chain)', async () =>
{
    // consumer → open library L → open meta-model M ; M's nodes must appear in the closure.
    const consumer = Fixtures.Storage(Fixtures.LibraryFiles('c', 'L', '1.0.0', 'C', 'Gadget'))
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'M', type: 'meta-model', storage: Fixtures.Storage(Fixtures.MetaModelFiles('M', '1.0.0', 'Widget')) },
            { id: 'L', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryFiles('L', 'M', '1.0.0', 'Gadget', 'Widget')) },
        ]),
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { bases, originOf } = await resolver.ResolveBasesFor(consumer)
    assert.ok(bases.some((b) => b.nodes.some((n) => n.id === 'Gadget')))  // L (direct)
    assert.ok(bases.some((b) => b.nodes.some((n) => n.id === 'Widget')))  // M (transitive live)
    assert.equal(originOf.get('Widget')!.kind, WikiOriginKind.OpenProject)
})

test('ResolveBasesFor resolves a live diamond once (no duplicate, no cyclic problem)', async () =>
{
    // C binds A and B; both bind D (all open). D compiled/pushed once.
    const consumer = Fixtures.Storage(Fixtures.consumerBindingLibraries?.('c', ['A', 'B']) ?? Fixtures.TwoLibraryConsumer('c', 'A', 'B'))
    const provider = Fixtures.Provider(
        Fixtures.Manager([
            { id: 'D', type: 'library', storage: Fixtures.Storage(Fixtures.MetaModelFiles('D', '1.0.0', 'Dnode')) },
            { id: 'A', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryOnLibraryFiles('A', 'D', '1.0.0', 'Anode', 'Dnode')) },
            { id: 'B', type: 'library', storage: Fixtures.Storage(Fixtures.LibraryOnLibraryFiles('B', 'D', '1.0.0', 'Bnode', 'Dnode')) },
        ]),
        Fixtures.Published({}),
    )
    const resolver = new SolutionBaseResolver(provider)
    const { bases, problems } = await resolver.ResolveBasesFor(consumer)
    assert.equal(problems.filter((p) => /cyclic/.test(p)).length, 0)
    assert.equal(bases.filter((b) => b.nodes.some((n) => n.id === 'Dnode')).length, 1)  // deduped
})
```
The diamond test needs a consumer fixture that binds two libraries; add a `Fixtures.TwoLibraryConsumer(id, libA, libB)` helper (a `project.plexus` with `libraries: [{id:libA,version:'1.0.0'},{id:libB,version:'1.0.0'}]` + a trivial `.todl`). Adjust `MetaModelFiles`/`LibraryOnLibraryFiles` usage so the concepts compile (D declares `Dnode`; A/B extend it). Also add the deferred **versionless-producer** assertion to the existing `WorkspaceProducers` test (a member with `packageVersion` absent is skipped).

- [ ] **Step 2: Run, verify failure** — `npx tsx --test src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts` — the two-level and diamond tests FAIL (transitive live base absent / duplicated).

- [ ] **Step 3: Implement** — in `solution-base-resolver.ts`:
  - Thread a `seenLive: Set<IStorage>` through `resolveBindingsInto`/`resolveOneBase` (alongside `path`/`seenPub`), created once in `ResolveBasesFor`.
  - In `resolveOneBase`'s live-success branch, before `return`: if `seenLive` already has `producer.storage`, `return` (diamond already contributed); else add it, then after pushing the producer's own `model.package.document`, also `for (const b of child.bases) bases.push(b)` and merge `child.originOf` into `originOf` via the first-writer-wins rule (reuse the `tagOrigin` idiom: only set a node id not already present). `child` is the already-computed `resolveBindingsInto(producer.storage, producer.manifest, path, seenPub, seenLive)` result.
  - Inline `liveProducerOfKind` at its call site(s) (call `liveProducerFor` directly, keeping the explanatory comment about the kind-agnostic match).

- [ ] **Step 4: Run, verify green** — the file passes (existing + new), pristine output.

- [ ] **Step 5: Full TODL suite** — `npm test` — expect the 1335 baseline + the new tests, 0 fail.

- [ ] **Step 6: Commit**
```bash
git add src/solution-services/solution-manager/engine/solution-base-resolver.ts src/solution-services/solution-manager/engine/tests/solution-base-resolver.test.ts
git commit -m "fix(resolver): ResolveBasesFor flattens the transitive live base closure (seenLive dedup)"
```

### Release 0.38.1 (after Task 1 review is clean — norms-gated, controller confirms with the user)

Bump `0.38.0`→`0.38.1`; commit `chore(release): v0.38.1`; FF TODL `main`; `npm publish --userconfig "<TODL main>/.npmrc"`; tag `v0.38.1`; push main+tag. Then in Plexus: bump the three `@pragmatic-tech-ai/todl` deps `^0.38.0`→`^0.38.1` (packages/plexus-core, apps/plexus, apps/devUI) and run `refresh-todl.sh` so `node_modules` holds 0.38.1. This unblocks Tasks 2–6.

---

## Task 2: Wire `SolutionManagerService` live in the Plexus renderer

**Files:** `apps/plexus/src/renderer/src/main.js`; new `apps/plexus/src/renderer/src/services/projects/renderer-package-source.ts`; test `apps/plexus/src/renderer/src/tests/solution-manager-wiring.test.ts` (new).

**Interfaces:**
- Consumes: `SolutionStudioSeams.Register(services)` (plexus-core) → registers `PromptServiceKey`→`DialogPromptService`, `StorageRegistryKey`→`StorageService`. `SolutionManagerService.PackageSourceKey` (`'SolutionPackageSource'`), `SolutionManagerService.Key`.
- Produces: a resolvable, constructable `SolutionManagerService` in the renderer whose `OpenProject(folder)` opens a project as an ambient-solution member.

- [ ] **Step 1: Write the failing test** — `tests/solution-manager-wiring.test.ts` composes the renderer's solution wiring against fakes and asserts `SolutionManagerService.OpenProject` works end to end. Use the app's existing composition-test pattern (`apps/plexus/src/renderer/src/tests/project-system-composition.test.ts`) as the harness model. Register: `TodlProjectSystemModule` (gives `ProjectFactoryRegistryKey` + `SolutionBaseResolver`), `SolutionServicesEngine` (gives `SolutionManagerService.Key`), a fake `StorageService`/`DialogService`, `SolutionStudioSeams.Register`, and the new `RendererPackageSource`. Then:
```ts
const mgr = app.Services.getRequired(SolutionManagerService.Key)
// seed a project.plexus at a fake folder via the fake storage registry
const member = await mgr.OpenProject('/work/proj')
expect(mgr.ActiveSolution?.HasLocation).toBe(false)     // ambient untitled
expect(member.IsResolved).toBe(true)
expect(mgr.ActiveSolution?.Members.ToArray().length).toBe(1)
```

- [ ] **Step 2: Run, verify failure** — `npm run build:core && npx vitest run apps/plexus/src/renderer/src/tests/solution-manager-wiring.test.ts` — fails (`PromptServiceKey`/`PackageSourceKey` unregistered → `getRequired` throws in the `SolutionManagerService` ctor).

- [ ] **Step 3: Implement**
  - Create `RendererPackageSource` — a small class implementing the `PackageSource` shape `SolutionManagerService.PackageSourceKey` expects (a `resolve(ref)` over the published packages backend; the ambient flow doesn't call `Compose`, so a minimal published-package-backed resolver suffices). Hoist any literal ids to `private static readonly`. Confirm the exact `PackageSource` interface from `@pragmatic-tech-ai/todl` (`domain/domain`) and match it.
  - In `main.js`, before the service is resolved: `SolutionStudioSeams.Register(app.Services)`; `app.Services.register(SolutionManagerService.PackageSourceKey, (p) => new RendererPackageSource(p))`. Then resolve `SolutionManagerService.Key` once so its `ActiveSolution` chain is live before `RestoreSession` (Task 4).

- [ ] **Step 4: Run, verify green** — the wiring test passes.

- [ ] **Step 5: Commit**
```bash
git add apps/plexus/src/renderer/src/main.js apps/plexus/src/renderer/src/services/projects/renderer-package-source.ts apps/plexus/src/renderer/src/tests/solution-manager-wiring.test.ts
git commit -m "feat(plexus): wire SolutionManagerService collaborators in the renderer"
```

---

## Task 3: `MemberProjection` — build/dispose an `OpenProject` from a `SolutionMember`

**Files:** new `packages/plexus-core/src/renderer/modules/project-explorer/services/member-projection.ts`; test `.../tests/member-projection.test.ts`. (Isolating the pure mapping from the service's sync loop keeps Task 4 focused.)

**Interfaces:**
- Produces: a `MemberProjection` class with `Build(member: SolutionMember): OpenProject` (resolve factory via `ProjectFactoryRegistryKey.factoryFor(member.Ref.type)`, `new OpenProject(member.Project as Project, factory, member.Storage!)`), and `FolderOf(member): string` (the dedupe/persist key = `member.Project`'s `RootPath`, or `member.Ref.path`). Wiring of commands/nodes stays in the service (Task 4) since it closes over service methods.

- [ ] **Step 1: Write the failing test** — `member-projection.test.ts`: given a fake `SolutionMember` (with a fake `Project`/`Storage`/`Ref.type`) and a fake factory registry, `Build` returns an `OpenProject` whose `Storage`/`Factory`/`Project` match, and `FolderOf` returns the project root path. Assert an unresolved member (no factory) is reported (throw or a typed skip — pick one and test it).

- [ ] **Step 2: Run, verify failure** — `npm run build:core && npx vitest run packages/plexus-core/src/renderer/modules/project-explorer/services/tests/member-projection.test.ts`.

- [ ] **Step 3: Implement** `MemberProjection` per the interface. Keep it a class (ctor takes `IServiceProvider` for the factory registry). No inline literals.

- [ ] **Step 4: Run, verify green.**

- [ ] **Step 5: Commit**
```bash
git add packages/plexus-core/src/renderer/modules/project-explorer/services/member-projection.ts packages/plexus-core/src/renderer/modules/project-explorer/services/tests/member-projection.test.ts
git commit -m "feat(explorer): MemberProjection maps a SolutionMember to an OpenProject"
```

---

## Task 4: `ProjectExplorerService` → `Members`-derived façade

**Files:** `packages/plexus-core/src/renderer/modules/project-explorer/services/project-explorer-service.ts`; tests `.../tests/project-explorer-service.test.ts` and `.../tests/project-lifecycle-events.test.ts` (extend).

**Interfaces:**
- Consumes: `SolutionManagerService.Key` (+ `.ActiveSolution.Members`, `.OpenProject`, `.CloseProject`), `MemberProjection` (Task 3).
- Produces: `OpenProjects` populated by the member sync; `openProjectAt`/`createProjectAt`/`closeProject`/`RestoreSession` delegating to the manager. External `OpenProjects` consumers unchanged.

- [ ] **Step 1: Write failing tests** (extend `project-explorer-service.test.ts`, harness with a fake `SolutionManagerService` exposing an `ObservableCollection<SolutionMember>` `Members` and stub `OpenProject`/`CloseProject`):
  - member added to `ActiveSolution.Members` → `OpenProjects` gains one wired `OpenProject` (has `Root` + `RefreshBasesCommand`), `LiveValidation.AttachProject` called, `openStore.Add` called;
  - member removed → `OpenProjects` loses it, `DetachProject` + `openStore.Remove` called;
  - dedupe: adding a member for an already-projected folder does not double-add (Review Focus #3);
  - `closeProject(op)` with a `DocumentCloseGuard` returning Cancel → `SolutionManagerService.CloseProject` NOT called, project stays (Review Focus #1);
  - `RestoreSession` with two persisted folders, one manifest missing → `OpenProject` called once, missing pruned from `openStore` (Review Focus #2).

- [ ] **Step 2: Run, verify failure** — `npm run build:core && npx vitest run .../tests/project-explorer-service.test.ts`.

- [ ] **Step 3: Implement**
  - Add a `MemberProjection` field and a `Map<SolutionMember, OpenProject>` (`projected`). In the ctor (or an init resolved at boot), get `SolutionManagerService.Key`; subscribe to `ActiveSolution.Members` collection changes and re-wire on `ActiveSolution` change (mirror `SolutionBaseResolver.rewireMembers`). On the current members, project each.
  - **onMemberAdded(member):** dedupe by folder against `projected`/`findByFolder`; `op = projection.Build(member)`; `wireProjectCommands(op)`; `wireNodes(op.Root, op)`; `OpenProjects.Add(op)`; `projected.set(member, op)`; `LiveValidation.AttachProject(op.Project.RootPath, op.Project.Name, op.Storage)`; `await openStore.Add(op.Folder)`.
  - **onMemberRemoved(member):** `op = projected.get(member)`; run the doc cleanup from the old `closeProject` body (docOwners/docPaths teardown — WITHOUT the save-guard, which now runs earlier in `closeProject`); `LiveValidation.DetachProject(op.Storage)`; `OpenProjects.Remove(op)`; `projected.delete(member)`; `await openStore.Remove(op.Folder)`.
  - Replace `addOpenProject` callers: `openProjectAt(folder)` → resolve nothing itself; `await manager.OpenProject(folder)` (dedupe still guarded by `findByFolder` up front to avoid a redundant call); keep `recents.Add` + `Opened` status. `createProjectAt(...)` → `factory.createProject(storage, name, bindings)` on disk (as today) then `await manager.OpenProject(folder)`.
  - `closeProject(op)` → run the existing `DocumentCloseGuard` loop FIRST; on cancel `return`; else `await manager.CloseProject(this.memberFor(op))` (look up the member from `projected` by identity/folder). The removal side effects happen in `onMemberRemoved`.
  - `RestoreSession()` → for each `openStore.List()` folder with an existing manifest, `await manager.OpenProject(folder)`; prune the rest (unchanged).
  - Delete the now-unused `addOpenProject`/direct `OpenProjects.Add`/`Remove` paths (the sync loop is the sole mutator).

- [ ] **Step 4: Run, verify green** — the extended explorer tests pass; then the whole file + `project-lifecycle-events.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add packages/plexus-core/src/renderer/modules/project-explorer/services/project-explorer-service.ts packages/plexus-core/src/renderer/modules/project-explorer/services/tests/
git commit -m "feat(explorer): derive OpenProjects from SolutionManagerService.Members"
```

---

## Task 5: Retire `WorkspaceBaseResolver`; reshape `IBaseResolver`; rebind consumers

**Files:** delete `apps/plexus/src/renderer/src/services/projects/workspace-base-resolver.ts` + `.../tests/workspace-base-resolver.test.ts`; `packages/plexus-core/src/renderer/projects/capabilities/base-resolver.ts`; `apps/plexus/src/renderer/src/main.js`; `project-explorer-service.ts` (the two `BaseResolverKey` call sites); direct consumers `todl-language-client.ts`, `arch-model-gateway.ts`, `architecture-model-service.ts`, `arch-diagram-binding-service.ts`.

**Interfaces:**
- `IBaseResolver` reshaped to: `WorkspaceProducers(kind: ProjectType): Promise<readonly DependencyRef[]>`, `ProducedIdOf(storage: IStorage): Promise<string | undefined>` (async). `RefreshDependentsOfIds` removed. `ProjectType`/`DependencyRef` import from `@pragmatic-tech-ai/todl`.
- `BaseResolverKey` binds directly to `SolutionBaseResolver` (structural match — it has both methods after W3a/Task 1).

- [ ] **Step 1: Write/adjust failing tests** — update the explorer test's `manageReferences`/`RefreshProjects` expectations to the async/`ProjectType` API and to `SolutionBaseResolver.Invalidate` (instead of `RefreshDependentsOfIds`); add/adjust arch-service + language-client tests to expect `ResolveBasesFor`/`ReferencedPublishedRefs` against `SolutionBaseResolver.Key`. Delete `workspace-base-resolver.test.ts`.

- [ ] **Step 2: Run, verify failure/red** — build:core + the touched vitest files (fail: methods renamed / interface changed).

- [ ] **Step 3: Implement**
  - Reshape `IBaseResolver` (base-resolver.ts) as above; delete `WorkspaceBaseResolver` + its test.
  - `main.js`: `register(BaseResolverKey, (p) => p.getRequired(SolutionBaseResolver.Key))` (import `SolutionBaseResolver` from `@pragmatic-tech-ai/todl`); remove the eager `WorkspaceBaseResolver` construction; ensure `SolutionBaseResolver` is resolved once at boot after Task 2 wiring.
  - `project-explorer-service.ts`: `manageReferences` uses `ProjectType.MetaModel`/`.Library` + `DependencyRef`; `RefreshProjects` awaits `ProducedIdOf` and calls `SolutionBaseResolver.Invalidate(producedId)` per changed producer (drop `RefreshDependentsOfIds`). Migrate `ProducerKind`/`BaseRef` usages here to `ProjectType`/`DependencyRef`.
  - Direct consumers → `SolutionBaseResolver.Key`: `todl-language-client.basesFor` → `ResolveBasesFor(storage)`; `arch-model-gateway`/`architecture-model-service` → `ResolveBasesFor`; `arch-diagram-binding-service` → `ReferencedPublishedRefs`. The `{bases,problems,originOf}` / `Set<string>` shapes are unchanged; `originOf`'s `WikiOrigin` is the re-exported TODL type.

- [ ] **Step 4: Run, verify green** — the touched files, then `npm run build:core && npm run typecheck` (catches any missed `ProducerKind`/`BaseRef`/`ResolveForStorage` reference).

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "refactor(plexus): retire WorkspaceBaseResolver; bind base resolution to SolutionBaseResolver"
```

---

## Task 6: `StaleMemberIds` push in the language client + `Invalidate` triggers

**Files:** `apps/plexus/src/renderer/src/services/todl/todl-language-client.ts` (+ tests); `apps/plexus/src/renderer/src/main.js` (subscription established at init).

**Interfaces:**
- Consumes: `SolutionBaseResolver.Key` (`.PropertyChanged('StaleMemberIds')`, `.StaleMemberIds`), `SolutionManagerService.ActiveSolution.Members` (to map a stale member id → storage).
- Produces: automatic coalesced editor refresh on `Invalidate`.

- [ ] **Step 1: Write failing tests** — with a fake `SolutionBaseResolver` (an `Observable` exposing `StaleMemberIds` + raising `PropertyChanged('StaleMemberIds')`) and a fake manager whose `Members` map ids→storages: raising `StaleMemberIds` with `{'mm','lib'}` drives the client to refresh exactly the `mm` and `lib` storages (assert `todl/refreshBases` sent + `baseCache` dropped for each); a stale id with no matching member storage is a no-op, no throw (Review Focus #4). Coalescing: two ids in one raise → one refresh pass per storage.

- [ ] **Step 2: Run, verify failure** — build:core + the language-client test file.

- [ ] **Step 3: Implement**
  - Add a `SubscribeToStaleMembers()` (called once at init) that subscribes to `SolutionBaseResolver.PropertyChanged('StaleMemberIds')`; the handler reads `resolver.StaleMemberIds`, maps each id to a member storage via `SolutionManagerService.ActiveSolution.Members` (match the member whose manifest/producer id equals the stale id — reuse `ProducedIdOf` or parse the manifest), dedupes storages, and runs the existing per-storage refresh (`baseCache.delete`, resolve bases, `todl/refreshBases`, `fireSemanticStale`). Guard: unknown id / no storage → skip.
  - `main.js`: call `SubscribeToStaleMembers()` after the client and `SolutionBaseResolver` are resolved (boot order — Review Focus #5).
  - Keep single-project manual `RefreshBases(storage)` (op.RefreshBasesCommand, pre-publish) as-is. Confirm the producer-change trigger sites now call `SolutionBaseResolver.Invalidate` (landed in Task 5) so the cascade flows through the subscription.

- [ ] **Step 4: Run, verify green** — the language-client tests; then full Plexus `vitest` (core + app + devUI) and `typecheck` after `build:core`.

- [ ] **Step 5: Commit**
```bash
git add apps/plexus/src/renderer/src/services/todl/todl-language-client.ts apps/plexus/src/renderer/src/main.js apps/plexus/src/renderer/src/services/todl/tests/
git commit -m "feat(plexus): language client refreshes editors from SolutionBaseResolver.StaleMemberIds"
```

---

## Final integration (after all tasks + whole-branch review)

Run the full Plexus suite (`npm run build:core` then `npm test` + `npm run typecheck` across workspaces) on the merged branch. Then finish per superpowers:finishing-a-development-branch (merge to Plexus `main`, push — norms-gated, confirm with the user). The TODL 0.38.1 release already happened after Task 1.

## Self-Review

- **Spec coverage:** A→Task 1(+release); B→Task 2; C→Tasks 3+4; D→Task 5; E→Task 6. Testing/sequencing covered. Nothing unassigned.
- **Review Focus:** close-guard cancel (Task 4 test), restore-missing-manifest (Task 4 test), dedupe (Tasks 3/4 tests), unknown-stale-id no-op (Task 6 test), boot order (Tasks 2/6 — main.js ordering + tests).
- **Type consistency:** `IBaseResolver` reshaped to `ProjectType`/`DependencyRef`/async `ProducedIdOf` (Task 5) matches `SolutionBaseResolver`'s W3a/Task-1 surface; `ResolveBasesFor`/`ReferencedPublishedRefs` shapes match the retired `ResolveForStorage`/`referencedPublishedRefs`; `StaleMemberIds` is the `ReadonlySet<string>` W3a raises; `OpenProject` façade preserves `op.Storage`/`Factory`/`Project`/`Folder`/`Name`.
- **Placeholder scan:** none — each task carries test skeletons + concrete deltas. Two explicit verification instructions (the `PackageSource` interface shape in Task 2; the current line numbers referenced from exploration) are checks, not deferrals. The big façade rework (Task 4) is specified as deltas against the mapped current methods rather than a full file reproduction, since it modifies a 1578-line existing file.
