# P5b — Connections Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface user-global package-registry connections as a `Connections` branch under the Solution root, let each project pick the connection that resolves its references, and promote the connection host wiring + encrypted secret store into `plexus-core` (shared by `apps/devUI` and `apps/plexus`).

**Architecture:** Main-process authority (`PackageManagerService` + encrypted secret store) promoted into `packages/plexus-core/src/main/connections/`; `apps/plexus` gets a typed `connections:*` IPC bridge (Connections subset), a renderer client, and a `ConnectionEditingService` view seam mirroring P5a's `ReferenceEditingService`. The tree gets a global `ConnectionsProvider` under the Solution root and a per-project active-connection row via a generalized `ProjectBranchesProvider`. `apps/plexus`'s `PublishedBases` becomes connection-aware (local-first).

**Tech Stack:** TypeScript, Electron (main/preload/renderer), Mural hierarchy framework, `@pragmatic-tech-ai/todl/package-manager` engine, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-30-solution-hierarchy-p5b-connections-branch-design.md`

## Global Constraints

- **Repo scope:** `packages/plexus-core` + `apps/plexus` + one `apps/devUI` adoption edit only. **TODL and Mural are untouched.**
- **On-disk byte-compat:** the promoted store reads/writes devUI's exact layout — `conn-token-<id>.bin`, `connections.json`, `safeStorage` encryption. Code relocation, not a format change.
- **Secrets never cross the IPC bridge:** `ConnectionView.HasToken` only; tokens are write-only into main, read only in main.
- **Renderer import rule:** renderer imports connection *types* from `@pragmatic-tech-ai/todl/package-manager/connections` (browser-safe); the full `/package-manager` (fs/network) is main-only. Type-only imports of the full path in the client are acceptable (matches devUI).
- **Per-project connection choices live in `solution.json`,** never in `project.plexus`.
- **House style:** OOP (methods on classes, no module-level free functions/vars; module-level `const` only for true constants/enums/types); Allman braces; PascalCase interfaces + public methods; no inline string literals (hoist to `private static readonly`); VMs extend `Observable`; tests in `tests/` subfolders beside source; enums over string-literal unions.
- **Async-emission contract:** every provider's initial `ChildAdded` is emitted via `queueMicrotask` (after the model records `entry.dispose`), never synchronously inside `ObserveChildren`.
- **Test commands:** plexus-core/apps `npx vitest run <path>`; build `npm run build:plexus`; e2e from `apps/plexus`: `PLEXUS_TEST_CORPUS="C:/Users/Eugene/Projects/architecture-agent/plexus_test_projects" npx playwright test solution-explorer-connections`.

## Review Focus

1. **Removed connection that was a project's effective one** — dangling override id in `solution.json` must fall through (override → solution default → global default) and the active-connection row re-render, not error. Covered by Task 4 (`ActiveConnectionFor` fallback) + Task 8 (resolution).
2. **Keyring-less environment** (`safeStorage` unavailable) — token store degrades to in-memory, never writes plaintext. Covered by Task 1.
3. **Unreachable registry during resolution** — degrade to local-first, leave refs `Unresolved`, never hang tree realization. Covered by Task 8.
4. **Add id collision** (same display name) — bridge mints unique ids. Covered by Task 3.
5. **devUI on-disk continuity after promotion** — pre-promotion `connections.json` + `conn-token-<id>.bin` load unchanged through the promoted store. Covered by Task 1.

---

### Task 1: Promote the main-process connection module into plexus-core

**Files:**
- Create: `packages/plexus-core/src/main/connections/encryptor.ts`
- Create: `packages/plexus-core/src/main/connections/safe-storage-encryptor.ts`
- Create: `packages/plexus-core/src/main/connections/connection-token-store.ts`
- Create: `packages/plexus-core/src/main/connections/encrypted-secret-store.ts`
- Create: `packages/plexus-core/src/main/connections/file-connection-store.ts`
- Create: `packages/plexus-core/src/main/connections/process-environment-variables.ts`
- Create: `packages/plexus-core/src/main/connections/package-engine.ts`
- Create: `packages/plexus-core/src/main/connections/index.ts` (barrel)
- Test: `packages/plexus-core/src/main/connections/tests/connection-token-store.test.ts`
- Test: `packages/plexus-core/src/main/connections/tests/file-connection-store.test.ts`
- Test: `packages/plexus-core/src/main/connections/tests/package-engine.test.ts`

**Source of truth to copy from** (read, then re-implement — do not `git mv`, these are app files being promoted; keep behavior + on-disk layout identical):
`apps/devUI/src/main/registry/token-store.ts` (the `Encryptor` seam), `safe-storage-encryptor.ts`, `connection-token-store.ts`, `engine/encrypted-secret-store.ts`, `engine/file-connection-store.ts`, `engine/process-environment-variables.ts`, `engine/package-engine.ts`.

**Interfaces:**
- Consumes: `ISecretStore`, `IConnectionStore`, `IEnvironmentVariables`, `PackageManagerService`, npm factories, `DefaultPackageRegistryCatalog`, `ConnectionSpec` from `@pragmatic-tech-ai/todl/package-manager`.
- Produces: `Encryptor` (interface: `IsAvailable(): boolean`, `Encrypt(plain: string): Buffer`, `Decrypt(blob: Buffer): string`); `SafeStorageEncryptor`; `ConnectionTokenStore` (`HasToken(id)`, `GetToken(id)`, `SetToken(id, token)`, `Clear(id)`) ctor `(userDataDir: string, encryptor: Encryptor)`; `EncryptedSecretStore` (engine `ISecretStore`); `FileConnectionStore` (engine `IConnectionStore`) ctor `(userDataDir: string)`; `ProcessEnvironmentVariables`; `PackageEngine` ctor `(userDataDir: string, encryptor: Encryptor)` exposing `get Service(): PackageManagerService`.

> **Naming note:** devUI's stores use camelCase methods (`hasToken`); per house style, the promoted plexus-core versions use PascalCase public methods (`HasToken`). Update devUI call sites in Task 2.

- [ ] **Step 1: Write failing test — token store byte-compat + keyring-less fallback**

```ts
// tests/connection-token-store.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConnectionTokenStore } from '../connection-token-store.js'
import type { Encryptor } from '../encryptor.js'

// Reversible fake encryptor (base64) standing in for safeStorage.
class FakeEncryptor implements Encryptor
{
    constructor(private readonly available: boolean) {}
    public IsAvailable(): boolean { return this.available }
    public Encrypt(plain: string): Buffer { return Buffer.from(plain, 'utf8').toString('base64') as unknown as Buffer }
    public Decrypt(blob: Buffer): string { return Buffer.from(String(blob), 'base64').toString('utf8') }
}

describe('ConnectionTokenStore', () =>
{
    it('round-trips a token to <userData>/conn-token-<id>.bin (byte-compat layout)', () =>
    {
        const dir = mkdtempSync(join(tmpdir(), 'p5b-'))
        const store = new ConnectionTokenStore(dir, new FakeEncryptor(true))
        store.SetToken('npm-public', 'secret')
        expect(readdirSync(dir)).toContain('conn-token-npm-public.bin')
        expect(store.HasToken('npm-public')).toBe(true)
        expect(store.GetToken('npm-public')).toBe('secret')
    })

    it('when the encryptor is unavailable, keeps tokens in memory and writes NO plaintext file', () =>
    {
        const dir = mkdtempSync(join(tmpdir(), 'p5b-'))
        const store = new ConnectionTokenStore(dir, new FakeEncryptor(false))
        store.SetToken('x', 'secret')
        expect(store.GetToken('x')).toBe('secret')          // session memory
        expect(existsSync(join(dir, 'conn-token-x.bin'))).toBe(false)   // never plaintext
    })
})
```

- [ ] **Step 2: Run it, verify RED** — `npx vitest run packages/plexus-core/src/main/connections/tests/connection-token-store.test.ts` — Expected: FAIL (module not found / `ConnectionTokenStore` undefined).

- [ ] **Step 3: Implement `encryptor.ts`, `safe-storage-encryptor.ts`, `connection-token-store.ts`** — port from devUI, PascalCase public methods, Allman, injected `Encryptor`, file path `join(userDataDir, `conn-token-${id}.bin`)`, in-memory `Map` fallback when `!encryptor.IsAvailable()`.

- [ ] **Step 4: Run it, verify GREEN.**

- [ ] **Step 5: Write failing test — connection store byte-compat + legacy read** (`file-connection-store.test.ts`): write a `connections.json` in the devUI shape `{ version, defaultId, connections: ConnectionSpec[] }` into a temp dir, assert `All()` returns the specs and `DefaultId()` the id; write via `Save(spec)` and assert the file round-trips. Add a legacy-flat-record fixture and assert it maps to `ConnectionSpec`.

- [ ] **Step 6: Run RED, implement `file-connection-store.ts` + `encrypted-secret-store.ts` + `process-environment-variables.ts`, run GREEN.**

- [ ] **Step 7: Write failing test — engine composition** (`package-engine.test.ts`): construct `new PackageEngine(tmpDir, new FakeEncryptor(true))`, assert `engine.Service` is a `PackageManagerService`, `engine.Service.ListViews()` returns `[]` initially, and after `AddConnection({ Id:'', DisplayName:'npm-public', RegistryType:'npm', Settings:{} })` a view with `DisplayName==='npm-public'` appears. Run RED, implement `package-engine.ts` (register `ConnectionStoreKey`/`SecretStoreKey`/`EnvironmentVariablesKey` + npm factories + `DefaultPackageRegistryCatalog` + `PackageManagerService` into a `ServiceProvider`), add `index.ts` barrel, run GREEN.

- [ ] **Step 8: Commit**

```bash
git add packages/plexus-core/src/main/connections
git commit -m "feat(p5b): promote connection secret-store + engine into plexus-core"
```

**Completion:** `npx vitest run packages/plexus-core/src/main/connections`

---

### Task 2: devUI adopts the promoted module

**Files:**
- Modify: `apps/devUI/src/main/index.ts` (compose from `@pragmatic-tech-ai/plexus-core` main connections module; pass devUI's `app.getPath('userData')` + `SafeStorageEncryptor`).
- Delete: the now-duplicated `apps/devUI/src/main/registry/engine/{encrypted-secret-store,file-connection-store,process-environment-variables,package-engine}.ts`, `apps/devUI/src/main/registry/{connection-token-store,safe-storage-encryptor}.ts` (and `token-store.ts`'s `Encryptor` seam if unused after).
- Modify: any devUI call sites using the old camelCase store methods → PascalCase.
- Test: rely on devUI's existing suite (regression).

**Interfaces:**
- Consumes: Task 1's `PackageEngine`, `SafeStorageEncryptor`, `ConnectionTokenStore` (PascalCase).
- Produces: nothing new.

- [ ] **Step 1: Establish the baseline** — run devUI's full suite first and record the pass count. Run: `npx vitest run` from `apps/devUI` (or the repo's devUI test script). Expected: all green (baseline).

- [ ] **Step 2: Rewire `apps/devUI/src/main/index.ts`** — import `PackageEngine`, `SafeStorageEncryptor` from `@pragmatic-tech-ai/plexus-core` (main entry), delete the local copies, fix imports in `registry-bridge.ts` / `register-ipc.ts` to consume the promoted types. Keep devUI's `RegistryBridge` (publish/compile) intact.

- [ ] **Step 3: Delete the duplicated files** — remove the promoted-away files listed above.

- [ ] **Step 4: Rebuild + run devUI suite, verify still GREEN** — same command as Step 1; pass count must match (or exceed) the baseline. If a test fails, it is a real adoption regression — use systematic-debugging.

- [ ] **Step 5: Commit**

```bash
git add apps/devUI
git commit -m "refactor(p5b): devUI composes connections from plexus-core (no on-disk change)"
```

**Completion:** devUI suite green at the recorded baseline count.

---

### Task 3: apps/plexus connections IPC (api + bridge + main + preload + client)

**Files:**
- Create: `apps/plexus/src/shared/connections-api.ts` (channel enum + wire types + `IConnectionsApi`; model on `apps/plexus/src/shared/mcp-client-api.ts`).
- Create: `apps/plexus/src/main/connections/connections-bridge.ts` (`ConnectionsBridge`).
- Create: `apps/plexus/src/main/connections/register-connections-ipc.ts`.
- Modify: `apps/plexus/src/main/index.ts` (build `SafeStorageEncryptor` + `PackageEngine` + `ConnectionsBridge`, register channels).
- Modify: `apps/plexus/src/preload/index.ts` (`window.api.connections`).
- Create: `apps/plexus/src/renderer/src/services/connections/connections-client.ts` (`ConnectionsClient implements IConnectionsClient`).
- Test: `apps/plexus/src/main/connections/tests/connections-bridge.test.ts`.

**Interfaces:**
- Consumes: Task 1 `PackageEngine`, `PackageManagerService`, `ConnectionSpec`/`ConnectionView`.
- Produces: `ConnectionChannel` enum (`List='connections:list'`, `Add`, `Update`, `Remove`, `SetToken`, `UseEnvToken`, `SetDefault`, `Test`, `EnvVars`, `RegistryTypes`, `Presets`, `Schema`, `Resolve`); wire types `ConnectionViewWire`, `ConnectionTestResultWire { ok: boolean; message?: string }`; `IConnectionsClient` (renderer-facing, one async method per channel).

- [ ] **Step 1: Write failing test — bridge maps list/add/test and mints unique ids**

```ts
// tests/connections-bridge.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PackageEngine } from '@pragmatic-tech-ai/plexus-core/main/connections'
import { ConnectionsBridge } from '../connections-bridge.js'

class FakeEncryptor { IsAvailable() { return true } Encrypt(p: string) { return Buffer.from(p) } Decrypt(b: Buffer) { return b.toString() } }

describe('ConnectionsBridge', () =>
{
    const bridge = () => new ConnectionsBridge(new PackageEngine(mkdtempSync(join(tmpdir(), 'p5b-')), new FakeEncryptor() as never))

    it('add then list returns a ConnectionView with HasToken=false and no token field', async () =>
    {
        const b = bridge()
        await b.Add({ Id: '', DisplayName: 'npm-public', RegistryType: 'npm', Settings: {} })
        const views = await b.List()
        expect(views).toHaveLength(1)
        expect(views[0]!.DisplayName).toBe('npm-public')
        expect(views[0]!.HasToken).toBe(false)
        expect((views[0] as Record<string, unknown>).Token).toBeUndefined()   // secret never leaves main
    })

    it('adding two connections with the same display name mints distinct ids', async () =>
    {
        const b = bridge()
        await b.Add({ Id: '', DisplayName: 'dupe', RegistryType: 'npm', Settings: {} })
        await b.Add({ Id: '', DisplayName: 'dupe', RegistryType: 'npm', Settings: {} })
        const ids = (await b.List()).map((v) => v.Id)
        expect(new Set(ids).size).toBe(2)
    })
})
```

- [ ] **Step 2: Run RED** — Expected: FAIL (`ConnectionsBridge` undefined).

- [ ] **Step 3: Implement `connections-api.ts` (channel enum + wire types), then `connections-bridge.ts`** — `ConnectionsBridge` wraps `PackageManagerService`: `List()` → `ListViews()` mapped to wire (never token); `Add(spec)` mints an id (slugify `DisplayName`, uniquify against existing ids) then `AddConnection`; `Update/Remove/SetToken/UseEnvToken/SetDefault/Test/EnvVars/RegistryTypes/Presets/Schema` delegate; `Resolve(ref, connectionId?)` via `RegistryFor(id)` local-first. All public methods PascalCase.

- [ ] **Step 4: Run GREEN.**

- [ ] **Step 5: Wire IPC + preload + client** (no new test — exercised by e2e in Task 9): `register-connections-ipc.ts` binds each `ConnectionChannel` to a bridge method via `ipcMain.handle`; `apps/plexus/src/main/index.ts` builds the engine + bridge + registers; preload exposes `window.api.connections` (thin `ipcRenderer.invoke` per channel); `connections-client.ts` is the typed renderer wrapper implementing `IConnectionsClient`.

- [ ] **Step 6: Build to typecheck** — `npm run build:plexus`. Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/plexus/src/shared/connections-api.ts apps/plexus/src/main/connections apps/plexus/src/preload/index.ts apps/plexus/src/renderer/src/services/connections apps/plexus/src/main/index.ts
git commit -m "feat(p5b): apps/plexus connections IPC bridge + client"
```

**Completion:** `npx vitest run apps/plexus/src/main/connections` + `npm run build:plexus` clean.

---

### Task 4: View seam — IConnectionView / ConnectionEditingService / IConnectionHost

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/connection-view.ts` (`ConnectionHealth`, `ConnectionLeafView`, `IConnectionView`, `ConnectionViewKey`).
- Create: `packages/plexus-core/src/renderer/modules/project-explorer/services/connection-editing-service.ts` (`IConnectionHost`, `ConnectionEditingService`).
- Test: `packages/plexus-core/src/renderer/modules/project-explorer/services/tests/connection-editing-service.test.ts`.

**Interfaces:**
- Consumes: Task 3 `IConnectionsClient`; `ConnectionSpec`/`ConnectionPreset`/`ConnectionSettingField` from `@pragmatic-tech-ai/todl/package-manager/connections`; `SolutionMember`, `ProjectType` from `@pragmatic-tech-ai/todl`; `LiveValidationKey` from `../../../../projects/index.js`.
- Produces: `IConnectionView` (spec §View seam, verbatim), `ConnectionHealth` enum, `ConnectionLeafView`, `ConnectionViewKey`; `IConnectionHost`; `ConnectionEditingService implements IConnectionView`.

- [ ] **Step 1: Write failing test — view mapping (Health), fallback chain, RefreshBases on active change**

```ts
// tests/connection-editing-service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { SolutionMember } from '@pragmatic-tech-ai/todl'
import { ConnectionEditingService } from '../connection-editing-service.js'
import { ConnectionHealth } from '../../../solution-explorer/services/connection-view.js'
import type { IConnectionsClient } from '../../../../../src/renderer/src/services/connections/connections-client.js'
import type { IConnectionHost } from '../connection-editing-service.js'

const member = new SolutionMember({ path: 'p', type: 'architecture' })

function fakeClient(over: Partial<IConnectionsClient> = {}): IConnectionsClient
{
    return {
        List: async () => [{ Id: 'a', DisplayName: 'A', RegistryType: 'npm', IsDefault: true, HasToken: true }],
        Add: async () => {}, Update: async () => {}, Remove: async () => {},
        SetToken: async () => {}, UseEnvToken: async () => {}, SetDefault: async () => {},
        Test: async () => ({ ok: true }), EnvVars: async () => [], RegistryTypes: async () => ['npm'],
        Presets: async () => [], Schema: async () => [], Resolve: async () => undefined,
        ...over,
    } as IConnectionsClient
}

function fakeHost(over: Partial<IConnectionHost> = {}): IConnectionHost & { refreshed: SolutionMember[] }
{
    const refreshed: SolutionMember[] = []
    return Object.assign({
        refreshed,
        ProjectFor: () => ({ Factory: { requiresMetaModel: true } }) as never,
        SetStatus: () => {},
        SolutionDefaultConnectionId: () => undefined,
        ProjectConnectionOverride: () => undefined,
        SetProjectConnectionOverride: async () => {},
        RefreshBasesFor: async (m: SolutionMember) => { refreshed.push(m) },
    }, over)
}

describe('ConnectionEditingService', () =>
{
    it('maps a default connection with a token to Health.Default', async () =>
    {
        const svc = new ConnectionEditingService(fakeClient(), fakeHost())
        const views = await svc.ConnectionsView()
        expect(views[0]!.Health).toBe(ConnectionHealth.Default)
    })

    it('maps a non-default token-less connection to Health.NoCredentials', async () =>
    {
        const client = fakeClient({ List: async () => [{ Id: 'b', DisplayName: 'B', RegistryType: 'npm', IsDefault: false, HasToken: false }] })
        const views = await new ConnectionEditingService(client, fakeHost()).ConnectionsView()
        expect(views[0]!.Health).toBe(ConnectionHealth.NoCredentials)
    })

    it('ActiveConnectionFor falls back override -> solution default -> global default', async () =>
    {
        const host = fakeHost({ ProjectConnectionOverride: () => 'missing', SolutionDefaultConnectionId: () => undefined })
        const svc = new ConnectionEditingService(fakeClient(), host)   // client lists only global-default id 'a'
        const active = await svc.ActiveConnectionFor(member)
        expect(active!.Id).toBe('a')   // dangling override + no solution default → global default
    })

    it('SetActiveConnectionFor writes the override AND refreshes bases', async () =>
    {
        const host = fakeHost()
        const svc = new ConnectionEditingService(fakeClient(), host)
        const seen: (SolutionMember | undefined)[] = []
        svc.OnConnectionsViewChanged((m) => seen.push(m))
        await svc.SetActiveConnectionFor(member, 'a')
        expect(host.refreshed).toContain(member)
        expect(seen).toContain(member)
    })
})
```

- [ ] **Step 2: Run RED.**

- [ ] **Step 3: Implement `connection-view.ts` then `connection-editing-service.ts`** — `ConnectionsView()` maps each wire view + cached Test result → `Health` (`IsDefault` → `Default`; else `HasToken`/env → `Ready`; else `NoCredentials`; cached Test error → `Unreachable`). `ActiveConnectionFor` resolves effective id via host fallback, then finds it in the list (skip a dangling id). Mutators delegate to the client then `fire(undefined)`; `SetActiveConnectionFor` calls `host.SetProjectConnectionOverride` → `host.RefreshBasesFor(member)` → `fire(member)`. `IsConsumer(member)` = `host.ProjectFor(member)?.Factory.requiresMetaModel === true`.

- [ ] **Step 4: Run GREEN.**

- [ ] **Step 5: Commit** — `git commit -m "feat(p5b): IConnectionView + ConnectionEditingService seam"`

**Completion:** `npx vitest run packages/plexus-core/src/renderer/modules/project-explorer/services/tests/connection-editing-service.test.ts`

---

### Task 5: Global ConnectionsProvider + node key + root contributor + glyphs

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/connection-node-key.ts` (`ConnectionNodeKey { Leaf, Active }`).
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/connections-provider.ts`.
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/connections-root-contributor.ts`.
- Modify: `packages/plexus-core/src/renderer/modules/solution-explorer/services/icon-key-to-geometry.ts`.
- Test: `.../services/tests/connections-provider.test.ts`, and extend `.../tests/icon-key-to-geometry.test.ts`.

**Interfaces:**
- Consumes: Task 4 `IConnectionView`, `ConnectionLeafView`, `ConnectionHealth`; framework `HierarchyItemId`/`ChildAdded`/`ChildRemoved`/`ChildUpdated`/`NodeSeverity`/`HierarchyPropertyId`/`NodeKey`.
- Produces: `ConnectionNodeKey`; `ConnectionsProvider` (`ConnectionsRootId()`, `ConnectionsRootNode()`, `Owns(id)`, `IHierarchyProvider`); `ConnectionsRootContributor` (`ParentKeys=[NodeKey.Solution]`, returns a keyed `Connections` node + attaches `ProviderContribution(ConnectionsProvider)`).

- [ ] **Step 1: Write failing test — flat leaves, decoration, diff** (mirror `references-provider.test.ts`)

```ts
// tests/connections-provider.test.ts
import { describe, it, expect } from 'vitest'
import { HierarchyItemId, ChildAdded, NodeSeverity, type HierarchyChange } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime'
import { ConnectionsProvider } from '../connections-provider.js'
import { ConnectionNodeKey } from '../connection-node-key.js'
import { ConnectionHealth, type IConnectionView, type ConnectionLeafView } from '../connection-view.js'

const tick = () => new Promise((r) => setTimeout(r, 10))

function fakeView(list: ConnectionLeafView[]): IConnectionView & { fire: () => void; set: (l: ConnectionLeafView[]) => void }
{
    let handler: (() => void) | undefined
    let current = list
    return {
        fire: () => handler?.(), set: (l) => { current = l },
        ConnectionsView: async () => current,
        RegistryTypes: async () => [], PresetsFor: async () => [], SettingsSchemaFor: async () => [], EnvVars: async () => [],
        AddConnection: async () => {}, UpdateConnection: async () => {}, SetToken: async () => {}, UseEnvToken: async () => {},
        SetDefault: async () => {}, RemoveConnection: async () => {}, TestConnection: async () => ({ Ok: true }),
        IsConsumer: () => true, ActiveConnectionFor: async () => undefined, SetActiveConnectionFor: async () => {},
        OnConnectionsViewChanged: (h) => { handler = h as () => void; return { dispose() { handler = undefined } } as Disposable },
    }
}
const leaf = (Id: string, Health: ConnectionHealth): ConnectionLeafView => ({ Id, DisplayName: Id, RegistryType: 'npm', IsDefault: Health === ConnectionHealth.Default, HasToken: Health !== ConnectionHealth.NoCredentials, Health })

async function realize(p: ConnectionsProvider)
{
    const changes: HierarchyChange[] = []
    p.ObserveChildren(p.ConnectionsRootId(), (c) => changes.push(c))
    await tick()
    return changes
}

describe('ConnectionsProvider', () =>
{
    it('emits a flat leaf per connection, decorated by Health', async () =>
    {
        const p = new ConnectionsProvider(fakeView([leaf('a', ConnectionHealth.Default), leaf('b', ConnectionHealth.NoCredentials)]))
        const added = (await realize(p)).filter((c) => c instanceof ChildAdded) as ChildAdded[]
        expect(added.map((c) => c.Node.Caption).sort()).toEqual(['a (npm)', 'b (npm)'])
        expect(added.find((c) => c.Node.Caption === 'b (npm)')!.Node.Severity).toBe(NodeSeverity.Warning)
        expect(added.every((c) => c.Node.Key === ConnectionNodeKey.Leaf)).toBe(true)
    })

    it('a version/health change on the same id is a ChildUpdated; a removal is ChildRemoved', async () =>
    {
        const view = fakeView([leaf('a', ConnectionHealth.NoCredentials), leaf('b', ConnectionHealth.Ready)])
        const p = new ConnectionsProvider(view)
        const changes = await realize(p)
        changes.length = 0
        view.set([leaf('a', ConnectionHealth.Ready)])   // a improved, b removed
        view.fire()
        await tick()
        expect(changes.map((c) => c.constructor.name)).toContain('ChildUpdated')
        expect(changes.map((c) => c.constructor.name)).toContain('ChildRemoved')
    })
})
```

- [ ] **Step 2: Run RED.**

- [ ] **Step 3: Implement `connection-node-key.ts`, `connections-provider.ts`** — mirror `ReferencesProvider` minus groups: mint root, intern leaves by connection id, async-seed via `queueMicrotask`, diff on `OnConnectionsViewChanged`. Leaf caption `${DisplayName} (${RegistryType})`; `IconKey = ConnectionNodeKey.Leaf + suffix` (`-default`/`-ready`/`-nocreds`/`-unreachable`); `Severity = Warning` for `NoCredentials`/`Unreachable` with `Error` = `Message`. `Owns(id)` via an `ownedIds` set.

- [ ] **Step 4: Run GREEN.**

- [ ] **Step 5: Extend `icon-key-to-geometry.test.ts`** — assert `IconKeyGlyphs.For(NodeKey.Connections) === 'Folder'`, each `ConnectionNodeKey.Leaf + suffix` → non-empty, `ConnectionNodeKey.Active` → non-empty, and the undefined guard still holds. Run RED.

- [ ] **Step 6: Implement glyph mapping** — add `typeof iconKey === 'string' && iconKey.startsWith(ConnectionNodeKey.Leaf)` guard (return a connection glyph) + `NodeKey.Connections`/`ConnectionNodeKey.Active` switch cases. Run GREEN.

- [ ] **Step 7: Implement `connections-root-contributor.ts`** (no unit test; exercised in Task 8 wiring + Task 9 e2e) — `ParentKeys=[NodeKey.Solution]`, `Contribute(solutionNode)` returns a `NodeContribution` for the `Connections` node, and the service attaches `ProviderContribution(new ConnectionsProvider(view))` to it. (Match the projects-listing attachment pattern; confirm the exact contribution shape against `ProjectsListingContributor` during implementation.)

- [ ] **Step 8: Commit** — `git commit -m "feat(p5b): global ConnectionsProvider + node key + glyphs + root contributor"`

**Completion:** `npx vitest run packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/connections-provider.test.ts packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/icon-key-to-geometry.test.ts`

---

### Task 6: Generalize ProjectBranchesProvider (ordered leading branches + active-connection leaf)

**Files:**
- Modify: `packages/plexus-core/src/renderer/modules/solution-explorer/services/project-branches-provider.ts`.
- Test: `.../tests/project-branches-provider.test.ts` (extend the existing 3 tests).

**Interfaces:**
- Consumes: existing `ReferencesProvider`; a new lightweight `LeadingBranch` descriptor.
- Produces: `ProjectBranchesProvider` ctor `(files, leading: readonly LeadingBranch[])` where `LeadingBranch = { Owns(id): boolean; RootId(): HierarchyItemId; RootNode(): HierarchyNode; ObserveChildren(id, sink): () => void; GetProperty/GetCanonicalName/ParseCanonicalName/CanAccept; dispose(): void }`. The References branch and the active-connection leaf both implement it. Order is `[references, activeConnection]` then `files`.

> The active-connection leaf is a single row: its `ObserveChildren` on its own root emits nothing (no children); the composite emits its `ChildAdded(RootId, RootNode)` in the leading loop. `Owns` matches only its own id.

- [ ] **Step 1: Extend the failing test** — keep the existing 3 tests green by adapting them to the new ctor (wrap `refs` in a `LeadingBranch` adapter), then add:

```ts
it('emits every leading branch root in order before file children, and disposes all', async () =>
{
    const files = fakeFiles()
    const a = fakeLeading('refs')   // helper minting a root + Owns
    const b = fakeLeading('active')
    const p = new ProjectBranchesProvider(files.provider, [a, b])
    const added: HierarchyItemId[] = []
    p.ObserveChildren(HierarchyItemId.Root, (c) => { if (c instanceof ChildAdded) added.push(c.Id) })
    await new Promise((r) => setTimeout(r, 5))
    expect(added[0]).toBe(a.RootId())
    expect(added[1]).toBe(b.RootId())
    expect(added).toContain(files.fileChild)
    p.dispose()
    expect(a.disposed && b.disposed).toBe(true)   // both disposed (P5a leak fixed)
})
```

- [ ] **Step 2: Run RED** (old ctor signature / single-refs dispose).

- [ ] **Step 3: Generalize the implementation** — replace the single `refs` field with `leading: readonly LeadingBranch[]`; dispatch loops over `leading` (`find(b => b.Owns(id))`); root emission `queueMicrotask` emits each `ChildAdded(b.RootId(), b.RootNode())` in order; `dispose()` disposes every leading branch. Add a `ReferencesLeadingBranch` adapter over `ReferencesProvider` and an `ActiveConnectionLeadingBranch` (built from `IConnectionView` + member) — the latter serves its single row's `GetProperty` (Caption `Active connection: <name>`, Key `ConnectionNodeKey.Active`, `ExtObject {member}`) and refreshes on `OnConnectionsViewChanged`.

- [ ] **Step 4: Run GREEN** (new + all prior tests).

- [ ] **Step 5: Commit** — `git commit -m "feat(p5b): generalize ProjectBranchesProvider to ordered leading branches + active-connection row"`

**Completion:** `npx vitest run packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/project-branches-provider.test.ts`

---

### Task 7: ConnectionActionsContributor + editor dialog + Delete routing

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/connection-actions-contributor.ts`.
- Create: `packages/plexus-core/src/renderer/modules/project-explorer/services/connection-editor-dialog-model.ts` (VM extends `Observable`; parallels `ManageReferencesDialogModel`).
- Modify: the app dialog view (`.mu`) — mirror the Manage References modal's presentation (confirm the exact P5a dialog file during implementation).
- Test: `.../tests/connection-actions-contributor.test.ts`.

**Interfaces:**
- Consumes: Task 4 `IConnectionView`; framework `HierarchyAction`, `HierarchyActionContext`, `IHierarchyActionContributor`, `NodeKey`; `FileTreeContributor.MemberOf`.
- Produces: `ConnectionActionsContributor` (`ActionKeys=[NodeKey.Connections, ConnectionNodeKey.Leaf, ConnectionNodeKey.Active]`); `ConnectionEditorDialogModel`.

- [ ] **Step 1: Write failing test** (mirror `reference-actions-contributor.test.ts`): the `Connections` node offers `New Connection…`; a `Leaf` offers `Edit…`, `Test`, `Make Default` (current default → `canExecute` false), `Remove`; a multi-selected Remove removes each selected leaf by its own id; an `Active` node offers an `Active connection ▸` submenu whose current entry is non-executable and whose choice calls `SetActiveConnectionFor`.

- [ ] **Step 2: Run RED.**

- [ ] **Step 3: Implement `connection-actions-contributor.ts`** — switch on `anchor.Key`; async-filled submenus (`HierarchyAction.Command` then IIFE populates `Children`, empty → one disabled item); selection-aware Remove resolving each leaf's id from its `ExtObject`; `New…`/`Edit…` open `ConnectionEditorDialogModel`. Implement the dialog model (fields from `SettingsSchemaFor`/`PresetsFor`, masked write-only token, OK → `AddConnection`/`UpdateConnection` + `SetToken`/`UseEnvToken`).

- [ ] **Step 4: Run GREEN.**

- [ ] **Step 5: Commit** — `git commit -m "feat(p5b): ConnectionActionsContributor + connection editor dialog"`

**Completion:** `npx vitest run packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/connection-actions-contributor.test.ts`

---

### Task 8: Connection-aware resolution + workspace host + service wiring

**Files:**
- Modify: `apps/plexus/src/renderer/src/modules/meta-model/services/published-bases.ts` (connection-aware, local-first).
- Create/port: `apps/plexus` `RegistrySolutionWorkspaceHost` (implements `ISolutionWorkspaceHost`, adds per-project override map in `solution.json`); register `SolutionWorkspaceHostKey`.
- Modify: `packages/plexus-core/.../project-explorer/services/project-explorer-service.ts` (own `ConnectionEditingService`, expose `get Connections()`, provide `IConnectionHost`).
- Modify: `packages/plexus-core/.../solution-explorer/services/solution-explorer-service.ts` (`SetConnectionView`, register `ConnectionsRootContributor` + `ConnectionActionsContributor`, Delete routing, teardown).
- Modify: `packages/plexus-core/.../solution-explorer/services/file-tree-contributor.ts` (`SetConnectionView`, thread the active-connection leading branch into the composite, `IsConsumer` gate).
- Test: `apps/plexus/.../meta-model/services/tests/published-bases.test.ts`.

**Interfaces:**
- Consumes: Task 3 client/bridge (`Resolve`), Task 4 `IConnectionView`/`IConnectionHost`, Task 5 provider/contributor, Task 6 generalized composite, Task 7 actions.
- Produces: connection-backed `PublishedBases`; `RegistrySolutionWorkspaceHost` (`ListConnections`, `SetActiveConnection`, `DefaultConnectionId`, `ProjectOverride(path)`, `SetProjectOverride(path,id)`).

- [ ] **Step 1: Write failing test — resolution is connection-backed, local-first, and degrades when unreachable**

```ts
// published-bases.test.ts (shape; adapt ctor to the real PublishedBases deps)
it('resolves from the local store first, without touching the connection', async () => { /* local hit → no Resolve call */ })
it('falls back to the connection when the local store misses', async () => { /* local miss → client.Resolve called with effective id */ })
it('when the connection registry is unreachable, returns undefined (Unresolved) and does not throw/hang', async () => { /* Resolve rejects → resolve() returns undefined */ })
```

- [ ] **Step 2: Run RED.**

- [ ] **Step 3: Implement** — `PublishedBases` consults the existing local store first; on a miss, calls the client `Resolve(ref, effectiveConnectionId)` (effective id from the workspace host); a rejected/failed `Resolve` yields `undefined` (→ P5a `Unresolved`), never throws. Port `RegistrySolutionWorkspaceHost` with the per-project override map in `solution.json`; register `SolutionWorkspaceHostKey`.

- [ ] **Step 4: Run GREEN.**

- [ ] **Step 5: Wire the services** — `ProjectExplorerService`: construct `ConnectionEditingService(client, host)`, expose `get Connections()`, host bridges to `ISolutionWorkspaceHost` + `LiveValidationKey`. `SolutionExplorerService.rebuild`: `files.SetConnectionView(explorer.Connections)`, register `ConnectionsRootContributor` + `ConnectionActionsContributor`, teardown `off*`. `Delete`: `ConnectionNodeKey.Leaf` → selection-aware remove; `NodeKey.Connections`/`ConnectionNodeKey.Active` → inert. `FileTreeContributor`: `SetConnectionView`, add the `ActiveConnectionLeadingBranch` to the composite's leading list (gated by `IConnectionView.IsConsumer`).

- [ ] **Step 6: Build + run the affected suites** — `npm run build:plexus`; `npx vitest run packages/plexus-core apps/plexus` (targeted at the changed modules). Expected: green, tsc clean.

- [ ] **Step 7: Commit** — `git commit -m "feat(p5b): connection-aware resolution + workspace host + tree wiring"`

**Completion:** `npx vitest run apps/plexus/src/renderer/src/modules/meta-model/services/tests/published-bases.test.ts` + `npm run build:plexus`.

---

### Task 9: e2e — Connections branch

**Files:**
- Create: `apps/plexus/e2e/solution-explorer-connections.spec.ts` (mirror `solution-explorer-references.spec.ts`).
- Create: an e2e fixture `connections.json` seeded into the test userData.

**Interfaces:**
- Consumes: the whole feature, launched.
- Produces: nothing.

- [ ] **Step 1: Write the e2e** — seed a `connections.json` (one npm connection) into the launched app's userData; expand the Solution root; assert the `Connections` branch renders with the seeded leaf decorated; open the `New Connection…`/`Edit…` dialog and assert it appears; on a consumer project, open the `Active connection ▸` submenu and assert it lists the connection; assert `appErrors(l.errors)` shows no new renderer errors. Use the P5a harness patterns (`cloneCorpus`, `seedSession`, `launchPlexus`, `waitForRow`, click-row + ArrowRight to expand, right-click near the row Border left edge).

- [ ] **Step 2: Build + run** — `npm run build:plexus` then `PLEXUS_TEST_CORPUS="C:/Users/Eugene/Projects/architecture-agent/plexus_test_projects" npx playwright test solution-explorer-connections` from `apps/plexus`. Expected: 1/1 pass. Debug hangs/empty-tree with the P5a lessons (async-emit contract, undefined-IconKey guard) via systematic-debugging.

- [ ] **Step 3: Commit** — `git commit -m "test(p5b): e2e Connections branch"`

**Completion:** e2e 1/1 pass.

---

## Self-review

- **Spec coverage:** tree shape (T5,T6) · decoration (T5) · global provider (T5) · active-connection row (T6) · view seam (T4) · main-process promotion (T1) · devUI adoption (T2) · IPC (T3) · resolution (T8) · reactivity (T4,T8) · editor dialog (T7) · actions (T7) · workspace host/storage (T8) · e2e (T9). All spec sections map to a task.
- **Review Focus:** dangling override → T4 test + T8; keyring-less → T1 test; unreachable registry → T8 test; id collision → T3 test; devUI on-disk continuity → T1 test. All five pinned to a task's tests.
- **Type consistency:** `IConnectionView`/`ConnectionLeafView`/`ConnectionHealth` defined in T4, consumed identically in T5/T6/T7; `IConnectionsClient` produced in T3, consumed in T4; `LeadingBranch` produced in T6, its adapters consumed in T8 wiring; `PackageEngine` ctor `(userDataDir, encryptor)` consistent across T1/T2/T3.
- **Placeholders:** none — each task carries real test code or a concrete, named implementation contract; the two `.mu`/attachment-shape confirmations (T5 root contributor, T7 dialog view) are explicitly "confirm against the P5a analog during implementation", not deferred design.
