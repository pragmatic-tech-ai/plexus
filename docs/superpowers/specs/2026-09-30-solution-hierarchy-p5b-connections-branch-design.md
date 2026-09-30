# P5b — Connections Branch (Solution Hierarchy) Design

**Status:** Approved for planning (2026-09-30)

**Parent:** `docs/superpowers/specs/2026-09-29-solution-hierarchy-migration-spec.md` (defines P5 — Cross-hierarchy content: References + Connections as tree nodes). P5 is split: P5a = References branch (shipped, tip `ea93842`), **P5b = Connections branch (this spec)**.

**Sibling:** `docs/superpowers/specs/2026-09-30-solution-hierarchy-p5a-references-branch-design.md` — P5b mirrors P5a's provider/view-seam/actions-contributor pattern and ties into P5a's reference-resolution path.

## Goal

Surface the user's **package-registry connections** as a first-class `Connections` branch in the Solution Explorer, and let a project choose **which connection resolves its references**. Two surfaces: a **global** `Connections` branch under the Solution root (the authoritative list, with create/edit/test/default/remove), and a per-project **active-connection** row that repoints that project's P5a reference resolution. The connection host wiring and encrypted secret store — today living only in `apps/devUI` — are promoted into `plexus-core` so both apps share one implementation.

## Scope decisions (resolved during brainstorming)

1. **Tree placement — hybrid.** Connections are **user-global** (one `connections.json` per user, shared across projects), so the authoritative list is a single `Connections` branch under the **Solution root**, shown once. Additionally, each consumer project gets a lightweight **active-connection** row (the hybrid half) showing which connection resolves that project's references.
2. **Port scope — promote shared pieces into `plexus-core`.** The self-contained main-process pieces (encrypted secret store, connection store, engine composition) move into `packages/plexus-core/src/main/connections/`; `apps/devUI` adopts the promoted module (its own `userData` + `safeStorage`). One audited copy of security-sensitive code.
3. **Edit depth — flat list + dialog + light actions.** The `Connections` branch is a **flat** list of connection leaves (no registry-type groups yet; the type rides in the caption). The multi-field connection form (name, registry type, scope/org, auth mode, token) is edited in a **modal dialog** (New/Edit; token as a masked field). Direct context actions: Test, Make Default, Remove. The per-project active-connection pick is a **single value**, so it is an inline submenu, not a dialog.
4. **Active-connection storage — `solution.json`, not the project manifest.** A connection-id is machine-local (meaningful only against this user's `connections.json`), so per-project choices live in `solution.json`, never in the shareable `project.plexus`. This reuses the existing but currently-unwired `solution-studio` seam (`ISolutionWorkspaceHost` / `SolutionConnection` / `connection-fields`).

## Non-goals

- No package **publish/compile** path in `apps/plexus` — that stays `apps/devUI`'s `RegistryBridge`. `apps/plexus`'s bridge is the Connections subset only.
- No **on-disk format change** — the promoted secret/connection store is byte-compatible with devUI's current layout (a code relocation, not a migration).
- No new Mural framework API (`NodeKey.Connections` already exists) and no new TODL engine API (`@pragmatic-tech-ai/todl/package-manager` is already a dependency of both apps).
- No second registry type — only `npm` ships; the catalog stays extensible but P5b adds no new registry.
- No live cross-window/cross-app sync of connections — each app install has its own `userData`.

## Architecture

### Tree shape

```
▾ Solution                              (NodeKey.Solution — existing)
   ▾ Connections                        (NodeKey.Connections — under the Solution root)
      ● npm-public  (npm)  ★            (ConnectionNodeKey.Leaf — decorated)
      ⚠ github-pkgs (npm)               (ConnectionNodeKey.Leaf — Warning: no token / last Test failed)
   ▾ ProjectA                           (NodeKey.Project — existing member row)
      ▾ References …                     (P5a — unchanged)
      ⚙ Active connection: npm-public    (ConnectionNodeKey.Active — consumer projects only)
      ▾ (files…)                         (existing ProjectContentProvider output, unchanged)
   ▸ ProjectB
```

- **`NodeKey.Connections`** — already declared in Mural's `NodeKey` (next to `NodeKey.References`). The global branch root; `IsExpandable = true`; caption `"Connections"`.
- **`ConnectionNodeKey`** — a new provider-scoped presentation-family class in plexus-core, colocated with `ConnectionsProvider`, mirroring `ReferenceNodeKey`. Members: `Leaf` (a connection row under the global branch), `Active` (a project's active-connection row).
- **Global branch:** flat leaves, one per connection, interned by connection id. Leaf caption `displayName (registryType)`; `ExtObject` is `{ id }` (stable identity). Decoration below.
- **Active-connection row:** one per **consumer** project (same `IsConsumer` gate as P5a — `requiresMetaModel === true`), caption `Active connection: <effectiveDisplayName>`; `ExtObject` `{ member }`. Non-consumer projects get no row.

**Visibility rule:** the `Connections` branch is present whenever a solution is open (even with zero connections → an empty expandable branch, so New Connection has a home). The active-connection row follows the P5a consumer gate.

### Decoration (mirrors P5a resolve/live/unresolved)

Per connection leaf, computed from the `ConnectionView` (never a blocking network probe during tree build):

| State | Severity | IconKey suffix | Meaning |
| --- | --- | --- | --- |
| Default connection | `Ok` | `-default` (with `★`) | `IsDefault === true` |
| Has credentials | `Ok` | `-ready` | `HasToken === true`, or an env token source is set |
| Reachable | `Ok` | `-ready` | last on-demand `Test` returned `ok` |
| No credentials | `Warning` | `-nocreds` | `HasToken === false` and no env source |
| Test failed | `Warning` | `-unreachable` | last on-demand `Test` returned an error; `Error` carries the message |

`Test` is on-demand only (a context action). Its result is cached in the view service for decoration; it is never run during tree realization (no network on expand).

### Providers (plexus-core, renderer)

Two touch-points because scope differs (global vs. per-project).

**`ConnectionsProvider`** — implements `IHierarchyProvider`; **global** (one instance per open solution, not per member); mirrors `ReferencesProvider` minus groups.
- Mints a root id (the `Connections` node) and one interned leaf id per connection (`connById: Map<connectionId, HierarchyItemId>`), tracked in an `ownedIds` set for `Owns(id)`.
- Constructed with `(view: IConnectionView)`; subscribes `view.OnConnectionsViewChanged` in the ctor; on signal, re-fetches and diffs.
- `ObserveChildren(root, sink)` → async-seed (`queueMicrotask` before returning the disposer — the model's `entry.dispose` contract from P5a) then emit one `ChildAdded` per connection.
- Diff on change: existing id + display/decoration changed → `ChildUpdated`; new id → `ChildAdded`; missing id → `ChildRemoved` + cleanup.
- Public surface for the composite/contributor: `ConnectionsRootId()`, `ConnectionsRootNode()`, `Owns(id)`. `CanAccept` → `false`. `dispose()` disposes the change subscription.

**`ProjectBranchesProvider`** (P5a, generalized) — currently composes a single leading `refs` branch before `files`. Generalize to an **ordered list of leading branches** so it can emit **References root → active-connection leaf → files**:
- Leading branch descriptor: a root id + root node + an `Owns(id)` predicate + an `ObserveChildren` delegate (References is a full sub-provider; the active-connection row is a single leaf the composite emits and serves directly).
- On the project root: `queueMicrotask` each leading root in order, then forward `files.ObserveChildren`.
- Dispatch (`GetProperty`/`GetCanonicalName`/`ParseCanonicalName`/`CanAccept`): first leading branch whose predicate owns the id, else `files`.
- `dispose()` disposes **every** leading branch (P5a's dispose only covered `refs` — the generalization fixes the latent leak the P5a review flagged).
- The active-connection leaf node is built from `view.ActiveConnectionFor(member)`; refreshed when the connection view or the active-connection choice changes.

**Global branch attachment:** the `Connections` node is contributed under the Solution root as a keyed node by a small `ConnectionsRootContributor` (`ParentKeys = [NodeKey.Solution]`), and a `ProviderContribution(ConnectionsProvider)` is attached to that node (parallel to how projects + their subtrees attach). Registered in `SolutionExplorerService.rebuild`.

### View seam (plexus-core, renderer)

Parallels P5a's `IReferenceView` / `ReferenceEditingService` exactly; the difference is the authority lives in **main**, so the service is a thin client over IPC.

**`IConnectionView`** (solution-explorer/services/connection-view.ts):

```ts
export enum ConnectionHealth { Default, Ready, NoCredentials, Unreachable }

export interface ConnectionLeafView
{
    readonly Id: string
    readonly DisplayName: string
    readonly RegistryType: string
    readonly IsDefault: boolean
    readonly HasToken: boolean
    readonly Health: ConnectionHealth
    readonly Message?: string          // Test error, when Unreachable
}

export interface IConnectionView
{
    ConnectionsView(): Promise<readonly ConnectionLeafView[]>
    RegistryTypes(): Promise<readonly string[]>                        // dialog: registry-type choices
    PresetsFor(registryType: string): Promise<readonly ConnectionPreset[]>
    SettingsSchemaFor(registryType: string): Promise<readonly ConnectionSettingField[]>
    EnvVars(): Promise<readonly string[]>                             // dialog: env-token choices
    AddConnection(spec: ConnectionSpec, secret?: string): Promise<void>
    UpdateConnection(id: string, partial: Partial<ConnectionSpec>): Promise<void>
    SetToken(id: string, token: string): Promise<void>
    UseEnvToken(id: string, varName: string): Promise<void>
    SetDefault(id: string): Promise<void>
    RemoveConnection(id: string): Promise<void>
    TestConnection(id: string): Promise<{ Ok: boolean; Message?: string }>
    IsConsumer(member: SolutionMember): boolean                       // sync gate for the active-connection row
    ActiveConnectionFor(member: SolutionMember): Promise<ConnectionLeafView | undefined>  // effective
    SetActiveConnectionFor(member: SolutionMember, connectionId: string | undefined): Promise<void>
    OnConnectionsViewChanged(handler: (affected: SolutionMember | undefined) => void): Disposable
}

export const ConnectionViewKey = new ServiceKey<IConnectionView>('IConnectionView')
```

`ConnectionSpec` / `ConnectionPreset` / `ConnectionSettingField` / `TokenSource` import from the **browser-safe** subpath `@pragmatic-tech-ai/todl/package-manager/connections` (types only, no fs/network/secrets — the renderer rule).

**`ConnectionEditingService implements IConnectionView`** (project-explorer/services/connection-editing-service.ts):
- Constructed with `(client: IConnectionsClient, host: IConnectionHost)`.
- Read/mutate methods delegate to the renderer `ConnectionsClient` (IPC to main). `TestConnection` caches its result per id for decoration.
- `ConnectionsView()` maps each `ConnectionView` (from main) + cached Test result → `ConnectionLeafView` with `Health`.
- `ActiveConnectionFor(member)` computes the **effective** connection: project override → solution default → global default, via `IConnectionHost`.
- `SetActiveConnectionFor` writes the choice through the host, then fires `OnConnectionsViewChanged(member)` **and** triggers `LiveValidationKey.RefreshBases` so P5a's References re-resolve/re-decorate against the new registry.
- All mutators fire `OnConnectionsViewChanged(undefined)` (global list changed) after the IPC round-trip completes.

**`IConnectionHost`** (the ProjectExplorerService-provided lifecycle/status seam):

```ts
export interface IConnectionHost
{
    ProjectFor(member: SolutionMember): OpenProject | undefined
    SetStatus(message: string): void
    SolutionDefaultConnectionId(): string | undefined                     // from ISolutionWorkspaceHost
    ProjectConnectionOverride(member: SolutionMember): string | undefined  // from solution.json map
    SetProjectConnectionOverride(member: SolutionMember, id: string | undefined): Promise<void>
    RefreshBasesFor(member: SolutionMember): Promise<void>                 // LiveValidationKey.RefreshBases
}
```

### Main-process module (plexus-core) — the promotion

New shared module `packages/plexus-core/src/main/connections/` (promoted from `apps/devUI/src/main/registry/`), byte-compatible with the existing on-disk layout:

- `encryptor.ts` — the `Encryptor` seam (interface).
- `safe-storage-encryptor.ts` — `SafeStorageEncryptor implements Encryptor` (Electron `safeStorage`).
- `connection-token-store.ts` — `ConnectionTokenStore` (keyed encrypted tokens, `userData/conn-token-<id>.bin`, in-memory fallback when no keyring — never plaintext).
- `encrypted-secret-store.ts` — `EncryptedSecretStore implements ISecretStore` (engine adapter over `ConnectionTokenStore`).
- `file-connection-store.ts` — `FileConnectionStore implements IConnectionStore` (`userData/connections.json`; legacy-flat read migration retained).
- `process-environment-variables.ts` — `ProcessEnvironmentVariables implements IEnvironmentVariables`.
- `package-engine.ts` — `PackageEngine` (builds the `ServiceProvider`, registers the three host seams + npm factories + catalog + `PackageManagerService`, exposes `.Service`). Constructed with `(userDataDir, encryptor)` so each app supplies its own.

`ISecretStore` / `IConnectionStore` / `IEnvironmentVariables` / `PackageManagerService` / factories all come from `@pragmatic-tech-ai/todl/package-manager` (Node/main-only; already a dependency).

**devUI adoption:** `apps/devUI/src/main/index.ts` composes from the promoted `plexus-core` module (its own `userData` + `SafeStorageEncryptor`) instead of its private copies; devUI keeps its `RegistryBridge` (publish/compile) but drops the duplicated stores/engine. devUI's existing suite must stay green after adoption.

### IPC (apps/plexus) — plexus's typed pattern

- `apps/plexus/src/shared/connections-api.ts` — a channel enum + wire types + `IConnectionsApi` interface, modeled on the existing `mcp-client-api.ts` (not devUI's loose string channels).
- `apps/plexus/src/main/connections/connections-bridge.ts` — `ConnectionsBridge` maps channels → `PackageManagerService` (from a `PackageEngine` built in `apps/plexus/src/main/index.ts`): `list / add / update / remove / setToken / useEnvToken / setDefault / test / envVars / registryTypes / presets / schema`, plus a `resolve` path for reference resolution. Trimmed of publish/compile. Add mints an id from the display name (slugify + uniquify), as devUI does.
- `apps/plexus/src/main/index.ts` — build `SafeStorageEncryptor`, `PackageEngine(app.getPath('userData'), encryptor)`, `ConnectionsBridge`, and register the channels; register `SolutionWorkspaceHostKey` composition.
- Preload: extend `window.api` with a `connections` surface (thin `ipcRenderer.invoke`; **secrets never cross** — `ConnectionView.HasToken` only, never the token).
- `apps/plexus` renderer `ConnectionsClient implements IConnectionsClient` — typed wrapper over `window.api.connections.*`.

### Reference resolution (apps/plexus) — the functional payoff

`apps/plexus`'s `PublishedBases` (currently local-folder-only, `<userData>/packages` via `LocalFileStorage`) becomes **connection-aware**, additively:
- Resolve a project's bases through its **effective** connection's registry via `PackageManagerService.RegistryFor(effectiveId)`, **local-first**: the existing local store is the first layer; a network fetch through the connection is the fallback.
- The default path (no override, no solution default, or the global default connection) behaves like today — existing local-folder resolution is preserved as the local-first layer.
- When the chosen registry is unreachable, resolution degrades to local-first (never hangs the tree); unresolved refs decorate as `Unresolved` (P5a), not an error dialog.

### Active-connection storage & fallback

- Solution-level default: the existing `SolutionConnection` field in `solution.json` (via `ISolutionWorkspaceHost`).
- Per-project override: a new `{ projectPath → connectionId }` map in `solution.json`, read/written through `RegistrySolutionWorkspaceHost` (ported from devUI, extended for the map).
- **Effective** = project override → solution default → global default (`connections.json` `defaultId`). A dangling id (override points at a removed connection) falls through to the next layer cleanly (no error).

### Reactivity (two-signal, like P5a)

- Connection CRUD (add/update/remove/setToken/useEnv/setDefault/test) → `OnConnectionsViewChanged(undefined)` → global `ConnectionsProvider` re-diffs; a default change or a removal that alters any project's effective connection also refreshes the affected active-connection rows.
- Active-connection change for a project → `OnConnectionsViewChanged(member)` (row updates) **and** `RefreshBasesFor(member)` → P5a References re-resolve/re-decorate.

### Wiring (SolutionExplorerService / ProjectExplorerService)

- `ProjectExplorerService`: owns `connections = new ConnectionEditingService(client, host)`; exposes `get Connections(): IConnectionView`; the `IConnectionHost` bridges to `ISolutionWorkspaceHost` + `LiveValidationKey`.
- `SolutionExplorerService.rebuild`: `this.files.SetConnectionView(this.explorer.Connections)`; register `ConnectionsRootContributor` + `ConnectionActionsContributor(this.explorer.Connections)`; add teardown `off*`.
- `SolutionExplorerService.Delete`: `ConnectionNodeKey.Leaf` → remove connection (selection-aware); `NodeKey.Connections` / `ConnectionNodeKey.Active` → inert (synthetic).
- `FileTreeContributor`: add `SetConnectionView` + thread the active-connection leading branch into the generalized `ProjectBranchesProvider` (gated by `IConnectionView.IsConsumer`).
- `icon-key-to-geometry.ts`: add a `startsWith(ConnectionNodeKey.Leaf)` guard (resolution-suffixed glyphs) + `NodeKey.Connections` / `ConnectionNodeKey.Active` → folder/glyph cases; keep the P5a undefined-IconKey guard.

### Actions contributor (plexus-core, renderer)

**`ConnectionActionsContributor implements IHierarchyActionContributor`** — `ActionKeys = [NodeKey.Connections, ConnectionNodeKey.Leaf, ConnectionNodeKey.Active]`; constructed with `(view: IConnectionView)`:
- `NodeKey.Connections` → `New Connection…` (opens the editor dialog).
- `ConnectionNodeKey.Leaf` → `Edit…` (dialog), `Test`, `Make Default` (`canExecute` false when already default), `Remove` (selection-aware, each leaf its own id).
- `ConnectionNodeKey.Active` → `Active connection ▸` submenu of connections (current marked non-executable) + `(solution default)`; choosing calls `SetActiveConnectionFor`.
- Submenus fill async (`HierarchyAction.Command` then IIFE populates `Children`), empty → one disabled item — the P5a pattern.

### Connection editor dialog

A modal dialog editing one connection (New/Edit), reusing devUI's `ConnectionVM` field logic ported to a dialog model in plexus-core renderer (parallel to P5a's `ManageReferencesDialogModel`): name, registry type (drives the settings schema/presets), scope/org, auth mode (Token vs Env), token (masked, write-only — cleared after send). On OK: `AddConnection` / `UpdateConnection` (+ `SetToken` / `UseEnvToken`) through `IConnectionView`. VM extends `Observable`.

## Global Constraints

- **Repo scope:** `packages/plexus-core` + `apps/plexus` + a `apps/devUI` adoption edit only. **TODL and Mural are untouched** (engine + `NodeKey.Connections` already exist).
- **On-disk byte-compat:** the promoted secret/connection store reads/writes devUI's exact layout (`conn-token-<id>.bin`, `connections.json`, `safeStorage` encryption). No format change.
- **Secrets never cross the IPC bridge** — `ConnectionView.HasToken` only; tokens are set (write-only) and read only in main.
- **Renderer import rule:** renderer code imports connection *types* from `@pragmatic-tech-ai/todl/package-manager/connections` (browser-safe); the full `/package-manager` (fs/network) is main-only (type-only imports in the client are acceptable, matching devUI).
- **Per-project connection choices live in `solution.json`**, never in the shareable `project.plexus`.
- **House style:** OOP (methods on classes, no module-level free functions/vars); Allman braces; PascalCase interfaces + public methods; no inline string literals (hoist to `private static readonly`); VMs extend `Observable`; tests in `tests/` subfolders beside source; enums over string-literal unions.
- **Async-emission contract:** every provider's initial `ChildAdded` is emitted via `queueMicrotask` (after the model records `entry.dispose`), never synchronously inside `ObserveChildren`.

## Review Focus

Spec-implied inputs/failure modes no single task's happy-path tests exercise, most likely to bite first:

1. **Removed connection that was a project's effective one** — the override id in `solution.json` now dangles; `ActiveConnectionFor` must fall through (override → solution default → global default) and the active-connection row must re-render, not error. Test: remove the connection an override points at; assert the row shows the fallback and resolution still works.
2. **Keyring-less environment** (`safeStorage` unavailable) — the token store must degrade to in-memory (session-only) and **never write plaintext**; `HasToken` reflects session state. Test: inject an encryptor that reports unavailable; assert no plaintext file is written and set/get round-trips in-memory.
3. **Unreachable registry during resolution** — a chosen connection whose registry is down must degrade to local-first and leave refs `Unresolved`, never hang tree realization. Test: a bridge whose network layer rejects; assert local-first result + no hang.
4. **Add id collision** — two connections with the same display name; the bridge mints unique ids. Test: add twice with the same name; assert two distinct ids and both leaves render.
5. **devUI on-disk continuity after promotion** — an existing `connections.json` + `conn-token-<id>.bin` written by pre-promotion devUI must load unchanged through the promoted store. Test: fixture files in the devUI layout; assert `FileConnectionStore`/`ConnectionTokenStore` read them.

## Testing strategy

- **plexus-core unit (vitest):** `connections-provider.test.ts` (flat leaves, decoration, add/update/remove diff, async-seed); `project-branches-provider.test.ts` (extended: ordered leading branches References→active→files, async-emit, dispose-all); `connection-editing-service.test.ts` (view mapping incl. Health, mutators→client, effective-connection fallback, RefreshBases on active change, signals); `connection-actions-contributor.test.ts` (per-kind actions, active-connection submenu, selection-aware Remove); `icon-key-to-geometry.test.ts` (connection glyphs + undefined guard).
- **plexus-core main-process unit:** `connection-token-store.test.ts` (byte-compat, injected encryptor, keyring-less fallback); `file-connection-store.test.ts` (byte-compat, legacy read); `package-engine.test.ts` (composition wires the three seams + `PackageManagerService`).
- **Resolution unit (apps/plexus):** `published-bases.test.ts` — connection-backed, local-first, unreachable-degrades.
- **e2e (apps/plexus, Playwright):** `solution-explorer-connections.spec.ts` — Connections branch renders + decorated; New/Edit dialog opens; active-connection submenu on a consumer project; no new renderer errors. Seeded via a fixture `connections.json` in the test userData.
- **devUI regression:** run devUI's existing suite after the adoption edit; must stay green.

## Task decomposition (for the plan)

Bottom-up so each task is independently testable:

1. **Promote the main-process module** into `plexus-core/src/main/connections/` (stores, encryptor, engine) + unit tests (byte-compat, keyring-less).
2. **devUI adoption** — devUI composes from the promoted module; devUI suite green.
3. **apps/plexus IPC** — `connections-api.ts`, `ConnectionsBridge`, main composition, preload, `ConnectionsClient`.
4. **View seam** — `IConnectionView` / `ConnectionEditingService` / `IConnectionHost` + tests.
5. **Global `ConnectionsProvider`** + `ConnectionNodeKey` + `ConnectionsRootContributor` + glyphs + tests.
6. **Generalize `ProjectBranchesProvider`** to ordered leading branches + active-connection leaf + dispose-all + tests.
7. **`ConnectionActionsContributor`** + connection editor dialog + Delete routing + tests.
8. **Connection-aware `PublishedBases`** (local-first) + `RegistrySolutionWorkspaceHost` (per-project override map) + wiring in `SolutionExplorerService` / `ProjectExplorerService` + resolution tests.
9. **e2e** `solution-explorer-connections.spec.ts`.
