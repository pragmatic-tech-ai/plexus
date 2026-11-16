# Tenant Explorer — Design

**Date:** 2026-11-16
**Repos:** Plexus (`apps/plexus`, `packages/plexus-core`), pragmatic-server (`admin/control-plane`)
**Status:** awaiting approval

## Intent & why

Give the signed-in user a root-navigation panel in Plexus that shows, as a tree,
the environments they can reach and — on expanding an environment — the
**applications and graphs that exist on it**. Today a user can only *see* an
environment inside the modal publish/contribute pickers, and can never see what's
deployed in one without leaving Plexus. This is situational awareness: "what
environments do I have, and what's on them." The user has said this read-only view
is the whole ask "for now"; actions on the nodes come later.

## Goals

- A new root-nav entry **"Tenant Explorer"** (rail icon = `ServerEnvironment.svg`,
  a 16×16 `currentColor` glyph the user supplied), peer to Solution Explorer and
  Meta-models.
- Tree:
  - **Root** = the signed-in tenant (`AccountState.TenantName`).
  - **Environments** = the union of the account's contribute + publish targets,
    de-duplicated by `TargetIdentity.Id(source, name)`, each showing its status
    (Running / Stopped / Failed / Unknown) and disambiguating `(platform)` vs
    console source the way the existing pickers do.
  - **On expand** (lazy): the environment's applications and graphs as a single
    **flat list of mixed rows**, each distinguished only by its leading icon
    (application vs graph). No sub-folders.
- Live reactivity: the tree refreshes on `account.Changed` (sign in/out, platform
  sign-in) and on panel activation.
- Read-only. Robust, non-modal handling of signed-out / stopped / empty / failure
  states (a message row inside the tree, never an error dialog).

## Non-goals (for now)

- Any action on a node (open, connect, set-as-target, drill into an application's
  contents, create/delete).
- Grouping environments by Development/Runtime or by source; the flat shape was
  chosen.
- Per-application internals; only name + version are shown for an application, and
  name (+ package count for a dev graph) for a graph.
- Any new *write* capability through the relay.

## Anti-goals

- The renderer must never receive a session token or an environment credential
  (the existing rule: tokens live only in the main process).
- No per-environment credential held by Plexus; everything goes through the
  server's desktop relay, which mints short-lived credentials server-side.

## Constraints

- Plexus reaches an environment **only** through the server desktop relay
  (`GET /desktop/relay?environment=<name>&action=<...>`), which enforces a strict
  per-action JSON-RPC method allowlist and mints a least-privilege credential per
  action. Reads that aren't on an allowlist are rejected `-32601`.
- View-models extend `Observable` (repo rule); the tree node must therefore keep
  its `.mu` row template trigger-free (no `when ($X)` DP triggers).
- Allman braces, OOP (methods on classes, no module-level free functions), no
  inline string literals (hoist to `private static readonly`), PascalCase public
  methods/interfaces, tests in `tests/` subfolders. `.mu` labels stay inline.

## Approaches considered

**How to reach an environment's contents.** The only channel is the desktop relay.
Its allowlists today are `contribute → {graph/list, graph/contribute}` (maker
credential) and `publish → {application/deploy}` (deployer credential). So
`graph/list` on a development environment already works, but a runtime
environment's `application/list` and `graph/loaded` are blocked and no read
credential is minted. Three ways to add the read path were weighed:

1. **Dedicated read-only `inspect` action (CHOSEN).** A new relay action with its
   own allowlist `{application/list, graph/list, graph/loaded}` and a new
   least-privilege **reader** credential (read-only grant). Matches the existing
   per-action least-privilege pattern; the inspect connection can do nothing but
   read. More code, cleanest and safest.
2. *Widen the existing allowlists* and reuse the maker/deployer credentials for
   reads. Less code, but the connection is over-privileged and read gets entangled
   with write credentials. Rejected.
3. *No server change* — ship only what's reachable today (dev-env graphs). A
   partial feature (runtime apps blank). Rejected.

**How to present the tree.** Flat (env → mixed app/graph rows) was chosen over
grouping by Dev/Runtime or by typed sub-folders, for the simplest read.

**Where the panel lives.** Modeled on the Meta-models module (app-level,
`IActivatable`, owns its own node forest with lazy `OnExpand` loaders) rather than
the heavyweight Solution Explorer Hierarchy (drag/drop, context menus, rename) —
the tenant tree is read-only and needs none of that.

## Design

### Server (pragmatic-server `admin/control-plane`) — the keystone

- `DesktopAction.Inspect = 'inspect'` added to `desktop-targets.ts`.
- `DesktopRelayAllowlist.Inspect = { application/list, graph/list, graph/loaded }`
  (all reads; none write-audited — consistent with `graph/list` over contribute).
- A new mint path `IEnvironmentService.AdminIssueReaderToken(envName)` minting a
  **read-only** credential (a `Viewer`/read grant to a well-known `inspector`
  principal, idempotent — mirrors the existing `AdminGrantAppReader` /
  `AdminIssueMakerToken` pattern). `DesktopRelay.Mint` returns it for the inspect
  action.
- `DesktopTargets.Check(session, env, Inspect)` verdict: allowed for any
  environment the user may reach for *either* contribute or publish (so the union
  shown in the tree is exactly what inspect permits). Running-state and
  tenant/type rules reuse the existing checks; a stopped env → 409 as today.
- The environment server already serves `application/list`, `graph/list`,
  `graph/loaded` gated on read access; a Viewer-grant reader credential satisfies
  them. (Verification step in the plan: confirm the reader grant covers all three
  on both env types; widen the grant if a gap is found — do **not** loosen a
  method's gate.)

### Protocol (pragmatic-protocol)

No change. `PragmaticAppProtocol.List → PragmaticAppSummaryDto{name,version}[]`,
`GraphProtocol.List → GraphSummaryDto[]`, `GraphProtocol.Loaded → GraphLoadedDto|null`
and the `PragmaticClient` wrappers `ListApplications` / `ListGraphs` /
`GetLoadedGraph` already exist.

### Plexus main process

- Extend `RelayConnector`'s `RelayClient` Pick to also include `ListApplications`
  and `GetLoadedGraph` (it already includes `ListGraphs`). Add the `inspect`
  relay action to the URL/action encoding (a read action distinct from the
  contribute/publish `TargetKind`s).
- New `EnvironmentContentsService` (main): given a `TargetRef`, open an inspect
  relay via `RelayConnector.Connect(target, inspect)`, call `ListGraphs`,
  `ListApplications`, and `GetLoadedGraph`, tolerate a per-call method-not-found
  (an env type that doesn't serve one answers `-32601` → treated as "none"),
  merge into one result, and always `DisposeAsync` the client. Failures become the
  relay's existing plain sentences (never a URL/token) via `RelayConnector.Call` +
  `RelayWire`.
- New IPC channel + preload bridge: `window.api.environments.Contents(targetRef)`
  returning a `RelayReply<EnvironmentContents>`.

### Plexus shared contract (`plexus-core/src/shared` + `apps/plexus/src/shared`)

- Renderer-safe, protocol-free twins (mirrors the graph-contribute-api pattern):
  `EnvironmentContents = { Applications: AppSummary[]; Graphs: GraphSummary[] }`,
  `AppSummary = { Name; Version }`, `GraphSummary = { Name; PackageCount? }`, plus
  the IPC channel enum and bridge interface.

### Plexus renderer (`apps/plexus/src/renderer/src/modules/tenant-explorer`)

- `TenantExplorerService extends ServiceBase implements IActivatable` (key
  `TenantExplorerService.Key`). Owns an `ObservableCollection<TenantExplorerNode>`
  and an `IsEmpty`/signed-out flag. In its constructor it subscribes to
  `account.Changed`; `OnActivated()` and that subscription both trigger a
  `reload()` (guarded by a `reloadSeq` like `MetaModelsService`). `reload()` reads
  `account.State` (tenant name, signed-in) + `account.Targets()`; builds the
  tenant root + one lazy environment node per unioned target.
- `TenantExplorerNode extends Observable` (not `MuralBase`): `Kind`
  (Tenant/Environment/Application/Graph/Message), `Label`, `IconKey`, optional
  status text, `Children: ObservableCollection`, and a lazy loader on Environment
  nodes that on first `OnExpand()` calls `environments.Contents(ref)` and swaps the
  "Loading…" sentinel for app/graph rows (or a single "not running" / "nothing
  deployed" / failure Message row). Trigger-free.
- `tenant-explorer.resources.mu`: `DataTemplate [DataType = TenantExplorerService]`
  (TreeView styled like the others + empty/sign-in state) and one
  `HierarchicalDataTemplate [DataType = TenantExplorerNode]` row (icon by Kind,
  label, status suffix).
- Icons: add `icons/ServerEnvironment.svg`; `include "icons/ServerEnvironment.svg"
  as ServerEnvironment` in `plexus-icons.mu`; pick leaf icons for application and
  graph rows (reuse existing icon keys, or add two small glyphs).
- `tenant-explorer.module.mu`: `shell module TenantExplorerModule [ Name =
  "Tenant Explorer" ]` with `Capability [ Name = "Tenant Explorer", Icon =
  @ServerEnvironment, ServiceKey = TenantExplorerService, Order = <after Solution
  Explorer> ]`. Wire into `app.mu` (import, `.modules:`, `merge
  TenantExplorerResources`). The `account.Changed` subscription is set in the ctor,
  so a `main.js` eager `.get(...Key)` start is only needed if the tree must update
  while another panel is active — include it for parity with Solution Explorer.

## Review focus (edge cases whose behavior the spec implies)

1. **Signed out** (at start or after sign-out) → the panel shows a sign-in/empty
   state, no environments, no failed calls.
2. **Stopped / failed environment** → expanding it yields a plain "not running"
   message row (relay 409), not an error dialog, and the env row still shows its
   status.
3. **Account change while the panel is open** (sign in, sign out, platform
   sign-in) → the tree rebuilds live, with no stale environments and no duplicate
   rows (stale-`reloadSeq` guard).
4. **Empty environment** (no apps, no graphs) → a single "nothing deployed"
   message row, not a blank expander.
5. **Connection/credential failure or a relay refusal** → a message row with the
   relay's fixed plain sentence; never a URL, token, or raw transport text, and
   the reader credential can perform no write.
