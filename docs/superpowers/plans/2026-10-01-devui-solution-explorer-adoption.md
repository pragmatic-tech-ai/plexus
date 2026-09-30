# devUI Solution/Project Explorer Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate apps/devUI off the legacy `solution-studio` panel onto the modern solution/project explorer stack (bag-catalog connections), hosted in devUI's ViewerShell, and delete the dead panel code.

**Architecture:** devUI's renderer swaps `HomeModule` + `SolutionStudioModule` for `TodlProjectSystemModule` + `ProjectExplorerModule` + a devUI `ConnectionsModule` + `SolutionExplorerModule`, with the explorer hosted as a rail capability and file-open routed to devUI's own Monaco editor. The connection backend is unchanged (devUI main already composes the same `PackageEngine`); a renderer `IConnectionsClient` adapter maps onto devUI's existing `window.todl.connections.*` bridge, and a new `Resolve` path (shared `SourcedPackageReader`) feeds catalog package resolution. The old panel is deleted last, preserving the `SolutionStudioSeams` that apps/plexus still imports.

**Tech Stack:** TypeScript, mural framework (ViewerShell, DI `ServiceProvider`/`ServiceKey`, `.mu` composition), `@pragmatic-tech-ai/todl` (`TodlProjectSystemModule`, `PackageManagerService`, bag catalog), `@pragmatic-tech-ai/plexus-core` (project-explorer / solution-explorer / bags / main-connections), Electron (main/preload/renderer), vitest (unit), playwright (`_electron` smoke), electron-vite (build).

**Spec:** `docs/superpowers/specs/2026-10-01-devui-solution-explorer-adoption-design.md`

## Global Constraints

- OOP, no globals: behavior in classes/methods; no module-level free functions or mutable module state.
- Allman braces (opening brace on its own line), hand-maintained.
- PascalCase for interfaces and all public methods; private members and JSON-mirroring data props keep their casing.
- No inline string literals: hoist reused/user-facing strings (labels, keys, IPC channel names, property names) to `private static readonly` constants.
- View models extend `Observable`, not `MuralBase`, unless a dependency property is genuinely needed.
- Enums over string-literal unions.
- Secrets never in a bag or across IPC — only `TokenRef`/`TokenEnvVar`/`HasToken`.
- Tests live in a `tests/` subfolder beside their source.
- Always adopt the latest published workspace package versions.
- apps/plexus behavior must stay unchanged (only the shared `solution-studio` seams subpath is common).
- devUI's Registry Connections manager rail (`ConnectionsManagerModule` over `RegistryBridge`) stays untouched.

## Review Focus

The input classes/failure modes most likely to bite that no task's happy-path test exercises (each pinned to a task below):

1. **Unreachable/missing registry on Resolve** — a package the connection can't fetch must degrade to `undefined` (local-first), never throw or hang. Pinned in Task 2 (`SourcedPackageReader` returns `undefined`; devUI `Resolve` swallows).
2. **Binary resource bytes survive Resolve** — icons/presentation assets must round-trip byte-faithfully (not corrupted by a text decode). Pinned in Task 2 (0xFF/0xFE bytes assertion).
3. **Connections bridge absent (non-Electron/test host)** — the renderer client + package resolver must not crash app startup; resolution falls back to local-only. Pinned in Task 3 (`LocalOnlyPackageResolver` path when `window.todl` is absent).
4. **No remembered solution on startup** — with Home dropped, devUI must open an ambient/untitled solution (not a blank rail) when `RestoreSession` finds nothing. Pinned in Task 5 (ambient-solution smoke).
5. **apps/plexus still resolves the shared seams after deletion** — retiring the panel must not break apps/plexus's `SolutionStudioSeams` import. Pinned in Task 6 (apps/plexus vitest + the `solution-manager-wiring` test stay green).

---

### Task 1: devUI typecheck gate

Foundational: apps/devUI has no `typecheck` script, so the root `typecheck --workspaces` silently skips it. Add one so every later task can gate on types.

**Files:**
- Modify: `apps/devUI/package.json` (scripts)
- Reference: `apps/plexus/package.json` (`typecheck`, `typecheck:node`, `typecheck:web`)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run typecheck` in apps/devUI (runs `tsc --noEmit` over devUI's node + web tsconfigs).

- [ ] **Step 1: Inspect devUI's tsconfigs**

Run: `ls apps/devUI/tsconfig*.json` and open each. Confirm `tsconfig.node.json` (main/preload) and `tsconfig.web.json` (renderer) exist (mirroring apps/plexus). If devUI uses different names, use those exact names below.

- [ ] **Step 2: Add the typecheck scripts**

In `apps/devUI/package.json` `"scripts"`, add (matching apps/plexus's split):

```json
"typecheck:node": "tsc --noEmit -p tsconfig.node.json",
"typecheck:web": "tsc --noEmit -p tsconfig.web.json",
"typecheck": "npm run typecheck:node && npm run typecheck:web"
```

- [ ] **Step 3: Run it to capture the baseline**

Run: `cd apps/devUI && npm run typecheck`
Expected: exits 0 (clean) OR a small set of pre-existing errors. Record the baseline in the commit message; later tasks must not regress it. If non-zero from pre-existing errors, note them — do not fix unrelated code here.

- [ ] **Step 4: Commit**

```bash
git add apps/devUI/package.json
git commit -m "build(devui): add typecheck script (was skipped by root --workspaces)"
```

---

### Task 2: Shared `SourcedPackageReader` + devUI main `Resolve`

Extract the tarball→`SourcedPackage` mapping (currently inline in apps/plexus `ConnectionsBridge.Resolve`, proven by `connections-bridge-resolve.test.ts`) into a shared plexus-core class, then give devUI's main a `Resolve` path over its existing `PackageEngine`.

**Files:**
- Create: `packages/plexus-core/src/main/connections/sourced-package-reader.ts`
- Create: `packages/plexus-core/src/main/connections/tests/sourced-package-reader.test.ts`
- Modify: `packages/plexus-core/src/main/connections/index.ts` (export the reader)
- Modify: `apps/plexus/src/main/connections/connections-bridge.ts` (use the shared reader — behavior identical)
- Modify: `apps/devUI/src/main/registry/registry-bridge.ts` (add `Resolve`)
- Modify: `apps/devUI/src/main/registry/register-ipc.ts` (add `connections:resolve`)
- Modify: `apps/devUI/src/preload/index.ts` (add `connections.resolve`)
- Modify: `apps/devUI/src/renderer/env.d.ts` (add `resolve` to `connections`)
- Test: `apps/devUI/src/main/registry/tests/registry-bridge-resolve.test.ts`

**Interfaces:**
- Consumes: `PackageManagerService.RegistryFor(connectionId?)`, `PackageRegistryClient`, `TarReader` (from `@pragmatic-tech-ai/todl/package-manager`); `SourcedPackage`, `PackageResource` (from `@pragmatic-tech-ai/todl`).
- Produces:
  - `class SourcedPackageReader { public static FromTarball(tarball: Uint8Array): SourcedPackage | undefined }`
  - `RegistryBridge.Resolve(id: string, version: string, connectionId?: string): Promise<SourcedPackage | undefined>`
  - IPC channel `connections:resolve`; preload `window.todl.connections.resolve(id, version, connectionId?)`.

- [ ] **Step 1: Write the failing test for `SourcedPackageReader`**

Create `packages/plexus-core/src/main/connections/tests/sourced-package-reader.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createTgz } from '@pragmatic-tech-ai/todl/package-manager'
import { SourcedPackageReader } from '../sourced-package-reader.js'

const Icon = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x3c, 0x3f])   // 0xff/0xfe corrupt under a text round-trip
const Dep = { name: '@acme/dep', version: '1.0.0' }

function model(): Uint8Array
{
    return new TextEncoder().encode(JSON.stringify({ nodes: [], edges: [], dependencies: [Dep] }))
}

describe('SourcedPackageReader.FromTarball', () =>
{
    it('maps model.json + resources into a byte-faithful SourcedPackage', () =>
    {
        const tgz = createTgz([
            { path: 'package/model.json', bytes: model() },
            { path: 'package/resources/icon.svg', bytes: Icon },
        ])
        const sourced = SourcedPackageReader.FromTarball(tgz)
        expect(sourced).toBeDefined()
        expect(sourced!.resources).toHaveLength(1)
        expect(sourced!.resources![0]!.path).toBe('icon.svg')
        expect(Array.from(sourced!.resources![0]!.bytes)).toEqual(Array.from(Icon))
        expect(sourced!.Dependencies).toEqual([Dep])
    })

    it('returns undefined when there is no model.json', () =>
    {
        const tgz = createTgz([{ path: 'package/resources/only.svg', bytes: Icon }])
        expect(SourcedPackageReader.FromTarball(tgz)).toBeUndefined()
    })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd packages/plexus-core && npx vitest run src/main/connections/tests/sourced-package-reader.test.ts`
Expected: FAIL — `Cannot find module '../sourced-package-reader.js'`.

- [ ] **Step 3: Implement `SourcedPackageReader`**

Create `packages/plexus-core/src/main/connections/sourced-package-reader.ts` (lift the mapping verbatim from apps/plexus `connections-bridge.ts:96-117`):

```ts
import { TarReader } from '@pragmatic-tech-ai/todl/package-manager'
import type { SourcedPackage, PackageResource } from '@pragmatic-tech-ai/todl'

// Reads a published package tarball into a SourcedPackage (model.json document + recorded deps +
// its resource tree). Byte-faithful: resource bytes are carried through untouched so binary assets
// (icons) survive rather than a lossy text round-trip. Returns undefined for a non-TODL tarball
// (no model.json) — callers treat that as "not resolvable", never an error.
export class SourcedPackageReader
{
    private static readonly ModelPath = 'package/model.json'
    private static readonly ResourcePrefix = 'package/resources/'
    private static readonly Decoder = new TextDecoder()

    public static FromTarball(tarball: Uint8Array): SourcedPackage | undefined
    {
        const entries = TarReader.read(tarball)
        const modelBytes = entries.find((e) => e.path === SourcedPackageReader.ModelPath)?.bytes
        if (modelBytes === undefined) return undefined
        const document = JSON.parse(SourcedPackageReader.Decoder.decode(modelBytes)) as { nodes: unknown[]; edges: unknown[]; dependencies?: SourcedPackage['Dependencies'] }
        const resources: PackageResource[] = entries
            .filter((e) => e.path.startsWith(SourcedPackageReader.ResourcePrefix))
            .map((e) => ({ path: e.path.slice(SourcedPackageReader.ResourcePrefix.length), bytes: e.bytes }))
        const sourced: SourcedPackage = { Document: document as unknown as SourcedPackage['Document'], Dependencies: document.dependencies ?? [] }
        if (resources.length > 0) sourced.resources = resources
        return sourced
    }
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd packages/plexus-core && npx vitest run src/main/connections/tests/sourced-package-reader.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Export the reader + re-point apps/plexus ConnectionsBridge onto it**

In `packages/plexus-core/src/main/connections/index.ts`, add `export { SourcedPackageReader } from './sourced-package-reader.js'`.

In `apps/plexus/src/main/connections/connections-bridge.ts`, replace the inline mapping in `Resolve` (lines ~108-117) with:

```ts
const tarball = await new PackageRegistryClient(registry).getContent({ name: id, version })
return SourcedPackageReader.FromTarball(tarball)
```

Import `SourcedPackageReader` from `@pragmatic-tech-ai/plexus-core/main/connections`. Remove the now-unused `TarReader` import + the `ModelPath`/`ResourcePrefix`/`Decoder` constants if nothing else uses them.

- [ ] **Step 6: Verify apps/plexus's existing Resolve test still passes (behavior unchanged)**

Run: `cd packages/plexus-core && npm run build && cd ../../apps/plexus && npx vitest run src/main/connections/tests/connections-bridge-resolve.test.ts`
Expected: PASS (3/3) — the extraction preserved behavior.

- [ ] **Step 7: Write the failing test for devUI's `RegistryBridge.Resolve`**

Create `apps/devUI/src/main/registry/tests/registry-bridge-resolve.test.ts`, modeled on `apps/plexus/src/main/connections/tests/connections-bridge-resolve.test.ts` (same in-memory `FakeRegistryTransport` + `FakeEncryptor` + fixture tarball), but constructing devUI's `RegistryBridge` (`{ service: engine.Service, createCompiler, localStore }`) and asserting `await bridge.Resolve('@acme/widget', '1.2.3')` returns a `SourcedPackage` with the byte-faithful `icon.svg` resource, plus `undefined` for a never-published package. Copy the fake-transport + fixture blocks from that reference file (they are the working pattern).

- [ ] **Step 8: Run it — verify it fails**

Run: `cd apps/devUI && npx vitest run src/main/registry/tests/registry-bridge-resolve.test.ts`
Expected: FAIL — `bridge.Resolve is not a function`.

- [ ] **Step 9: Implement `RegistryBridge.Resolve`**

In `apps/devUI/src/main/registry/registry-bridge.ts`, add (using the same `service` the bridge already holds):

```ts
public async Resolve(id: string, version: string, connectionId?: string): Promise<SourcedPackage | undefined>
{
    try
    {
        const registry = await this.service.RegistryFor(connectionId)
        const tarball = await new PackageRegistryClient(registry).getContent({ name: id, version })
        return SourcedPackageReader.FromTarball(tarball)
    }
    catch
    {
        return undefined
    }
}
```

Add imports: `PackageRegistryClient` from `@pragmatic-tech-ai/todl/package-manager`, `SourcedPackageReader` from `@pragmatic-tech-ai/plexus-core/main/connections`, and type `SourcedPackage` from `@pragmatic-tech-ai/todl`. (Confirm the bridge field holding the engine service is named `service`/`this.service`; use the actual name.)

- [ ] **Step 10: Wire the IPC channel + preload + env type**

In `apps/devUI/src/main/registry/register-ipc.ts`, add inside `RegistryIpc.register`:

```ts
ipcMain.handle("connections:resolve", (_e, id: string, version: string, connectionId?: string) => bridge.Resolve(id, version, connectionId));
```

In `apps/devUI/src/preload/index.ts`, add to the `connections:` object:

```ts
resolve: (id: string, version: string, connectionId?: string) => ipcRenderer.invoke("connections:resolve", id, version, connectionId),
```

In `apps/devUI/src/renderer/env.d.ts`, add to `TodlBridge.connections`:

```ts
resolve(id: string, version: string, connectionId?: string): Promise<SourcedPackage | undefined>;
```

Import `SourcedPackage` from `@pragmatic-tech-ai/todl` in `env.d.ts`.

- [ ] **Step 11: Run devUI's Resolve test + typecheck**

Run: `cd apps/devUI && npx vitest run src/main/registry/tests/registry-bridge-resolve.test.ts && npm run typecheck`
Expected: test PASS; typecheck no worse than the Task 1 baseline.

- [ ] **Step 12: Commit**

```bash
git add packages/plexus-core/src/main/connections apps/plexus/src/main/connections/connections-bridge.ts apps/devUI/src/main/registry apps/devUI/src/preload/index.ts apps/devUI/src/renderer/env.d.ts
git commit -m "feat(connections): shared SourcedPackageReader + devUI main Resolve path"
```

---

### Task 3: devUI `IConnectionsClient` adapter + package resolver (renderer)

Provide the renderer seam the catalog `ConnectionEditingService` resolves (`ConnectionsClientKey`) and the package resolver the connection-aware store calls — both over devUI's existing `window.todl` bridge.

**Files:**
- Create: `apps/devUI/src/renderer/services/connections/devui-connections-client.ts`
- Create: `apps/devUI/src/renderer/services/connections/devui-connection-resolve-api.ts`
- Test: `apps/devUI/src/renderer/services/connections/tests/devui-connections-client.test.ts`

**Interfaces:**
- Consumes: `IConnectionsClient`, `ConnectionsClientKey`, `ConnectionTestResult` (from `@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connections-client.js`); `ConnectionView`, `ConnectionSpec` (from `@pragmatic-tech-ai/todl/package-manager/connections`); `ConnectionResolveApi` (from `@pragmatic-tech-ai/plexus-core/renderer/projects` — confirm the exact export path for `AppConnectionPackageResolver`/`ConnectionResolveApi`); devUI's `window.todl.connections.*`.
- Produces: `class DevUiConnectionsClient implements IConnectionsClient` (registered under `ConnectionsClientKey`); `class DevUiConnectionResolveApi implements ConnectionResolveApi`.

- [ ] **Step 1: Write the failing test (PascalCase→lowercase mapping + missing-bridge fallback)**

Create `apps/devUI/src/renderer/services/connections/tests/devui-connections-client.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DevUiConnectionsClient } from '../devui-connections-client.js'

// A fake window.todl.connections (lowercase) recording calls.
function fakeBridge(): { calls: string[]; connections: Record<string, unknown> }
{
    const calls: string[] = []
    const connections = {
        list: async () => { calls.push('list'); return [] },
        add: async (s: unknown) => { calls.push('add'); return s },
        setDefault: async (id: string) => { calls.push('setDefault:' + id) },
        test: async () => { calls.push('test'); return { ok: true } },
        listEnvVars: async () => { calls.push('listEnvVars'); return [] },
    }
    return { calls, connections }
}

describe('DevUiConnectionsClient', () =>
{
    it('maps PascalCase IConnectionsClient calls onto the lowercase todl bridge', async () =>
    {
        const fake = fakeBridge()
        ;(globalThis as unknown as { window?: unknown }).window = { todl: { connections: fake.connections } }
        const client = new DevUiConnectionsClient()
        await client.List()
        await client.SetDefault('x')
        await client.EnvVars()
        expect(fake.calls).toEqual(['list', 'setDefault:x', 'listEnvVars'])
    })
})
```

(Confirm the node/happy-dom env for this vitest file; if the config is node-only, set `window` on `globalThis` as above.)

- [ ] **Step 2: Run it — verify it fails**

Run: `cd apps/devUI && npx vitest run src/renderer/services/connections/tests/devui-connections-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `DevUiConnectionsClient`**

Create `apps/devUI/src/renderer/services/connections/devui-connections-client.ts`. Model the class shape on `apps/plexus/.../services/connections/connections-client.ts`, but delegate to `window.todl.connections.*` (lowercase) instead of `window.api.connections` (PascalCase):

```ts
import type { IConnectionsClient, ConnectionTestResult } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connections-client.js'
import type { ConnectionView, ConnectionSpec } from '@pragmatic-tech-ai/todl/package-manager/connections'

// The renderer IConnectionsClient the catalog ConnectionEditingService resolves, mapped onto
// devUI's existing window.todl.connections bridge (lowercase). Tokens are write-only.
export class DevUiConnectionsClient implements IConnectionsClient
{
    private bridge()
    {
        const todl = (window as unknown as { __todlBridge?: { connections: unknown }; todl?: { connections: unknown } })
        const b = (todl.__todlBridge ?? todl.todl)?.connections
        if (b === undefined) throw new Error('DevUiConnectionsClient: window.todl.connections is unavailable')
        return b as {
            list(): Promise<ConnectionView[]>
            add(spec: ConnectionSpec): Promise<ConnectionView>
            update(id: string, partial: Partial<ConnectionSpec>): Promise<ConnectionView | undefined>
            remove(id: string): Promise<void>
            setToken(id: string, token: string): Promise<void>
            useEnvToken(id: string, name: string): Promise<void>
            setDefault(id: string): Promise<void>
            test(id: string): Promise<ConnectionTestResult>
            listEnvVars(): Promise<string[]>
        }
    }

    public List(): Promise<readonly ConnectionView[]> { return this.bridge().list() }
    public Add(spec: ConnectionSpec): Promise<ConnectionView> { return this.bridge().add(spec) }
    public Update(id: string, partial: Partial<ConnectionSpec>): Promise<ConnectionView | undefined> { return this.bridge().update(id, partial) }
    public Remove(id: string): Promise<void> { return this.bridge().remove(id) }
    public SetToken(id: string, token: string): Promise<void> { return this.bridge().setToken(id, token) }
    public UseEnvToken(id: string, varName: string): Promise<void> { return this.bridge().useEnvToken(id, varName) }
    public SetDefault(id: string): Promise<void> { return this.bridge().setDefault(id) }
    public Test(id: string): Promise<ConnectionTestResult> { return this.bridge().test(id) }
    public EnvVars(): Promise<readonly string[]> { return this.bridge().listEnvVars() }
}

export default DevUiConnectionsClient
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd apps/devUI && npx vitest run src/renderer/services/connections/tests/devui-connections-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `DevUiConnectionResolveApi`**

Create `apps/devUI/src/renderer/services/connections/devui-connection-resolve-api.ts` — the `ConnectionResolveApi` view `AppConnectionPackageResolver` consumes, over `window.todl.connections.resolve`:

```ts
import type { SourcedPackage } from '@pragmatic-tech-ai/todl'
import type { ConnectionResolveApi } from '@pragmatic-tech-ai/plexus-core/renderer/projects'   // confirm export path

// Feeds AppConnectionPackageResolver: resolve a published package from a connection's registry,
// best-effort (undefined on any failure), over devUI's existing bridge.
export class DevUiConnectionResolveApi implements ConnectionResolveApi
{
    public Resolve(id: string, version: string, connectionId?: string): Promise<SourcedPackage | undefined>
    {
        const todl = (window as unknown as { __todlBridge?: { connections: { resolve(id: string, version: string, connectionId?: string): Promise<SourcedPackage | undefined> } }; todl?: { connections: { resolve(id: string, version: string, connectionId?: string): Promise<SourcedPackage | undefined> } } })
        const b = (todl.__todlBridge ?? todl.todl)?.connections
        if (b === undefined) return Promise.resolve(undefined)   // non-Electron/test host: local-only
        return b.resolve(id, version, connectionId)
    }
}
```

(Confirm `ConnectionResolveApi` / `AppConnectionPackageResolver` / `LocalOnlyPackageResolver` export path — it is in `apps/plexus/.../services/projects/app-connection-package-resolver.ts`; if not exported from plexus-core, promote the interface `ConnectionResolveApi` + `AppConnectionPackageResolver` + `LocalOnlyPackageResolver` into `packages/plexus-core/src/renderer/projects/` and export them, since devUI needs them too. That promotion is part of this step.)

- [ ] **Step 6: Run typecheck**

Run: `cd apps/devUI && npm run typecheck`
Expected: no worse than baseline. (Wiring these into the container happens in Task 4.)

- [ ] **Step 7: Commit**

```bash
git add apps/devUI/src/renderer/services/connections packages/plexus-core/src/renderer/projects
git commit -m "feat(devui): IConnectionsClient adapter + connection resolve api over the todl bridge"
```

---

### Task 4: devUI renderer stack adoption (modules, registries, lifecycle, file-open)

Compose the new explorer stack in devUI's ViewerShell, replacing `SolutionStudioModule`. This is integration wiring — verified by typecheck + `electron-vite build` (not a unit test), mirroring `apps/plexus/src/renderer/src/app.mu` + `main.js`.

**Files:**
- Modify: `apps/devUI/src/renderer/app.mu`
- Modify: `apps/devUI/src/renderer/main.ts`
- Create: `apps/devUI/src/renderer/modules/connections/*` (a devUI ConnectionsModule composing `DevUiConnectionsClient` → `ConnectionsClientKey`) — mirror `apps/plexus/src/renderer/src/modules/connections/connections.module.mu` minus the app-local editor launcher (devUI reuses its Registry Connections manager for editing).
- Reference: `apps/plexus/src/renderer/src/app.mu` (module list, `.services:` Hierarchy registries, resource merges), `apps/plexus/src/renderer/src/main.js` (ProjectTreeHostKey alias, Start() lifecycle, package-source wiring).

**Interfaces:**
- Consumes: Task 3's `DevUiConnectionsClient` (→ `ConnectionsClientKey`), `DevUiConnectionResolveApi`; `TodlProjectSystemModule` (from `@pragmatic-tech-ai/todl`); `ProjectExplorerModule`, `SolutionExplorerModule` (from `@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer` and `.../solution-explorer`); `HierarchyContributorRegistry`, `HierarchyActionContributorRegistry` (from `@pragmatic-tech-ai/mural/framework/hierarchy`); `ProjectExplorerService`, `ProjectTreeHostKey` (plexus-core project-explorer); `AppConnectionPackageResolver` / package-source keys.
- Produces: a devUI renderer that shows the new Solution Explorer rail capability and opens member files in devUI's editor.

- [ ] **Step 1: Add the new modules to `app.mu`**

In `apps/devUI/src/renderer/app.mu`, add imports (module consts + resources) mirroring the corresponding lines in `apps/plexus/src/renderer/src/app.mu`:
- `TodlProjectSystemModule` from `@pragmatic-tech-ai/todl`
- `ProjectExplorerModule` + `ProjectExplorerResources` from `@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer`
- `SolutionExplorerModule` + `SolutionExplorerResources` from `@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer`
- the new devUI `ConnectionsModule` + its resources
- `HierarchyContributorRegistry`, `HierarchyActionContributorRegistry` from `@pragmatic-tech-ai/mural/framework/hierarchy`

In `.services:` add `HierarchyContributorRegistry` and `HierarchyActionContributorRegistry` (as apps/plexus app.mu does).
In `.modules:` replace `SolutionStudioModule` with the ordered set: `TodlProjectSystemModule`, `ProjectExplorerModule`, `ConnectionsModule`, `SolutionExplorerModule` (keep `Storage` first; keep `PackageManagerModule`, `PackageCompilerModule`, `ConnectionsManagerModule`, `PragmaticWindowChrome`). Leave `HomeModule` for Task 5.
In `resources:` add `merge ProjectExplorerResources`, `merge SolutionExplorerResources`, and the devUI connections resources; remove the (now-unused) solution-studio resource merge if present.

- [ ] **Step 2: Wire bootstrap in `main.ts`**

In `apps/devUI/src/renderer/main.ts`, mirror `apps/plexus/src/renderer/src/main.js`:
- Register `DevUiConnectionsClient` under `ConnectionsClientKey` (or via the ConnectionsModule from Step 1 — pick one home and keep it single).
- Alias `ProjectTreeHostKey → ProjectExplorerService` (`app.Services.get`/instance-alias pattern apps/plexus uses).
- Wire the **file-open seam**: route `ProjectExplorerService.OpenMemberFile(member, path, kind)` to devUI's Monaco editor via `ContentHostService` (open the file content in the central content host). Follow how devUI's package-manager `editor-pane-vm` mounts the editor in the content host; the seam is: on activate, load the file and `ContentHostService.View(<editor VM for that file>)`.
- Add the lifecycle in apps/plexus's order: after `DurableApplicationStore.Restore()` and before/around `RestoreSession()`, call `ProjectExplorerService.Start()` (+ `.RestoreSession()` if it has one) then `SolutionExplorerService.Start()`.
- Keep `SolutionStudioSeams.Register` (still supplies the prompt + storage seams) and `SolutionServicesEngine`.

- [ ] **Step 3: Create the devUI ConnectionsModule**

Create `apps/devUI/src/renderer/modules/connections/connections.module.mu` (+ any `.resources.mu`) registering `DevUiConnectionsClient` under `ConnectionsClientKey`. Mirror `apps/plexus/src/renderer/src/modules/connections/connections.module.mu` but omit the app-local `ConnectionEditorLauncher`/dialog (the branch does selection/default only; add/edit stays in devUI's Registry Connections manager per the spec). Do not collide the module name with devUI's existing `ConnectionsManagerModule`.

- [ ] **Step 4: Typecheck**

Run: `cd apps/devUI && npm run typecheck`
Expected: clean (no worse than baseline). Fix real type errors from the wiring; do not silence with `any`.

- [ ] **Step 5: Build the renderer**

Run: `cd apps/devUI && npm run build`
Expected: `electron-vite build` succeeds (`.mu` compiles, no unresolved imports). If a module/export path is wrong, fix the import to the exact plexus-core export subpath.

- [ ] **Step 6: Commit**

```bash
git add apps/devUI/src/renderer
git commit -m "feat(devui): adopt project/solution explorer + connections modules (panel swap)"
```

---

### Task 5: Retire Home + Compose + workspace host; ambient-solution entry

Remove devUI's solution Home page and Compose, retire the workspace-host seam + single-type factory, and confirm devUI opens into an ambient solution.

**Files:**
- Delete: `apps/devUI/src/renderer/modules/home/` (home-vm.ts, recent-solution-vm.ts, home.module.mu, home.resources.mu, + tests)
- Modify: `apps/devUI/src/renderer/app.mu` (drop `HomeModule` + `HomeResources`)
- Modify: `apps/devUI/src/renderer/modules/solution/solution-services.ts` (drop the `SolutionWorkspaceHostKey` binding + the single-type `TodlPackageProjectFactory` registration; project types now come from `TodlProjectSystemModule`)
- Delete: `apps/devUI/src/renderer/modules/solution/registry-solution-workspace-host.ts` (no consumer after the drop)
- Modify (if needed): `apps/devUI/src/renderer/modules/**/ipc-package-source.ts` — reconcile with the new package-source/Resolve path (the connection-aware store + `DevUiConnectionResolveApi`).
- Reference: the corpus at `PLEXUS_TEST_CORPUS` (default `C:/Users/Eugene/Projects/plexus_tests`) for the smoke.

**Interfaces:**
- Consumes: `SolutionManagerService` (ambient/untitled solution + `RestoreSession`), the Task 4 explorer.
- Produces: a devUI that boots into an ambient solution with the Solution Explorer as the leading capability, no Home/Compose.

- [ ] **Step 1: Remove HomeModule from composition**

In `app.mu`, delete the `HomeModule` import + its `.modules:` entry + `merge HomeResources`. Delete the `apps/devUI/src/renderer/modules/home/` folder.

- [ ] **Step 2: Retire the workspace host + single-type factory**

In `solution-services.ts`, remove the `SolutionWorkspaceHostKey → RegistrySolutionWorkspaceHost` binding and the single-type `TodlPackageProjectFactory` registration under `ProjectFactoryRegistryKey` (leave only what `TodlProjectSystemModule` does not already provide). Delete `registry-solution-workspace-host.ts`. If `SolutionServicesRegistration.Register` becomes empty, remove its call from `main.ts` and delete the file.

- [ ] **Step 3: Typecheck + build**

Run: `cd apps/devUI && npm run typecheck && npm run build`
Expected: clean. Resolve any dangling references to the deleted Home/host/factory.

- [ ] **Step 4: Ambient-solution smoke (Review Focus #4)**

Update/author a playwright smoke in `apps/devUI/tests/smoke/solution.spec.ts` that launches devUI with **no** remembered session and asserts the Solution Explorer rail capability renders (an ambient/untitled solution, not a blank rail) and that opening a project from the corpus shows its tree. Reuse `apps/plexus/e2e/plexus-app.ts` launch patterns (strip `ELECTRON_RUN_AS_NODE`, `_electron.launch` against the built app). Gate on corpus availability.

Run: `cd apps/devUI && npm run test:e2e -- solution`
Expected: PASS (or skipped if corpus unavailable — record which).

- [ ] **Step 5: Commit**

```bash
git add apps/devUI
git commit -m "feat(devui): drop Home + Compose + workspace host; ambient-solution entry"
```

---

### Task 6: Delete the old solution-studio panel (preserve the seams)

Remove the dead panel now that nothing imports it, keeping `SolutionStudioSeams` + `DialogPromptService` at the same subpath so apps/plexus is untouched.

**Files:**
- Delete: `packages/plexus-core/src/renderer/modules/solution-studio/solution-explorer-service.ts`, `solution-commands-vm.ts`, `solution-workspace-host.ts`, `connection-bag.ts`, `connection-fields.ts`, `connection-labels.ts`, `solution-studio.module.mu` (+ compiled `.mu.js`), and `tests/connection-fields.test.ts`, `tests/connection-labels.test.ts`
- Keep: `solution-studio-seams.ts`, `dialog-prompt-service.ts`, `tests/dialog-prompt-service.test.ts`
- Modify: `packages/plexus-core/src/renderer/modules/solution-studio/index.ts` (re-export only `SolutionStudioSeams` [+ `DialogPromptService` if externally used])
- Modify: `packages/plexus-core/package.json` (remove dead `./renderer/modules/solution-studio/*` panel export entries; keep the seams entry)

**Interfaces:**
- Consumes: nothing new.
- Produces: a solution-studio subpath that exports only the seams.

- [ ] **Step 1: Confirm no remaining importers of the panel**

Run: `grep -rn "solution-studio" apps packages --include=*.ts --include=*.mu | grep -viE "solution-studio-seams|dialog-prompt-service|SolutionStudioSeams"`
Expected: no hits referencing the panel service/module/connection-bag from either app. If any remain (other than the seams), fix them first — do not delete a file still imported.

- [ ] **Step 2: Delete the panel files + trim the index/exports**

Delete the files listed above; trim `index.ts` to the seams re-export; remove the dead export map entries in `package.json` (keep `./renderer/modules/solution-studio` for the seams).

- [ ] **Step 3: Build plexus-core + prove apps/plexus is unaffected (Review Focus #5)**

Run: `cd packages/plexus-core && npm run build && npx vitest run && cd ../../apps/plexus && npx vitest run src/renderer/src/tests/solution-manager-wiring.test.ts`
Expected: plexus-core suite green except the 2 known pre-existing `src/main/connections` collection failures; the apps/plexus `solution-manager-wiring` test (asserts on `SolutionStudioSeams`) PASSES.

- [ ] **Step 4: Full devUI verification**

Run: `cd apps/devUI && npm run typecheck && npm run build && npx vitest run && npm run test:e2e`
Expected: typecheck clean, build succeeds, vitest green, smoke green (or corpus-skipped).

- [ ] **Step 5: Commit**

```bash
git add packages/plexus-core apps
git commit -m "chore(solution-studio): delete legacy panel, keep the shared seams"
```

---

## Self-Review

**1. Spec coverage:**
- §2.1 full match → Tasks 4-6. §2.2 TodlProjectSystemModule → Task 4 (+ factory drop Task 5). §2.3 drop Home/Compose → Task 5. §2.4 adapter connection client → Tasks 2-3. §2.5 keep Registry Connections manager → untouched (asserted by not modifying `ConnectionsManagerModule`).
- §3 ViewerShell hosting + file-open seam → Task 4 Step 2. §6 U0 (prune seams) → Task 6. U1 → Tasks 2-3. U2 → Task 4. U3 → Task 5. U4 → Task 6. §9 typecheck script → Task 1. All spec sections map to a task.

**2. Placeholder scan:** Composition Tasks (4-5) reference apps/plexus files as the exact pattern to mirror with enumerated concrete edits — legitimate for an app-wiring port, not "TBD". A few "confirm the exact export path/field name" notes are verification steps against real code, not deferrals. No `add error handling`/`write tests`/`TODO` placeholders.

**3. Type consistency:** `SourcedPackageReader.FromTarball` (Task 2) is consumed by devUI `RegistryBridge.Resolve` (Task 2) and apps/plexus `ConnectionsBridge` (Task 2). `DevUiConnectionsClient` implements the same `IConnectionsClient` apps/plexus's `ConnectionsClient` does (Task 3, consumed Task 4). `ConnectionResolveApi`/`AppConnectionPackageResolver` promotion (Task 3) is consumed in Task 4. Channel name `connections:resolve` is identical across register-ipc/preload/env (Task 2).

**4. Review Focus:** all five pinned — #1/#2 Task 2, #3 Task 3, #4 Task 5 Step 4, #5 Task 6 Step 3.
