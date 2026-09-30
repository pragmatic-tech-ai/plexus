# P6a — Scope-Based Property-Bag Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One settings mechanism — typed property bags persisted in any scope (global / solution / project-shared / project-local), addressed by kind+id+scope, with consumer-owned resolution — subsuming today's connection and solution-setting storage.

**Architecture:** Build on existing primitives (Mural `SettingDefinition`, TODL `SettingBagDefinition`, todl-runtime `IPropertyBag`/`MapPropertyBag`). Add: a storage-tier interface `IPropertyBagStore` with durable + transient impls (fixing `SessionStore`'s mislabel + dormant-wiring bugs), scope persisters over it, a catalog with consumer-owned resolution, connections-as-bags with secret-reference keys, and a subsume+migrate of the old layouts.

**Tech Stack:** TypeScript. todl-runtime (storage tiers), TODL (subsystem + manifest persisters, node:test + tsx), Plexus main/preload/renderer (Electron IPC + vitest), devUI. Mural untouched.

**Spec:** `Plexus/docs/superpowers/specs/2026-09-30-solution-hierarchy-p6a-property-bags-design.md`

## Global Constraints

- Secrets never enter a bag or cross IPC as values — a bag stores a `TokenSource` + reference key; the token is resolved from `EncryptedSecretStore`/`ConnectionTokenStore` by that key. Only `HasToken` booleans cross IPC.
- User-specific data never goes in the shareable project manifest — connection bags + selections use the gitignored `project.local.json` sidecar.
- House style (workspace CLAUDE.md): OOP no free functions/module vars; Allman braces; PascalCase interfaces + public methods; enums over string-literal unions; no inline string literals (hoist to `private static readonly`); tests in `tests/` subfolders.
- Latest packages: cross-repo bumps go to the newest published version.
- Commit attribution: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Cross-repo reality: todl-runtime is **junctioned** into TODL (rebuild todl-runtime dist → TODL sees it; no publish needed mid-dev). TODL is an **installed copy** in Plexus (publish TODL + bump pin + `npm install` to adopt). Per-wave: green + (for TODL) published before the next wave adopts. Push after each per "push and stop".
- Test runners: todl-runtime + TODL = `npx tsx --conditions=development --test "<path>"`; plexus-core/apps/devUI = `npx vitest run <path>` from the package dir. plexus-core dist must be rebuilt (`npm run build`) before apps/e2e see src changes.

## Review Focus

1. **Missing/corrupt bag document** (first run, hand-edit, partial migration) → empty bags + defaults, never a crash — pinned in Task 1, 5, 6, 7 (each read is defensive).
2. **Same-id instances at multiple scopes** → catalog returns all, distinctly addressed; a write to one scope never clobbers another — pinned in Task 9.
3. **Secret reference with no stored secret** (token file deleted / env unset) → `HasToken` false, resolution degrades, no throw — pinned in Task 10/16.
4. **Project-local sidecar vs shared manifest** → local bags never appear in the committed manifest — pinned in Task 7.
5. **Migration idempotence** → running the new build twice never double-migrates or drops a hand-added connection (`bagsVersion` guard) — pinned in Task 12.

---

# Wave 1 — todl-runtime (storage tiers)

### Task 1: `IPropertyBagStore` + `DurableApplicationStore`

**Files:**
- Create: `todl-runtime/src/property-bags/property-bag-store.ts`
- Create: `todl-runtime/src/property-bags/durable-application-store.ts`
- Create: `todl-runtime/src/property-bags/tests/durable-application-store.test.ts`
- Delete: `todl-runtime/src/session/session-store.ts` and its test
- Modify: `todl-runtime/src/index.ts` (swap exports)

**Interfaces:**
- Consumes: `IPropertyBag` (`property-bag.js`), `MapPropertyBag`, `ServiceBase`/`ServiceKey`/`IServiceProvider` (`services/*`), `EnvironmentKey` (`environment.js`), `StorageProviderKey` (`storage/storage-provider.js`), `IStorage`, `Disposable`.
- Produces:
  - `interface IPropertyBagStore { Register(key: string, bag: IPropertyBag): Disposable; Restore(): Promise<void>; Save(): Promise<void> }`
  - `class DurableApplicationStore extends ServiceBase implements IPropertyBagStore` (backing file `application-bags.json`)
  - `const DurableApplicationStoreKey = new ServiceKey<IPropertyBagStore>('DurableApplicationStore')`

- [ ] **Step 1: Write the failing test** — `durable-application-store.test.ts`

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider, FakeStorage, MapPropertyBag, type PropertyAccessor } from '../../index.js'
import { DurableApplicationStore, DurableApplicationStoreKey } from '../durable-application-store.js'

function bagOf(seed: Record<string, unknown>): { bag: MapPropertyBag; values: Record<string, unknown> }
{
    const values = { ...seed }
    const acc = new Map<string, PropertyAccessor>()
    for (const name of Object.keys(seed))
    {
        acc.set(name, { id: () => name, displayName: () => name, get: () => values[name], set: (v) => { values[name] = v } })
    }
    return { bag: new MapPropertyBag(acc), values }
}

function providerWith(storage: FakeStorage): ServiceProvider
{
    const p = new ServiceProvider()
    // EnvironmentKey.UserDataDirectory + StorageProviderKey.CreateStorage(dir) → storage
    p.registerInstance(/* EnvironmentKey */ ...envKey, { UserDataDirectory: '/data' } as never)
    p.registerInstance(/* StorageProviderKey */ ...storeKey, { CreateStorage: () => storage } as never)
    return p
}

test('DurableApplicationStore round-trips a registered bag across Save + a fresh Restore', async () =>
{
    const storage = new FakeStorage('/data')
    const a = new DurableApplicationStore(providerWith(storage))
    const { bag, values } = bagOf({ token: 'x', count: 1 })
    a.Register('k', bag)
    values.token = 'y'; values.count = 2
    await a.Save()
    // A fresh store over the same storage restores the persisted slice.
    const b = new DurableApplicationStore(providerWith(storage))
    const { bag: bag2, values: v2 } = bagOf({ token: '', count: 0 })
    b.Register('k', bag2)
    await b.Restore()
    assert.equal(v2.token, 'y')
    assert.equal(v2.count, 2)
})

test('a missing/corrupt document restores to empty, not a throw', async () =>
{
    const storage = new FakeStorage('/data')
    await storage.WriteText('application-bags.json', '{ not json')
    const a = new DurableApplicationStore(providerWith(storage))
    await assert.doesNotReject(a.Restore())
})
```

*(Resolve `envKey`/`storeKey` to the real `EnvironmentKey`/`StorageProviderKey` imports when writing — a Ruling if their registration shape differs.)*

- [ ] **Step 2: Run it — Expected: FAIL** (module not found)

Run: `npx tsx --conditions=development --test todl-runtime/src/property-bags/tests/durable-application-store.test.ts`

- [ ] **Step 3: Implement** — `property-bag-store.ts` (interface) and `durable-application-store.ts` (the current `SessionStore` body, renamed, `FileName = 'application-bags.json'`, doc corrected to "durable across sessions"). Copy `SessionStore`'s Register/Restore/Save/dispose/scheduleSave/capture/apply/load verbatim; rename class + key; change the file constant. Add both to `index.ts`; delete `session/session-store.ts` + its export.

- [ ] **Step 4: Run it — Expected: PASS** (both tests)

- [ ] **Step 5: Commit**

```bash
git add todl-runtime/src/property-bags todl-runtime/src/index.ts
git rm todl-runtime/src/session/session-store.ts todl-runtime/src/session/tests/session-store.test.ts
git commit -m "feat(runtime): DurableApplicationStore over IPropertyBagStore (was SessionStore)"
```

### Task 2: `TransientSessionStore`

**Files:**
- Create: `todl-runtime/src/property-bags/transient-session-store.ts`
- Create: `todl-runtime/src/property-bags/tests/transient-session-store.test.ts`
- Modify: `todl-runtime/src/index.ts`

**Interfaces:**
- Produces: `class TransientSessionStore extends ServiceBase implements IPropertyBagStore` (in-memory; `Save`/`Restore` are no-ops), `const TransientSessionStoreKey = new ServiceKey<IPropertyBagStore>('TransientSessionStore')`.

- [ ] **Step 1: Write the failing test**

```ts
test('TransientSessionStore keeps values within a run but a fresh instance restores nothing', async () =>
{
    const t = new TransientSessionStore(new ServiceProvider())
    const { bag, values } = bagOf({ tab: 'a' })
    t.Register('view', bag)
    values.tab = 'b'
    await t.Save()                         // no-op, no throw
    const t2 = new TransientSessionStore(new ServiceProvider())
    const { bag: bag2, values: v2 } = bagOf({ tab: 'z' })
    t2.Register('view', bag2)
    await t2.Restore()                     // no-op
    assert.equal(v2.tab, 'z')              // nothing persisted across instances
})
```

- [ ] **Step 2: Run — Expected: FAIL**
- [ ] **Step 3: Implement** — `Register` tracks the bag; `Save`/`Restore` resolve immediately; `dispose` clears. No storage.
- [ ] **Step 4: Run — Expected: PASS**
- [ ] **Step 5: Commit** `feat(runtime): TransientSessionStore (in-memory IPropertyBagStore)`

### Task 3: Publish todl-runtime + rebuild dist

- [ ] **Step 1:** `cd todl-runtime && npm test` → Expected: full suite green (session-store tests replaced).
- [ ] **Step 2:** `npm run build` (dist), then rebuild so TODL's junction resolves: Expected: BUILD_EXIT 0.
- [ ] **Step 3:** `npm version patch --no-git-tag-version && npm publish` → Expected: `+ @pragmatic-tech-ai/todl-runtime@<new>`.
- [ ] **Step 4: Commit** the version bump: `chore(runtime): publish <new> (property-bag stores)`.

---

# Wave 2 — TODL (subsystem + persisters)

### Task 4: Adopt todl-runtime + re-point `SolutionManagerService` off `SessionStoreKey`

**Files:**
- Modify: `TODL/package.json` (bump todl-runtime pin), `TODL/src/solution-services/solution-manager/engine/solution-manager-service.ts:~10,~117-123`

**Interfaces:**
- Consumes: `DurableApplicationStoreKey`, `IPropertyBagStore` (todl-runtime).

- [ ] **Step 1:** Bump the todl-runtime pin to the new version; the junction already resolves the source. Run the current solution-manager test — Expected: FAIL to import `SessionStoreKey` (removed).
- [ ] **Step 2: Implement** — replace `SessionStoreKey` import with `DurableApplicationStoreKey`; change `provider.get(SessionStoreKey)?.Register(...)` to `provider.get(DurableApplicationStoreKey)?.Register(...)`. No behavior change (still optional).
- [ ] **Step 3:** Run `npx tsx --conditions=development --test "TODL/src/solution-services/solution-manager/engine/tests/*.test.ts"` — Expected: PASS.
- [ ] **Step 4: Commit** `refactor(todl): adopt DurableApplicationStore key in SolutionManagerService`

### Task 5: `BagScope`/`ProjectStore`/`BagAddress` + `IBagPersister`

**Files:**
- Create: `TODL/src/solution-services/property-bags/bag-address.ts`, `bag-persister.ts`
- Create: `TODL/src/solution-services/property-bags/tests/bag-address.test.ts`

**Interfaces:**
- Produces: `enum BagScope {Global,Solution,Project}`, `enum ProjectStore {Shared,Local}`, `interface BagAddress {Scope; Kind; Id; ProjectStore?}`, `interface IBagPersister { Scope: BagScope; Ids(kind): readonly string[]; Bag(kind,id): IPropertyBag; Create(kind,id): IPropertyBag; Delete(kind,id): void }`, `static BagAddress.Key(a): string` (`\`${scope}:${projectStore ?? ''}:${kind}:${id}\``).

- [ ] Steps: test `BagAddress.Key` round-trips distinct scopes/kinds/ids into distinct keys and equal ones into equal keys → implement enums + interfaces + the static `Key` → commit `feat(todl): bag addressing + persister contract`.

### Task 6: `SolutionBagPersister` (solution.json `bags` section)

**Files:**
- Create: `TODL/src/solution-services/property-bags/solution-bag-persister.ts` + test.
- Modify: `TODL/src/solution-services/solution-manager/engine/solution.ts` — add a `Bags: Record<kind, Record<id, Record<name,value>>>` section alongside `CollectSettings()` in the serialized document; `LoadSettings` counterpart reads it.

**Interfaces:**
- Consumes: `IBagPersister`, `Solution`, `MapPropertyBag`.
- Produces: `class SolutionBagPersister implements IBagPersister` (Scope=Solution) over a `Solution`'s bags section.

- [ ] Steps: test that `Create('npm-connection','a')` + `SetValue` persists through the solution's serialized `bags` and reloads (round-trip over `FakeStorage`); a missing `bags` section reads empty. Implement the persister backed by an in-memory map mirrored into the solution document on write (reuse the `SolutionSettingBag` dirty/ToRecord pattern). Commit `feat(todl): SolutionBagPersister (solution.json bags)`.

### Task 7: `ProjectSharedBagPersister` + `ProjectLocalBagPersister`

**Files:**
- Create: `TODL/src/solution-services/property-bags/project-bag-persisters.ts` + test.

**Interfaces:**
- Consumes: `IStorage`, `PROJECT_MANIFEST_FILENAME` (`'project.plexus'`), `IBagPersister`.
- Produces: `class ProjectSharedBagPersister implements IBagPersister` (manifest `bags` section), `class ProjectLocalBagPersister implements IBagPersister` (`project.local.json`). `static ProjectLocalBagPersister.FileName = 'project.local.json'`.

- [ ] **Step 1: failing test** — a local bag written to `project.local.json` never appears in the manifest; the shared persister writes a `bags` section in the manifest preserving other fields; both read empty when their file/section is absent.

```ts
test('project-local bags land in project.local.json, never the shared manifest', async () =>
{
    const storage = new FakeStorage('/p')
    await storage.WriteText('project.plexus', JSON.stringify({ type: 'architecture', name: 'a' }))
    const local = new ProjectLocalBagPersister(storage)
    local.Create('npm-connection', 'gh').SetValue('DisplayName', 'GH')
    await local.Flush()   // or write-through on set — pick one and test it
    const manifest = JSON.parse(await storage.ReadText('project.plexus'))
    assert.equal(manifest.bags, undefined)
    const sidecar = JSON.parse(await storage.ReadText('project.local.json'))
    assert.equal(sidecar['npm-connection'].gh.DisplayName, 'GH')
})
```

- [ ] Steps 2-5: implement both over `{ [kind]: { [id]: { name: value } } }`; manifest persister preserves unknown fields (spread) like `ReferenceEditingService.writeForOp`; commit `feat(todl): project shared + local bag persisters`.

### Task 8: `BagDefinitionRegistry` (rename `SolutionSettingsRegistry`)

**Files:**
- Rename: `solution-settings-registry.ts` → `bag-definition-registry.ts` (class `BagDefinitionRegistry`, `Key = new ServiceKey('BagDefinitionRegistry')`); keep `Contribute`/`GetById`/`Definitions`.
- Modify: every call site (grep `SolutionSettingsRegistry`), incl. `SolutionServicesEngine` registration and `index.ts`.

- [ ] Steps: rename + update the existing registry test → run the settings-registry test + build → commit `refactor(todl): SolutionSettingsRegistry → BagDefinitionRegistry`. (Ruling if a call site's semantics differ.)

### Task 9: `IBagCatalog` / `BagCatalog`

**Files:**
- Create: `TODL/src/solution-services/property-bags/bag-catalog.ts` + test.

**Interfaces:**
- Consumes: `IBagPersister`, `BagAddress`, `BagScope`.
- Produces: `interface BagVantage { Global: IBagPersister; Solution?: IBagPersister; ProjectShared?: IBagPersister; ProjectLocal?: IBagPersister }`, `interface ResolvedBag { Address: BagAddress; Values: IPropertyBag }`, `class BagCatalog implements IBagCatalog { Visible(kind, v: BagVantage): readonly ResolvedBag[]; Get(a: BagAddress, v): ResolvedBag | undefined; Nearest(kind, v): ResolvedBag | undefined }`. Ordering: ProjectLocal → ProjectShared → Solution → Global.

- [ ] **Step 1: failing test** — three same-id `npm-connection` instances at global/solution/project all appear in `Visible`, distinctly addressed, nearest-first; a write to the project one does not change the global one; `Nearest` returns the project one.
- [ ] Steps 2-5: implement union+tag+order; commit `feat(todl): BagCatalog with scope-tagged visibility`.

### Task 10: `npm-connection` bag kind + secret-reference model

**Files:**
- Create: `TODL/src/solution-services/property-bags/connection-bag.ts` + test.

**Interfaces:**
- Consumes: `SettingBagDefinition`, `SettingDefinition` (mural), `BagAddress`.
- Produces: `const ConnectionBagKind = 'npm-connection'`; `ConnectionBag` helper (typed get/set over an `IPropertyBag`: `DisplayName`, `RegistryType`, `Settings`, `TokenSource` (enum Stored/Env), `TokenRef`, `TokenEnvVar`, `IsDefault`); `ConnectionBagDefinition` (the `SettingBagDefinition` for the kind). No secret value field.

- [ ] **Step 1: failing test** — a `ConnectionBag` over a `MapPropertyBag` exposes `TokenRef`/`TokenSource` but has no field that holds a raw secret; `IsDefault` defaults false.
- [ ] Steps 2-5: implement; commit `feat(todl): npm-connection bag kind (secret-reference only)`.

### Task 11: Connection-resolution consumer + selection + re-point `SolutionBaseResolver`

**Files:**
- Create: `TODL/src/solution-services/property-bags/connection-resolution.ts` + test.
- Modify: `solution-base-resolver.ts` connection seam if it reads connection selection directly (else this is app-side only — a Ruling).

**Interfaces:**
- Consumes: `BagCatalog`, `ConnectionBag`, `BagAddress`, `BagVantage`.
- Produces: `const ConnectionSelectionKind = 'connection-selection'`; `enum ConnectionPurpose { ReferenceResolution='reference-resolution', Publish='publish' }`; `class ConnectionResolution { EffectiveFor(purpose, vantage): ResolvedBag | undefined }` = explicit selection pointer (project-local `connection-selection[purpose]` → a `BagAddress`) else nearest scope whose `npm-connection` has `IsDefault` (project→solution→global).

- [ ] **Step 1: failing test** — with a selection pointing at the solution connection, `EffectiveFor(ReferenceResolution)` returns it; with no selection, returns the nearest `IsDefault` (project over solution over global); with a dangling selection (address not found), falls back to nearest default (no throw).
- [ ] Steps 2-5: implement; commit `feat(todl): connection resolution (selection → nearest default)`.

### Task 12: Migration readers (`connections.json` + `solution.json` → bags)

**Files:**
- Create: `TODL/src/solution-services/property-bags/bag-migration.ts` + test.

**Interfaces:**
- Consumes: `IBagPersister` (global + solution + project-local), `ConnectionBagKind`, `ConnectionSelectionKind`.
- Produces: `class BagMigration { MigrateGlobal(store): Promise<void>; MigrateSolution(solution, projectLocalFor): Promise<void> }`; each writes a `bagsVersion` marker and no-ops when the marker is present.

- [ ] **Step 1: failing test** — a real old `connections.json` (`{connections:[{Id,DisplayName,RegistryType,Settings,TokenSource,TokenEnvVar}], default}`) migrates to global `npm-connection` bags + a global `IsDefault`; running twice does not duplicate or drop a hand-added connection (marker holds); a `solution.json` `connections` bag with member-path overrides → each member's project-local `connection-selection[reference-resolution]`.
- [ ] Steps 2-5: implement defensively (missing file → nothing); commit `feat(todl): bag migration from connections.json + solution.json`.

### Task 13: Publish TODL + adopt in Plexus pin

- [ ] **Step 1:** `cd TODL && npm test` → Expected: full suite green (1371 + new).
- [ ] **Step 2:** `npx tsc -p tsconfig.build.json --noEmit` → Expected: clean.
- [ ] **Step 3:** `npm run build && npm version patch --no-git-tag-version && npm publish` → Expected: `+ @pragmatic-tech-ai/todl@<new>`.
- [ ] **Step 4:** In Plexus, bump the 4 todl pins to `^<new>`, `npm install`, verify installed dist carries the new exports. Commit both repos: TODL `feat(todl): property-bag subsystem (<new>)`; Plexus `chore: adopt todl <new>`.

---

# Wave 3 — Plexus + devUI

### Task 14: `GlobalBagPersister` over the Electron IPC seam

**Files:**
- Modify: `Plexus/packages/plexus-core/src/shared/settings-api.ts` (add a `bags` channel pair) or a new `shared/bags-api.ts`; `src/main/settings.ts` sibling for `application-bags.json`; preload bridge.
- Create: `Plexus/apps/plexus/src/renderer/src/services/bags/global-bag-persister.ts` + `Plexus/packages/plexus-core` `DurableApplicationStore` composition; test.

**Interfaces:**
- Consumes: `IBagPersister`, `DurableApplicationStore` (todl-runtime) — or wrap the store behind an `IBagPersister` (Scope=Global).
- Produces: `class GlobalBagPersister implements IBagPersister` backed by the durable store; registered under a `GlobalBagPersisterKey`.

- [ ] **Step 1: failing test** (plexus-core vitest) — `GlobalBagPersister` over a fake `IPropertyBagStore` creates/reads/deletes `npm-connection` instances; secrets never pass through it (only refs).
- [ ] Steps 2-5: implement; commit `feat(plexus): GlobalBagPersister over the durable store`.

### Task 15: Wire the durable store at startup (Plexus + devUI) — the dormant-bug fix

**Files:**
- Modify: `Plexus/apps/plexus/src/renderer/src/main.js`/composition root and `Plexus/apps/devUI/src/renderer/main.ts:~68` — register `new DurableApplicationStore(provider)` under `DurableApplicationStoreKey` and `await store.Restore()` before `SolutionManagerService.RestoreSession()`.

- [ ] **Step 1: failing test / e2e assertion** — after wiring, a solution's last-active location persists and a fresh renderer restores it (e2e: open a solution, relaunch, it reopens). At minimum a unit test that the composition root binds `DurableApplicationStoreKey` to a concrete store.
- [ ] Steps 2-5: implement in both apps; commit `fix(plexus,devui): register + restore the durable application store at startup`.

### Task 16: Re-point connection UI/resolution onto the catalog + selection

**Files:**
- Modify: `Plexus/packages/plexus-core/.../connection-editing-service.ts`, `project-explorer-service.ts` (EffectiveConnectionIdForConsumer, connectionHost, memberForConsumerId already on ConsumerIdOf), delete/absorb `solution-connection-overrides.ts` (→ project-local `connection-selection`); `Plexus/apps/plexus/src/main/connections/connections-bridge.ts` (Resolve already carries resources; connection listing now reads bags).

**Interfaces:**
- Consumes: `BagCatalog`, `ConnectionResolution`, `ConnectionBag`, `ConnectionSelectionKind`, `GlobalBagPersister` + solution/project persisters built for the active vantage.

- [ ] **Step 1: failing test** — `ConnectionEditingService.ConnectionsView()` lists connections from all visible scopes (global+solution+project), tagged; setting a per-project active connection writes the project-local `connection-selection`, not `solution.json`; the P5b `IsSolutionDefault`/`SetSolutionDefault` map onto solution-scope `IsDefault`.
- [ ] Steps 2-5: implement; rebuild plexus-core dist; run plexus-core + apps suites; commit `refactor(plexus): connections resolve through the bag catalog + selection`.

### Task 17: `project.local.json` ignore scaffolding + migration trigger

**Files:**
- Modify: project scaffolding (the `.gitignore`/agent-scaffold that `TodlProjectFactory` writes) to include `project.local.json`; composition root calls `BagMigration.MigrateGlobal` at startup (after Restore) and `MigrateSolution` on solution open.

- [ ] **Step 1: failing test** — a newly scaffolded project ignores `project.local.json`; opening a solution with a legacy `connections`/`connections.json` migrates once (idempotent on reopen).
- [ ] Steps 2-5: implement; run full apps + devUI suites + the connection e2e; commit `feat(plexus): scaffold project.local.json ignore + run bag migration`.

### Task 18: Wave-3 verification + push

- [ ] **Step 1:** plexus-core renderer + apps/plexus + devUI suites green; typecheck (plexus-core build + apps node/web) clean; connection e2e green.
- [ ] **Step 2:** Push todl-runtime, TODL, Plexus per "push and stop".
- [ ] **Step 3: Commit** any final version/pin bookkeeping.

---

## Notes for the executor

- **Persister flush model:** decide write-through-on-set vs explicit `Flush()` in Task 6/7 and use it consistently across all persisters (a Ruling in Task 6, carried).
- **`BagVantage` construction** (Task 9/16): the app builds it per active project — `GlobalBagPersister` + a `SolutionBagPersister` over the active solution + the project's shared/local persisters over the member storage. Centralize in one factory.
- **P5b behavior parity** is the acceptance bar for Task 16: the Connections branch, per-project active-connection row, editor dialog, and effective-connection resolution behave as before, now over bags; the connection e2e is the guard.
- **Migration is one-way and destructive of the old files** (deletes `connections.json` after rewrite) — the four-stops rule applies at execution; keep a copy until the migrated read verifies.
