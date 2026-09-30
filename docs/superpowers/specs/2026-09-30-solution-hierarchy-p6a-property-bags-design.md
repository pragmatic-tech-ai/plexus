# Spec — P6a: Scope-Based Property-Bag Subsystem

**Goal:** One settings mechanism for the whole ecosystem: typed *property bags*
that can be persisted in any scope (global, solution, project — shared or local),
addressed by kind + instance, with resolution owned by each consumer. Subsumes and
migrates today's ad-hoc connection storage and the solution-only setting-bag system.

**Architecture:** Build on the primitives that already exist — Mural
`SettingDefinition` (field schema), TODL `SettingBagDefinition` (bag-kind schema),
todl-runtime `IPropertyBag`/`MapPropertyBag` (runtime value container) — and add the
missing pieces: a **storage-tier interface** (`IPropertyBagStore`) with **durable**
and **transient** implementations, a family of **scope persisters** over it
(global, solution.json, project-manifest, project-local sidecar), **instance
addressing** (kind + id + scope), and a **catalog** that enumerates a kind's
instances visible from a vantage point. Consumers query the catalog and decide which
instance to use — the subsystem imposes no cascade.

**Tech Stack:** TypeScript across todl-runtime (storage tiers + property bags),
TODL (subsystem + manifest persisters, headless), Plexus main/preload/renderer
(the Electron-backed global persister + IPC), Mural framework (`SettingDefinition`,
unchanged). House style per the workspace CLAUDE.md (OOP, Allman, PascalCase
interfaces/public methods, enums over unions, no inline string literals, tests in
`tests/` subfolders).

**Spec relationship:** This is **P6a**, the first of the P6 decomposition
(agreed 2026-09-30). It is the foundation for **P6b** (tree-expansion/selection
persistence, which consumes a durable solution/global bag) and **P6c**
(unresolved-member "Remove from Solution"). It extends the umbrella migration spec
`2026-09-29-solution-hierarchy-migration-spec.md` (§4 "P6 — Persistence & errors")
and the P5b Connections design `2026-09-30-solution-hierarchy-p5b-connections-branch-design.md`
(whose connection storage this migrates).

## Global Constraints

- **Secrets never enter a bag or cross the IPC bridge as values.** A bag stores a
  **secret-reference key** (the existing `TokenSource` + reference: `stored` → look
  up by key in the encrypted store; `env` → read the named env var). The actual
  token is resolved from the existing `EncryptedSecretStore` / `ConnectionTokenStore`
  by that key. Only `HasToken`-style booleans cross IPC.
- **User-specific data is never written to the shareable project manifest.** The
  project scope has two persisters: the shared manifest (committed) and a
  gitignored local sidecar. Connection bags and connection selections use the local
  sidecar; genuinely shareable project config uses the manifest.
- **`userEmail` (evgen.napryaglo@gmail.com)** is used for identity/attribution only,
  never sent to an unrelated service.
- **Latest packages:** cross-repo bumps go to the newest published version.
- Commit attribution `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`;
  PR attribution `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## 1. Current state (verified against code)

**Primitives that exist and are reused:**
- `SettingDefinition` (Mural `framework`): one field's schema — key, type, default,
  label, editor hints. Drives the PropertyGrid and `ApplicationSettings`.
- `SettingBagDefinition` (TODL `solution-manager/engine/setting-bag-definition.ts`):
  a named group of `SettingDefinition`s = a **bag kind's schema**.
- `IPropertyBag` / `MapPropertyBag` (todl-runtime `property-bag.ts`): the DP-free
  runtime **value container** — an observable `name → accessor` collection
  (`GetValue`/`SetValue`/`IsReadOnly`/`Observe`), schema-agnostic.
- `SolutionSettingsRegistry` (TODL): aggregates the bag-kind definitions a host
  contributes.

**Storage that exists:**
- `SessionStore`/`ISessionStore` (todl-runtime `session/session-store.ts`): persists
  registered `IPropertyBag`s to `session.json` under userData (debounced) and applies
  them on `Restore()` at startup. Surface: `Register(key, bag): Disposable`,
  `Restore(): Promise<void>`, `Save(): Promise<void>`.
- `ApplicationSettings` + `ElectronSettingsStore` + `main/settings.ts`: a flat
  key→value `settings.json` under userData (durable user preferences).
- Solution settings: `Solution.BindBags/CollectSettings/LoadSettings` +
  `SolutionSettingBag`, persisted in `solution.json`'s `settings`.
- Connections (P5b): global `connections.json` + `conn-token-<id>.bin`; per-project
  active-connection overrides + solution/global defaults in `solution.json`'s
  `connections` setting bag.

**Two confirmed bugs in `SessionStore` (fixed here):**
1. **Mislabelled.** Its docstring calls it "transient session state," but the
   implementation writes to disk and restores at startup — it is **durable across
   sessions**. The name/doc contradict the behavior.
2. **Dormant.** No app registers a concrete `SessionStore` under `SessionStoreKey`
   (only optional `provider.get(SessionStoreKey)?`). So `SolutionManagerService`'s
   last-solution/recents bag is registered with `undefined` and **nothing ever
   persists or restores** — "reopen the previous solution" does not work today.

## 2. Storage tiers (todl-runtime)

Extract one interface and provide two interchangeable implementations, so a consumer
depends on the interface and the composition root picks durability.

```ts
// The persistence surface (today's SessionStore surface, extracted).
export interface IPropertyBagStore
{
    Register(key: string, bag: IPropertyBag): Disposable
    Restore(): Promise<void>
    Save(): Promise<void>
}
```

- **`DurableApplicationStore` implements `IPropertyBagStore`** — the current
  `SessionStore` behavior (write a document to an `IStorage`, restore + apply at
  startup, debounced save, capture-on-unregister). Its doc is corrected; its backing
  file is renamed off the misleading `session.json` to `application-bags.json`
  (see Migration §8 for the one-time read of the old name). This is the durable
  global tier: connections, defaults, last-solution/recents, and P6b's persisted
  tree state live here.
- **`TransientSessionStore` implements `IPropertyBagStore`** — same surface, holds
  values in memory for the run only: `Save()`/`Restore()` are no-ops (or restore is
  empty). For genuinely per-run state that must not survive a restart.
- **`SessionStore` / `ISessionStore` / `SessionStoreKey` are removed**; call sites
  move to `IPropertyBagStore` + the appropriate impl. `DurableApplicationStoreKey`
  and `TransientSessionStoreKey` are the new `ServiceKey`s. (`SessionStore` is
  unwired, so no on-disk data depends on the old key.)

**Backing storage stays injected** (as today): the store resolves `IStorage` via
`StorageProviderKey` + `EnvironmentKey.UserDataDirectory`, so it is headless-testable
with `FakeStorage`.

## 3. Bag identity and scope (todl-runtime + TODL)

A bag instance is addressed by three coordinates:

```ts
export enum BagScope { Global = 'global', Solution = 'solution', Project = 'project' }
export enum ProjectStore { Shared = 'shared', Local = 'local' }

export interface BagAddress
{
    Scope: BagScope
    Kind: string        // the SettingBagDefinition.Id, e.g. 'npm-connection'
    Id: string          // instance id within (scope, kind), e.g. a connection id
    // Present only when Scope === Project: which of the project's two persisters
    // (§4). Omitted for Global/Solution. Connections default to Local.
    ProjectStore?: ProjectStore
}
```

- Many instances of one kind may exist within one scope (e.g. several npm
  connections global), and instances of a kind may exist at every scope
  simultaneously (the worked example: a global, a solution, and a project GitHub
  connection all at once).
- Consumers reason in **three scopes**; the `ProjectStore` discriminator is an
  intra-project detail that only appears on `Project`-scope addresses. `Visible`
  (§6) orders a project's two persisters local-before-shared.

## 4. Scope persisters (TODL owns manifest-backed; Plexus owns global)

A **persister** owns the bags for one manifest-bearing owner and is built on
`IPropertyBagStore`. "Any manifest-bearing item can persist bags."

```ts
export interface IBagPersister
{
    Scope: BagScope
    // All instance ids of a kind this persister holds.
    Ids(kind: string): readonly string[]
    // The value bag for one instance (created empty on first write).
    Bag(kind: string, id: string): IPropertyBag
    Create(kind: string, id: string): IPropertyBag
    Delete(kind: string, id: string): void
}
```

Concrete persisters:
- **`GlobalBagPersister` (Plexus)** — over `DurableApplicationStore` (userData).
  The one persister TODL cannot own headlessly; Plexus provides it through the
  existing main → preload → renderer IPC seam (like `ISettingsStore`). A
  `TransientSessionStore`-backed variant is available for transient global bags.
- **`SolutionBagPersister` (TODL)** — a `bags` section in `solution.json`
  (generalizing today's `settings`/`connections` sections). Headless.
- **`ProjectSharedBagPersister` (TODL)** — a `bags` section in the project manifest
  (`project.plexus`). Committed/shared. Headless.
- **`ProjectLocalBagPersister` (TODL)** — a gitignored `project.local.json` sidecar
  next to the manifest. User-specific. Headless. Plexus's project scaffolding adds
  `project.local.json` to the project's ignore rules.

Each persister serializes as `{ [kind]: { [id]: { name: value } } }`, so one
document holds every bag the owner carries.

## 5. Definitions registry (TODL)

Generalize `SolutionSettingsRegistry` into `BagDefinitionRegistry` (rename;
`SolutionSettingsRegistry` is retired and its call sites move over): the host
`Contribute`s a `SettingBagDefinition` per bag kind; the registry is the schema
source for editors and for typed read/write. A kind's definition is scope-agnostic —
the same `npm-connection` schema is used at every scope.

## 6. The catalog and consumer-owned resolution (TODL)

```ts
export interface ResolvedBag
{
    Address: BagAddress
    Values: IPropertyBag
}

export interface IBagCatalog
{
    // Every instance of a kind visible from a vantage point, tagged with its scope,
    // nearest scope first: project(local, shared) → solution → global.
    Visible(kind: string, vantage: BagVantage): readonly ResolvedBag[]
    // One instance by address, or undefined.
    Get(address: BagAddress): ResolvedBag | undefined
}
```

- `BagVantage` names the current project (its two persisters), the active solution,
  and the global persister — the set of persisters a query unions over.
- **The catalog imposes no cascade.** It returns the tagged, ordered list; the
  consumer picks. This is the explicit contract from the design discussion: "the
  build system resolves the property bags based on its needs and owns the decision."
- A convenience `Nearest(kind, vantage)` (first visible instance, nearest scope) is
  provided for consumers that want the common policy, but consumers are free to
  ignore it (a publisher may want the global one regardless of a nearer instance).

## 7. Connections as bags + the connection-resolution consumer

Connections become the first real bag kind, kind id `npm-connection` (schema:
`DisplayName`, `RegistryType`, `Scope`/settings, `TokenSource`, `TokenRef`/`TokenEnvVar`
— all non-secret). The token itself stays in `EncryptedSecretStore`, resolved by
`TokenRef`.

- A connection can be created at any scope (global / solution / project-local),
  satisfying the worked example (three GitHub connections at three scopes).
- **`IsDefault`** is per scope (a bag field): each scope may name a default
  connection. This replaces P5b's `IsDefault` (global) + solution-default.
- **Selection** (a project's chosen connection for a purpose) is a small
  per-project-local pointer bag `connection-selection` holding a `BagAddress` per
  purpose (`reference-resolution`, `publish`, …). This replaces P5b's per-project
  override in `solution.json`.
- **The reference-resolution consumer's policy** (migrating P5b's
  override→solution-default→global-default) reads: (1) the project-local
  `connection-selection[reference-resolution]` pointer if set; else (2) the nearest
  scope with a default `npm-connection` (project → solution → global). Publishing and
  other purposes are separate selections/policies over the same bags.
- `ProjectExplorerService.EffectiveConnectionIdForConsumer` / the app
  `ConnectionsBridge.Resolve` path from P5b are re-pointed at the catalog +
  selection, unchanged in outward behavior for the already-working meta-model/library
  case; architecture projects (todl 0.38.7 `ConsumerIdOf`) keep working.

## 8. Migration (one-time, on first run of the new build)

Read old layouts, write the new, tolerate absence:
- **`connections.json` + `conn-token-<id>.bin`** → global `npm-connection` bags in
  `DurableApplicationStore` (`application-bags.json`); tokens stay in their encrypted
  files, referenced by `TokenRef`. Delete `connections.json` after a successful
  rewrite.
- **`solution.json` `connections` + `settings`** → the `bags` section
  (`npm-connection` instances + the migrated setting bags). Per-project overrides →
  each project's local `connection-selection`.
- **`session.json`** (if any exists from a future wiring) → `application-bags.json`.
  Since `SessionStore` was dormant, in practice there is nothing to migrate; the
  reader is defensive only.
- A `bagsVersion` marker in each document guards re-migration.

## 9. Wiring the dormant store (bug #2)

Plexus and devUI composition roots register a `DurableApplicationStore` under
`DurableApplicationStoreKey` and call `Restore()` at startup (before
`SolutionManagerService.RestoreSession()`), so last-solution/recents — and P6b's tree
state — actually persist. This is the fix for the dormant-store bug and a prerequisite
for P6b.

## 10. Layering and cross-repo sequencing

- **todl-runtime:** `IPropertyBagStore`, `DurableApplicationStore`,
  `TransientSessionStore` (+ keys); remove `SessionStore`. Publish.
- **TODL:** `BagAddress`/`BagScope`, `IBagPersister` + `SolutionBagPersister` /
  `ProjectSharedBagPersister` / `ProjectLocalBagPersister`, `BagDefinitionRegistry`
  (rename of `SolutionSettingsRegistry`), `IBagCatalog`/`BagCatalog`, the
  `npm-connection` kind, migration readers; re-point `SolutionBaseResolver`/connection
  seams. Adopt new todl-runtime, publish.
- **Plexus (plexus-core + apps/plexus):** `GlobalBagPersister` over the Electron
  IPC seam; register + `Restore()` the durable store; re-point
  `ConnectionEditingService` / `ProjectExplorerService` connection paths + the app
  `ConnectionsBridge` onto the catalog + selection; scaffold `project.local.json`
  ignore. Adopt new todl.
- **devUI:** register the durable store + `Restore()`; adopt its connection UI onto
  the catalog (it already composes the connection engine).
- **Mural:** untouched (`SettingDefinition` stays as-is).

Order per phase: todl-runtime → TODL → Plexus/devUI, each green + published before the
next adopts. Push after each per the "push and stop" rule.

## 11. Testing strategy

Per the project's real-fixtures approach:
- **todl-runtime (node:test):** `DurableApplicationStore` round-trips a bag across
  Save/Restore over `FakeStorage`; `TransientSessionStore` drops values on a new
  instance; unregister captures final values; both satisfy `IPropertyBagStore`.
- **TODL (node:test, real fixtures):** each persister reads/writes its document over
  `FakeStorage`/`NodeFsStorage`; `BagCatalog.Visible` unions and orders scopes;
  multiple instances per kind per scope; migration reader converts a real old
  `connections.json` + `solution.json`; the connection consumer's policy resolves
  selection → nearest default across three scopes.
- **plexus-core / apps (vitest):** `GlobalBagPersister` over a fake IPC bridge;
  connection CRUD + selection through the catalog; the P5b connection e2e still
  passes; secrets never cross the bridge (only `HasToken`).
- **Live e2e:** the Connections branch still lists/edits connections; a solution
  reopens its last-active state once the durable store is wired.

## 12. Review Focus (inputs the tasks' own tests must pin)

1. **Missing/corrupt bag documents** (first run, hand-edited, partial migration) →
   empty bags + defaults, never a crash (each persister's read is defensive).
2. **Same-id instances at multiple scopes** → `Visible` returns all, distinctly
   addressed; a write to one never clobbers another scope's.
3. **Secret reference with no stored secret** (token file deleted, env var unset) →
   `HasToken` false, resolution degrades, no throw, no secret logged.
4. **Project-local sidecar present but manifest shared** → local bags never appear in
   the committed manifest; a teammate cloning the repo sees no local connections.
5. **Migration idempotence** → running the new build twice does not double-migrate or
   lose a hand-added connection (the `bagsVersion` marker holds).

## 13. Scope boundary

**In P6a:** the storage tiers, the scope persisters, the catalog, the definitions
registry, connections-as-bags + the connection-resolution consumer, migration, and
wiring the durable store. **Not in P6a:** tree-expansion/selection persistence (P6b,
consumes the durable store), unresolved-member "Remove from Solution" (P6c). No new
bag kinds beyond `npm-connection` and the migrated solution setting bags.
