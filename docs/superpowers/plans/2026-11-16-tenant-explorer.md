# Tenant Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only Plexus root-nav "Tenant Explorer" tree — tenant → environments → (on expand) the applications and graphs on each environment — reached through a new least-privilege read-only path in the server desktop relay.

**Architecture:** The server gains a read-only `inspect` relay action (its own method allowlist + a reader credential). Plexus's main process opens an inspect relay per environment and merges `application/list` + `graph/list` + `graph/loaded` into one contents result behind an IPC bridge; the renderer presents it as a lazy tree modeled on the Meta-models panel.

**Tech Stack:** TypeScript; Electron (electron-vite) main/preload/renderer; mural `.mu` views; `@pragmatic-tech-ai/pragmatic-protocol` (`PragmaticClient`); pragmatic-server `admin/control-plane` (tsx-run); vitest / node:test.

**Spec:** `docs/superpowers/specs/2026-11-16-tenant-explorer-design.md`

## Global Constraints

- **Allman braces** on every block (class/interface/enum/method/getter/ctor/control-flow); `else`/`catch` on their own line. Object literals, arrow bodies, one-line `if (x) return;` stay inline.
- **OOP, no free functions / no module-level mutable state.** Behavior lives as methods (static where pure). Module-level `const`/`enum`/`type` are fine.
- **No inline string literals.** User-facing text, channel names, method ids, principal ids, role/scope names, action values → `private static readonly` constants referenced at every use. `.mu` labels stay inline.
- **View-models extend `Observable`** (not `MuralBase`); the tree row `.mu` template must be **trigger-free** (no `when ($X)` DP triggers) so an `Observable` node binds.
- **PascalCase** public methods and interfaces; private members / serialized-shape fields keep their casing.
- **Tests live in a `tests/` subfolder** next to the code.
- **The relay action string is exactly `'inspect'`** on both sides (server `DesktopAction.Inspect` and the Plexus `RelayAction.Inspect`), matching `'contribute'`/`'publish'`.
- **No token or URL may reach the renderer.** Every failure crossing IPC is a fixed plain sentence (existing `RelayWire`/`RelayConnector` sentences); the reader credential can perform no write.
- **Build propagation:** rebuild `plexus-core` (`npm run build`) before `apps/plexus` sees changes to `plexus-core/shared`. In `apps/plexus`, run `npm run compile:mu` before tests (its `pretest` does this). Revert `framework-typings.generated.ts` before any commit (generated artifact). Keep all new files LF-only.
- **No package dependency between the repos for this feature.** Plexus reaches the server only at runtime over the relay; the protocol package is unchanged. Server changes take effect for the live check only after the `pragmatic-server:dev` image is rebuilt.

## Review Focus

- **Signed out** (at start or after sign-out): the panel shows a sign-in/empty state, lists no environments, and makes no contents calls. → Task P5.
- **Stopped / failed environment**: expanding yields a plain "not running" message row (relay 409 → the existing sentence), not a dialog; the env row still shows its status. → Task P3 (service maps the refusal) + Task P4 (message row).
- **Account change while open** (sign in, sign out, platform sign-in): the tree rebuilds live with no stale or duplicate env rows across Console/Platform sources (stale-`reloadSeq` guard; union de-duped by `TargetIdentity.Id`). → Task P5.
- **Empty environment** (no apps, no graphs): a single "nothing deployed" message row, not a blank expander. → Task P3 (empty result) + Task P4.
- **Connection/credential failure or relay refusal**: a message row carrying the relay's fixed sentence — never a URL/token/raw transport text — and the inspect credential is read-only (cannot deploy/contribute). → Task S1/S2 (least privilege) + Task P3 (sentence mapping).

---

## Task S1: Reader credential (`AdminIssueReaderToken`)

**Repo:** pragmatic-server. **Files:**
- Modify: `admin/control-plane/environment-service.ts` (add method + constants)
- Modify: `admin/control-plane/control-plane-host.ts:~100` (`IEnvironmentService` interface — add the method signature next to `AdminIssueMakerToken`/`AdminIssueDeployToken`)
- Test: `admin/control-plane/tests/environment-service.test.ts` (or the existing env-service test file; place in `admin/control-plane/tests/`)

**Interfaces:**
- Produces: `IEnvironmentService.AdminIssueReaderToken(name: string): Promise<TokenIssuedDto>` — grants a **read-only** role to a well-known inspector principal (idempotent, as Owner via the proxy) and issues a short-lived token. Works for **either** env type (Development and Runtime), unlike the maker (Development-only) and deploy (Runtime-only) mints.
- Consumes: the existing `WithAdmin`, `this.proxy.GrantRole`, `this.proxy.IssueToken`; `TokenIssuedDto` from the protocol.

- [ ] **Step 1: Write the failing test.** In the env-service test, with a fake `AdminProxy` recording calls, assert `AdminIssueReaderToken('rt-env')`:
  - calls `GrantRole` once with `{ subject: 'inspector', role: 'Viewer', resourceKind: 'Realm', resourcePath: [] }`,
  - then calls `IssueToken` with `{ principalId: 'inspector', scopes: ['environment-inspect'], expiresInSeconds: 900 }` and returns its `TokenIssuedDto`,
  - and does **not** throw for a Development env nor a Runtime env (no `EnvType` guard). Add a second assertion that a non-existent env name throws the same not-found the other `Admin*` methods throw (`Require`).
- [ ] **Step 2: Run it — expect FAIL** (method not defined). Run from `pragmatic-server`: `npx tsx --test admin/control-plane/tests/environment-service.test.ts`.
- [ ] **Step 3: Implement.** Add constants on `EnvironmentService`: `InspectorPrincipalId = 'inspector'`, `InspectorRoleName = 'Viewer'` (reuse the read-only Viewer role — same value as `AppReaderRoleName`), `InspectScope = 'environment-inspect'`, `InspectTtlSeconds = 900`. Implement `AdminIssueReaderToken(name)` mirroring `AdminIssueDeployToken` but with **no type guard** (call `this.Require(name)` for existence only), granting `InspectorRoleName` to `InspectorPrincipalId` on `RealmKindName`, then `IssueToken({ principalId: InspectorPrincipalId, scopes: [InspectScope], expiresInSeconds: InspectTtlSeconds })`. Add the signature to the `IEnvironmentService` interface in `control-plane-host.ts`.
- [ ] **Step 4: Run it — expect PASS.**
- [ ] **Step 5: Typecheck.** From `pragmatic-server`: `npm run typecheck:tools`.
- [ ] **Step 6: Commit** (`feat(server): read-only inspector credential for the desktop relay`).

## Task S2: `inspect` relay action

**Repo:** pragmatic-server. **Files:**
- Modify: `admin/control-plane/tenant-auth/desktop-targets.ts` (`DesktopAction.Inspect`; inspect eligibility)
- Modify: `admin/control-plane/tenant-auth/desktop-relay.ts` (`DesktopRelayAllowlist.Inspect`; `Mint` routing)
- Test: `admin/control-plane/tests/desktop-relay.test.ts`, `admin/control-plane/tests/` targets test (wherever `DesktopTargets.Check` is tested)

**Interfaces:**
- Consumes: `DesktopRelayAllowlist.For(action)`; `DesktopRelay.Mint(action, envName)`; `DesktopTargets.Check(session, env, action)`; `IEnvironmentService.AdminIssueReaderToken` (Task S1); `GraphProtocol.List/Loaded.method`, `PragmaticAppProtocol.List.method` from the protocol.
- Produces: an `inspect` action that forwards exactly `{ application/list, graph/list, graph/loaded }`, mints the reader credential, and is allowed for any running env of the session's tenant that it may act on (either type).

- [ ] **Step 1: Write the failing tests.**
  - Allowlist: `DesktopRelayAllowlist.For(DesktopAction.Inspect)` is a set equal to `{ PragmaticAppProtocol.List.method, GraphProtocol.List.method, GraphProtocol.Loaded.method }` and excludes `application/deploy` and `graph/contribute`.
  - Mint: `DesktopRelay.Mint(DesktopAction.Inspect, 'env')` calls `service.AdminIssueReaderToken('env')` (fake service records it), not the maker/deploy mints.
  - Targets: `DesktopTargets.Check(session, '<dev-env>', Inspect)` and `Check(session, '<runtime-env>', Inspect)` both return `Allowed` for a running env of the session's tenant with the envs capability; a stopped one returns `NotRunning`; a foreign-tenant or no-capability one returns `Forbidden`.
- [ ] **Step 2: Run — expect FAIL.** `npx tsx --test admin/control-plane/tests/desktop-relay.test.ts` and the targets test.
- [ ] **Step 3: Implement.**
  - `desktop-targets.ts`: add `Inspect = 'inspect'` to `DesktopAction`. Change eligibility so inspect accepts **either** type: in `IsEligible`, when `action === DesktopAction.Inspect` the type check passes for any `EnvType` (keep the tenant + `mayActOnEnvs` checks); `For` (the pickers) is untouched and still only builds contribute/publish lists. (`ActionOf` in the relay already parses any `DesktopAction` value, so no change there.)
  - `desktop-relay.ts`: add `private static readonly Inspect: ReadonlySet<string> = new Set([PragmaticAppProtocol.List.method, GraphProtocol.List.method, GraphProtocol.Loaded.method])` and return it from `DesktopRelayAllowlist.For` for the inspect action; none are added to `AuditedNoteField` (reads aren't write-audited). In `DesktopRelay.Mint`, route `DesktopAction.Inspect → this.service.AdminIssueReaderToken(envName)` (keep contribute→maker, publish→deploy).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Typecheck.** `npm run typecheck:tools`.
- [ ] **Step 6: Commit** (`feat(server): read-only inspect action on the desktop relay`).

---

## Task P1: Relay client read calls + `RelayAction`

**Repo:** Plexus. **Files:**
- Modify: `apps/plexus/src/main/account/relay-connector.ts`
- Modify (callers): `apps/plexus/src/main/graph-contribute/graph-contribute-service.ts`, `apps/plexus/src/main/environment-publish/environment-deploy-service.ts` (pass the new `RelayAction` where they pass `TargetKind` to `Connect`/`RelayUrl`)
- Test: `apps/plexus/src/main/account/tests/relay-connector.test.ts`

**Interfaces:**
- Produces: `RelayClient` now `Pick<PragmaticClient, 'ListGraphs' | 'ListApplications' | 'GetLoadedGraph' | 'ContributeGraph' | 'DeployApplication' | 'DisposeAsync' | 'CloseCode'>`; `enum RelayAction { Contribute='contribute', Publish='publish', Inspect='inspect' }`; `RelayConnector.Connect(target: TargetRef, action: RelayAction)` and `RelayConnector.RelayUrl(consoleUrl, environment, action: RelayAction)`.
- Consumes: `account.Targets`/sessions seam (unchanged).

- [ ] **Step 1: Write the failing test.** Assert `RelayConnector.RelayUrl('https://console.example', 'env one', RelayAction.Inspect)` ends with `action=inspect` and encodes the space as `%20`; and that a fake dial receiving `RelayAction.Inspect` opens a client exposing `ListApplications`/`GetLoadedGraph`. Keep/adjust the existing contribute/publish URL tests to `RelayAction`.
- [ ] **Step 2: Run — expect FAIL.** From `apps/plexus`: `npx vitest run src/main/account/tests/relay-connector.test.ts`.
- [ ] **Step 3: Implement.** Add the `RelayAction` enum (values match the server). Widen `RelayClient`'s Pick. Change `Connect`/`RelayUrl` parameter type from `TargetKind` to `RelayAction`; the action is encoded as before (`action=${encodeURIComponent(action)}`). Update the two existing callers to pass `RelayAction.Contribute` / `RelayAction.Publish`.
- [ ] **Step 4: Run — expect PASS**, plus the contribute/deploy service tests still green.
- [ ] **Step 5: Commit** (`feat(plexus-main): relay inspect action + read calls`).

## Task P2: Shared `EnvironmentContents` contract

**Repo:** Plexus. **Files:**
- Create: `packages/plexus-core/src/shared/environment-contents-api.ts` (no `package.json` change — the existing `"./shared/*.js": "./dist/shared/*.js"` wildcard already exports it, same as `account-api`)
- Create: `apps/plexus/src/shared/environment-contents-api.ts` (re-export twin, mirroring `apps/plexus/src/shared/graph-contribute-api.ts`)
- Test: `packages/plexus-core/src/shared/tests/environment-contents-api.test.ts` (a light shape/guard test if any parsing helper is added)

**Interfaces:**
- Produces: `type AppSummary = { Name: string; Version: string }`; `type GraphSummary = { Name: string; PackageCount?: number }`; `type EnvironmentContents = { Applications: AppSummary[]; Graphs: GraphSummary[] }`; `enum EnvironmentsChannel { Contents = 'environments:contents' }`; `interface IEnvironmentsBridge { Contents(target: TargetRef): Promise<RelayReply<EnvironmentContents>> }` and the renderer-facing `interface IEnvironmentsApi { Contents(target: TargetRef): Promise<EnvironmentContents> }`.
- Consumes: `TargetRef`, `RelayReply` from `account-api.ts`.

- [ ] **Step 1:** Write the contract file(s). No behavior yet beyond types + the channel enum; if a `TargetRef` normaliser is needed for the IPC hop reuse `TargetIdentity.RefFrom`.
- [ ] **Step 2: Typecheck** both packages: from `packages/plexus-core` `npm run typecheck`, then `npm run build` (so `apps/plexus` resolves it).
- [ ] **Step 3: Commit** (`feat(plexus): environment-contents shared contract`).

## Task P3: Main `EnvironmentContentsService` + IPC + preload bridge

**Repo:** Plexus. **Files:**
- Create: `apps/plexus/src/main/environments/environment-contents-service.ts`
- Create: `apps/plexus/src/main/environments/environment-contents-ipc.ts` (mirror `graph-contribute-ipc.ts`)
- Modify: `apps/plexus/src/main/index.ts` (register the IPC)
- Modify: the preload bridge that builds `window.api` (add `environments: { Contents }`, mirroring `graphContribute`) + its typing in the shared/preload surface
- Test: `apps/plexus/src/main/environments/tests/environment-contents-service.test.ts`, `.../tests/environment-contents-ipc.test.ts`

**Interfaces:**
- Consumes: `IRelayConnector.Connect(target, RelayAction.Inspect)` (Task P1); `RelayConnector.Call`; `RelayWire.Capture`; the client's `ListApplications`/`ListGraphs`/`GetLoadedGraph`.
- Produces: `EnvironmentContentsService.Contents(target: TargetRef): Promise<EnvironmentContents>` — opens one inspect relay, runs the three reads, merges, always disposes.

- [ ] **Step 1: Write failing tests** (fake `RelayClient`):
  - merges `ListApplications` + `ListGraphs` + (`GetLoadedGraph` when non-null) into `{ Applications, Graphs }`, mapping `{name,version}`→`{Name,Version}`, `{name,packageCount}`→`{Name,PackageCount}`, and the loaded graph's `{name}`→a `GraphSummary` (so a runtime env's one promoted graph appears alongside apps);
  - a per-call `-32601` "Method not found" (an env type that doesn't serve one) is swallowed to "none" and the other calls still populate;
  - the client is `DisposeAsync`'d even when a call throws;
  - a dropped/refused connection surfaces the relay's plain sentence (via `RelayConnector.Call`) and never a URL/token;
  - an empty env yields `{ Applications: [], Graphs: [] }`.
  - IPC test: the handler registers channel `environments:contents`, rebuilds a `TargetRef` with `TargetIdentity.RefFrom`, and answers a `RelayReply` envelope (`RelayWire.Capture`).
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run src/main/environments/tests/`.
- [ ] **Step 3: Implement** the service (constants for the three method-not-found tolerances via `ErrorCodes.MethodNotFound`), the IPC registration, `index.ts` wiring, and the preload bridge. Reuse `RelayWire`/`RelayConnector.Call` exactly as the publish/contribute paths do.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** (`feat(plexus-main): environment-contents service + IPC bridge`).

## Task P4: `TenantExplorerNode`

**Repo:** Plexus. **Files:**
- Create: `apps/plexus/src/renderer/src/modules/tenant-explorer/services/tenant-explorer-node.ts`
- Test: `apps/plexus/src/renderer/src/modules/tenant-explorer/services/tests/tenant-explorer-node.test.ts`

**Interfaces:**
- Produces: `enum TenantExplorerNodeKind { Tenant, Environment, Application, Graph, Message }`; `class TenantExplorerNode extends Observable` with `Kind`, `Label`, `IconKey: string`, `Status?: string`, `Children: ObservableCollection<TenantExplorerNode>`, `OnExpand(): void`; statics `tenant(label)`, `environment(label, status, iconKey, loader)`, `application(label)`, `graph(label)`, `message(label)`. The Environment node is lazy (seeded with a "Loading…" `message` child; `OnExpand` runs its loader once, idempotent, swapping children — mirrors `MetaModelTreeNode.lazy`/`OnExpand` but on `Observable` with `RaisePropertyChanged`-backed getters, no DP table).
- Consumes: `ObservableCollection`, `Observable` from mural runtime.

- [ ] **Step 1: Write failing tests.** `environment(...).OnExpand()` runs the loader once (second call no-ops) and replaces the sentinel with the produced children; a loader rejection swaps in a single `message` "Failed to load" node; `application`/`graph`/`message`/`tenant` factories set the right `Kind` and `IconKey`.
- [ ] **Step 2: Run — expect FAIL.** `npx vitest run src/renderer/src/modules/tenant-explorer/services/tests/tenant-explorer-node.test.ts`.
- [ ] **Step 3: Implement** on `Observable` (icon-key constants hoisted; `Children` an `ObservableCollection`).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** (`feat(plexus): tenant-explorer tree node`).

## Task P5: `TenantExplorerService`

**Repo:** Plexus. **Files:**
- Create: `apps/plexus/src/renderer/src/modules/tenant-explorer/services/tenant-explorer-service.ts`
- Create (renderer seam): `apps/plexus/src/renderer/src/modules/tenant-explorer/services/environments-contents-source.ts` wrapping `window.api.environments` (a small `IEnvironmentsApi` adapter, like `ipc-account-service.ts`), or reuse an existing renderer seam if one fits
- Test: `.../services/tests/tenant-explorer-service.test.ts`

**Interfaces:**
- Consumes: `IAccountService` (`State`, `Targets()`, `Changed`) via `AccountServiceKey`; `IEnvironmentsApi.Contents`; `TargetIdentity.Id`/`RefOf`; `TenantExplorerNode` (Task P4).
- Produces: `TenantExplorerService extends ServiceBase implements IActivatable` with `static readonly Key`, `Nodes: ObservableCollection<TenantExplorerNode>`, `IsEmpty`/`SignedIn` flags; `OnActivated()`; ctor subscribes to `account.Changed`.

- [ ] **Step 1: Write failing tests** (fake account + contents source):
  - signed out → `Nodes` empty and a signed-out flag set; no contents calls;
  - signed in → one tenant root labelled `State.TenantName` with one Environment child per **unioned** contribute+publish target, de-duped by `TargetIdentity.Id(source, name)`, each carrying its status and a loader;
  - expanding an Environment node calls `contents.Contents(ref)` and yields `application`/`graph` child nodes (and a `message` "nothing deployed" when both empty);
  - an `account.Changed` event triggers a rebuild; a stale reload (older `reloadSeq`) is discarded so no duplicate rows.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**, mirroring `MetaModelsService` (`reloadSeq` guard, `OnActivated` → reload, ctor `account.Changed` subscription → reload). The Environment node's loader maps `EnvironmentContents` → child nodes; a thrown relay sentence becomes a single `message` node with that sentence.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** (`feat(plexus): tenant-explorer service`).

## Task P6: View, module, icon, app wiring

**Repo:** Plexus. **Files:**
- Create: `apps/plexus/src/renderer/src/icons/ServerEnvironment.svg` (the user's supplied 16×16 currentColor glyph)
- Modify: `apps/plexus/src/renderer/src/plexus-icons.mu` (`include "icons/ServerEnvironment.svg" as ServerEnvironment`; and, if adding dedicated app/graph leaf glyphs, their includes — else reuse existing keys)
- Create: `apps/plexus/src/renderer/src/modules/tenant-explorer/tenant-explorer.resources.mu`
- Create: `apps/plexus/src/renderer/src/modules/tenant-explorer/tenant-explorer.module.mu`
- Modify: `apps/plexus/src/renderer/src/app.mu` (import module + resources; list in `.modules:`; `merge TenantExplorerResources`)
- Modify: `apps/plexus/src/renderer/src/main.js` (eager `app.Services.get(TenantExplorerService.Key)` start, for parity with Solution Explorer, so `account.Changed` refreshes while another panel is active)

**Interfaces:** Consumes `TenantExplorerService` (Task P5) and `TenantExplorerNode` (Task P4).

- [ ] **Step 1:** Add the SVG and the `plexus-icons.mu` include. Pick leaf icons: reuse existing keys for application and graph rows if suitable, otherwise add two small currentColor glyphs the same way.
- [ ] **Step 2:** Write `tenant-explorer.resources.mu`: `DataTemplate [DataType = TenantExplorerService]` with a `TreeView` (style it like `solution-explorer.resources.mu` / `meta-model.resources.mu`, `ItemsSource = $Nodes`) + an empty/sign-in state bound to the signed-out flag; and one **trigger-free** `HierarchicalDataTemplate [DataType = TenantExplorerNode, itemsselector = Children]` row — leading `Shape [ Geometry = $IconKey << IconKeyToGeometry ]` (or the meta-model row's icon approach), the `$Label`, and a muted `$Status` suffix.
- [ ] **Step 3:** Write `tenant-explorer.module.mu`: `shell module TenantExplorerModule [ Name = "Tenant Explorer" ] { .services: { TenantExplorerService } Capability [ Name = "Tenant Explorer", Icon = @ServerEnvironment, ServiceKey = TenantExplorerService, Order = 20 ] }` (Order after Solution Explorer's 10).
- [ ] **Step 4:** Wire `app.mu` (import the module + resources, add to `.modules:`, `merge TenantExplorerResources`) and the `main.js` eager start.
- [ ] **Step 5: Verify.** From `apps/plexus`: `npm run compile:mu` (the `.mu` compiles, the new `@ServerEnvironment` key resolves) and `npm run typecheck`. Revert `framework-typings.generated.ts`. Then `npm run build` and confirm the app boots with a "Tenant Explorer" rail entry whose panel renders the tenant/sign-in state (operator/manual — the `.mu` wiring has no unit test).
- [ ] **Step 6: Commit** (`feat(plexus): tenant-explorer panel, rail icon, app wiring`).

---

## Final integration verification (operator-run, not auto)

After all tasks: rebuild the `pragmatic-server:dev` image (from workspace root, the documented BuildKit command with a fresh `PACKAGES_TOKEN` npmrc) so the `inspect` action is live, `npm run build` in `apps/plexus`, then against a running dev+runtime environment pair confirm end-to-end: the rail shows Tenant Explorer; the tenant root lists the user's environments with status; expanding a **development** env shows its graphs; expanding a **runtime** env shows its applications and its promoted graph; a stopped env shows "not running"; sign-out empties the tree. **Verification gate for the reader grant:** confirm the `inspector` Viewer credential is accepted by `application/list`, `graph/list`, and `graph/loaded` on both env types; if any is refused, widen the reader grant (add the missing read role) — do **not** loosen the method's server-side gate. Confirm the inspect credential cannot deploy or contribute (least-privilege).
