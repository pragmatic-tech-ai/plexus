# Spec — Solution Hierarchy P2: SolutionExplorer + basic tree

> Sub-project P2 of the Solution Hierarchy Migration (umbrella:
> `2026-09-29-solution-hierarchy-migration-spec.md`; framework primitives:
> `2026-09-29-solution-hierarchy-p0-framework-spec.md`, implemented in Mural main;
> engine: `2026-09-29-solution-hierarchy-p1-engine-spec.md`, implemented + merged in
> Mural/todl-runtime/TODL main). On approval this hands to writing-plans.

**Goal:** cut the Plexus left-panel tree over from the eager, path-identity
`ProjectExplorerService`/`ProjectNode` projection to a reactive, lazy, disk-watched tree
driven by a `HierarchyModel`: a generic model→`TreeView` projection VM (Mural), a
solution→members contributor and a file-tree contributor over the P1 content store
(plexus-core), and a `SolutionExplorer` capability that owns the model and follows
`ActiveSolution`.

**Architecture:** three layers in release order. **Mural** gains a generic
`HierarchyItemVM`/`HierarchyTreeVM` beside `HierarchyModel`, plus a small reactivity seam so a
live contributor whose *data* changed can trigger re-contribution and an existing keyed node's
props refresh in place. **plexus-core** gains a `solution-explorer` module: two contributors
(`ProjectsListingContributor`, `FileTreeContributor`) and the `SolutionExplorerService`
capability. **apps/plexus** (and devUI) rebind the panel to the new tree and retire the old
projection.

**Tech stack:** TypeScript, `node:test`, `@pragmatic-tech-ai/mural` (framework +
`framework/hierarchy`), `@pragmatic-tech-ai/todl-runtime`, `@pragmatic-tech-ai/todl`
(`SolutionManagerService`, `ProjectContentProvider`/`ProjectContentStore`, `SolutionMember`),
Mural `.mu` markup, Playwright (app e2e).

## 1. What this is — and is not

**Decision:** **hard swap.** P2 replaces the panel projection outright. The shipped app on
`main` between P2 and P3/P4 has a browsable, reactive, virtualized tree with **open-on-activate**
(double-click a file opens it) but **no context menu, rename, delete, move, import, publish,
run-menu, export, drag-drop, or per-project command surface** — those return in P3 (mutation)
and P4 (commands & selection). This regression is accepted; the alternative dual-tree seam was
rejected.

**In scope (P2):**

- **Mural (`src/framework/hierarchy`):** `HierarchyItemVM` + `HierarchyTreeVM` (the generic
  model→row/expansion adapter); `HierarchyModel.ObserveChildren(id, sink)` — a public per-node
  child-delta subscription the VM binds to (the model has none today); a public
  contributor-changed notification on `HierarchyContributorRegistry`; `HierarchyModel.internKeyed`
  refreshing an existing keyed node's props on re-contribute while preserving its `HierarchyItemId`.
  Update P0/P1 tests only where these touch them. A Mural release.
- **plexus-core (`src/renderer/modules/solution-explorer`, new):** node-key constants
  (`solution`, `solution-member`) registered in the `NodeKeyRegistry`; `ProjectsListingContributor`
  (NodeContribution, reactive to `Members` + each member's `Status`); `FileTreeContributor`
  (ProviderContribution mounting a `ProjectContentProvider` per resolved member, with store
  lifecycle); `SolutionExplorerService` (the Capability owning a `HierarchyModel`, observing
  `ActiveSolution`, seeding the root, registering the contributors, publishing a `HierarchyTreeVM`);
  an `IconKeyToGeometry` converter; the panel `.mu` module + resources.
- **apps/plexus (+ devUI):** flip the left-panel Capability's `ServiceKey` from
  `ProjectExplorerService` to `SolutionExplorerService`; register the new module; wire
  open-on-activate; retire/adjust the old-tree e2e expectations.

**Not in scope (later phases):**

- Mutation — new/rename/delete/move, in-place editing state, real `CanAccept` drop rules — **P3**.
- The full command surface — owner-base actions, the keyed action seam generalizing
  `INodeCommandContributor`/`IProjectMenuSource`, global selection redistribution, F2/Delete
  key handling, Export SVG/PPTX, publish/version, the agent/skill Run menu — **P4**.
- Cross-hierarchy content (Connections/References providers) — **P5**.
- Canonical-name persistence + reactive restore, unresolved-member "Remove from Solution" —
  **P6**.
- Re-homing `ProjectContentProvider` from TODL to plexus-core — deferred cleanup; P2 imports it
  from TODL as-is.
- The static `.hierarchyContributors:` markup block for app-global stateless contributors —
  P2 registers its per-solution contributors imperatively (§6); a later phase may add markup ones.

## 2. Cross-repo shape and release order

Release order (theme-migration template): land + green in **Mural** → publish → bump the Plexus
monorepo mural pin → adopt in **plexus-core** + **apps** → green. **TODL is unchanged in P2.**
Publishing is the user's deferred step; each repo lands green and stops before any publish or
push to a shared branch.

```
Mural (framework/hierarchy)          generic, no domain types
  HierarchyItemVM, HierarchyTreeVM
  HierarchyModel.ObserveChildren(id, sink) (public per-node delta feed)
  HierarchyContributorRegistry.NotifyContributionsChanged() (public)
  HierarchyModel.internKeyed refresh-in-place
        │ publish + pin bump
        ▼
plexus-core (renderer/modules/solution-explorer)   shared front-end
  SolutionRootKey / SolutionMemberKey (+ NodeKeyRegistry)
  ProjectsListingContributor  (Solution → member rows)
  FileTreeContributor         (member → ProjectContentProvider)  ── imports TODL
  SolutionExplorerService     (Capability; owns HierarchyModel; follows ActiveSolution)
  IconKeyToGeometry
  solution-explorer.module.mu + .resources.mu
        │
        ▼
apps/plexus (+ devUI)
  panel Capability → SolutionExplorerService
  open-on-activate wiring
  retire project-explorer projection; adjust e2e
```

**Dependency direction:** `TODL → mural`; `plexus-core → { mural, TODL }`; `apps → plexus-core`.
No cycle. plexus-core's `FileTreeContributor` imports `ProjectContentProvider`/`ProjectContentStore`
from TODL and `HierarchyModel`/contribution types from `mural/framework/hierarchy`.

## 3. Mural: the generic tree VM (`framework/hierarchy`)

Two view models, purely over `HierarchyModel`/`HierarchyItemId`/`HierarchyNode` — no `Solution`,
`SolutionMember`, storage, or any TODL/Plexus type. Both extend `Observable`
(todl-runtime INPC root) and implement `Disposable` (`dispose()`).

### 3.1 `HierarchyItemVM`

One tree row wrapping `(model: HierarchyModel, id: HierarchyItemId)`.

- `Caption: string` — `model.GetProperty(id, Caption)`; re-read on `ChildUpdated` for this id.
- `IconKey: string` — `model.GetProperty(id, IconKey)`; the VM exposes the **key** (a string),
  not geometry, keeping it domain-agnostic. The panel maps key→geometry (§5, §7).
- `Severity: NodeSeverity` and `Error: string | undefined` — from `GetProperty`; carried now,
  rendered as plain rows for `Ok`. Decoration of Warning/Error rows is P6.
- `IsExpandable: boolean` — `GetProperty(id, IsExpandable)`; drives chevron visibility.
- `Children: ObservableCollection<HierarchyItemVM>` — empty until first expand.
- `OnExpand(): void` — idempotent (guards a `realized` flag). First call: `model.RealizeChildren(id)`,
  then subscribe to the model's per-node child change feed for `id`. The subscription patches
  `Children`:
  - `ChildAdded` → insert `new HierarchyItemVM(model, change.Id)` at the model's index for that id
    (`model.ChildrenOf(id).indexOf(change.Id)`), not appended, so a late add from a rename lands
    in sorted position.
  - `ChildRemoved` → find the child VM whose `id === change.Id`, remove it from `Children`, and
    `dispose()` it (recursive).
  - `ChildUpdated` → the child VM whose `id === change.Id` re-reads `Caption`/`IconKey`/`Severity`.
- `OnCollapse(): void` — `model.Collapse(id)`, drop the subscription, clear `Children`, reset
  `realized` so a re-expand re-realizes (matches P1's collapse/re-list liveness).
- `Data` — exposes the row's `ExtObject` (`GetProperty(id, ExtObject)`) so a host can act on the
  underlying model object (used by open-on-activate, §7). Domain-agnostic: typed `unknown`.
- `dispose()` — unsubscribe, dispose child VMs.

**Model change feed (a required Mural addition).** Today `HierarchyModel` has no public per-node
child-change subscription — it patches its internal `entries` from both regimes (keyed
re-contribution via `reRealizeKeyed`/`internKeyed`/`pruneKeyed`, and provider deltas via
`attachProvider`) without notifying consumers. P2 adds `HierarchyModel.ObserveChildren(id, sink):
() => void`: the model emits `ChildAdded(childId, node)` / `ChildRemoved(childId)` /
`ChildUpdated(childId, node)` to the sink whenever the children set for `id` mutates, from
**either** regime — unifying keyed and provider-owned nodes behind one feed so the VM never sees
the distinction. The emission points are the existing `entries`-mutation sites; the delta types
are P0's `ChildAdded`/`ChildRemoved`/`ChildUpdated`. This is the seam that makes realize=subscribe
reach the presentation layer, and it is the load-bearing new surface of P2's Mural release.

### 3.2 `HierarchyTreeVM`

The tree root the panel's `ItemsSource` binds, constructed with a `HierarchyModel`.

- `Roots: ObservableCollection<HierarchyItemVM>` — the realized children of
  `HierarchyItemId.Root`. Construction calls `RealizeChildren(Root)` and subscribes (the root is
  always expanded), patching `Roots` exactly as a node patches `Children`.
- `dispose()` — tear down the root subscription and every row VM.

### 3.3 Mural reactivity seam

Two additions so a contributor whose *data* changed (not its registration) refreshes the tree:

- `HierarchyContributorRegistry.NotifyContributionsChanged(): void` — **public**; raises the same
  `PropertyChanged('Contributors')` the private register/unregister path raises, which the
  `HierarchyModel` already subscribes to (`reRealizeKeyed`). A live contributor calls this when
  its output would differ.
- `HierarchyModel.internKeyed` — on re-contribute, when a keyed child with the same `ExtObject`
  identity already exists, **update its node props in place** (Caption/IconKey/Severity/Error)
  and emit `ChildUpdated(existingId, newNode)`, rather than keeping the stale node. The
  `HierarchyItemId` is preserved (interning identity unchanged), so subscribed VMs repaint
  without losing row identity/selection. `pruneKeyed` (absent identities removed) and new-identity
  interning are unchanged.

## 4. plexus-core: node keys

Front-end node keys owned by plexus-core, hoisted as `private static readonly` PascalCase
constants (no inline literals), registered in the `NodeKeyRegistry` so the P0 collision check
covers them:

- `SolutionRootKey = 'solution'` — the seeded root node's key.
- `SolutionMemberKey = 'solution-member'` — each member row's key; the parent key the file-tree
  contributor fires for.

These are distinct from the TODL-owned content keys (`folder`/`file`/`diagram`/`todl`) recorded
in `KEY-NAMESPACES.md` at P1; P2 adds the two front-end rows to that doc.

## 5. plexus-core: the contributors

### 5.1 `ProjectsListingContributor implements IHierarchyContributor`

Fires for `ParentKeys = [SolutionRootKey]`.

- Constructed with the active `Solution` and a `MemberStorageFor` resolver (both handed in by the
  capability when it seeds a root for that solution).
- `Contribute(rootNode): NodeContribution` — one `HierarchyNode` per `Solution.Members`, in
  collection order:
  - `Key = SolutionMemberKey`
  - `Caption = member.Title`
  - `IconKey = SolutionMemberIconKey` (a `private static readonly` constant)
  - `ExtObject = member` — the `SolutionMember`; the **stable interning identity** so
    re-contributes keep each row's `HierarchyItemId`.
  - `Severity` from `member.Status`: `LoadFailed` → `Error`, `UnknownType` → `Warning`, else `Ok`.
  - `Error = member.Error` (undefined unless `LoadFailed`).
- **Reactivity.** The contributor subscribes to `Solution.Members` `CollectionChange` and to each
  member's `PropertyChanged('Status')`. On any change it calls
  `registry.NotifyContributionsChanged()` → the model re-contributes the solution root:
  `internKeyed` keeps survivors' ids and refreshes their props (Status→Severity/Caption repaint),
  `pruneKeyed` drops removed members, new members intern fresh. Per-member `Status` subscriptions
  are added on member-add and disposed on member-remove — no leak (the discipline P1's store used
  for watchers).
- `dispose()` — drop the `Members` subscription and every per-member `Status` subscription.

### 5.2 `FileTreeContributor implements IHierarchyContributor`

Fires for `ParentKeys = [SolutionMemberKey]`.

- Constructed with the `MemberStorageFor` resolver.
- `Contribute(memberNode): HierarchyContribution` — `member = memberNode.ExtObject as SolutionMember`:
  - Resolved (`member.Status === Resolved` and `member.Storage` defined):
    `new ProviderContribution(new ProjectContentProvider(new ProjectContentStore(member.Storage)))`.
    The provider owns the file subtree (realize=subscribe, disk-watched). `RealizeChildren` returns
    on the first `ProviderContribution` and `attachProvider` guards `entry.provider === provider`,
    so re-contributing the member's parent never re-mounts.
  - Unresolved (`UnknownType`/`LoadFailed`, or no storage): `new NodeContribution([])` — an empty,
    non-expandable leaf carrying the member's Severity.
- **Store lifecycle.** The contributor tracks the `ProjectContentStore` it created per member
  (keyed by `SolutionMember`). It disposes a member's store when that member is pruned (learned via
  the same `Members` change feed the listing contributor watches — the file-tree contributor also
  subscribes, or the capability coordinates teardown) and when the contributor itself is disposed,
  releasing the P1 chokidar watchers. Disposing a store must not throw if the member was never
  expanded (store lazily starts watching only on first `ObserveChildren`).
- `dispose()` — dispose every tracked store and drop subscriptions.

Both contributors are DI-resolvable via `ServiceToken` (matching `HierarchyContributorDefinition.Contributor`),
but P2 registers them imperatively (§6), so their constructors take concrete deps, not the
registry's markup path.

## 6. plexus-core: the `SolutionExplorer` capability

`SolutionExplorerService extends Observable` — the service behind the left-panel nav entry.

- `constructor(provider: IServiceProvider)`; resolves `SolutionManagerService`,
  `HierarchyContributorRegistry`, and the member storage resolver from the provider. Real classes,
  ctor takes `IServiceProvider`/deps (no seam bags).
- `Start(): void` — subscribe to `SolutionManagerService.PropertyChanged('ActiveSolution')` and
  project the current value once.
- On active-solution change (`rebuild`):
  1. Dispose the current `HierarchyTreeVM`, drop the current model, and dispose + unregister the
     current contributors (their `registry.Register` disposers), which disposes their stores/watchers.
  2. If a solution is open: build `new HierarchyModel(registry)`;
     `model.SeedRoot({ Key: SolutionRootKey, Caption: solution.Name, IconKey: SolutionRootIconKey })`; construct
     `ProjectsListingContributor(solution, storageFor)` and `FileTreeContributor(storageFor)`,
     register each via `registry.Register(def)` (keeping disposers); set
     `Tree = new HierarchyTreeVM(model)` and raise `PropertyChanged('Tree')`.
  3. If none: `Tree = undefined` (panel shows empty state).
- `Tree: HierarchyTreeVM | undefined` — what the panel binds.
- `dispose(): void` — unsubscribe from the manager; dispose the current tree, model, and contributors.

**Why imperative registration.** The `.hierarchyContributors:` markup block resolves stateless,
app-global `ServiceToken` contributors. P2's contributors are per-`Solution` (they close over the
active solution and storage resolver and must be disposed on swap), so the capability registers
them imperatively on each open and disposes them on close/swap. `registry.For(parentKey)` and the
`PropertyChanged('Contributors')` re-realize seam work identically for imperatively-registered
contributors. The static markup path is left for a later phase's app-global contributors.

## 7. apps: panel cutover and open-on-activate

- **Capability flip.** The left-panel nav entry's Capability switches `ServiceKey` from
  `ProjectExplorerService` to `SolutionExplorerService` via a new
  `solution-explorer.module.mu` (registered in the app's `.modules:`); the old
  `project-explorer.module.mu` Capability is retired. `ProjectExplorerService` itself survives as
  a registered service (lifecycle + surviving command objects for P3/P4), just no longer the
  panel's tree source.
- **Panel resources** (`solution-explorer.resources.mu`): reuse the existing panel chrome — a
  `DockPanel` with a top command bar (Open/New-project `PanelButton`s still bound to the surviving
  `ProjectExplorerService` lifecycle commands through the provider), a hairline, a bottom status
  strip, and the tree filling the middle. Empty-state text when `Tree` is undefined.
- **The tree** is one `TreeView [ IsVirtualizing = true, ItemsSource = $Tree.Roots,
  ItemTemplate = @HierarchyItemTemplate, SelectionMode = Extended ]` with a single
  `HierarchicalDataTemplate x:key="HierarchyItemTemplate" [ DataType = HierarchyItemVM,
  itemsselector = Children ]`: a leading `Shape [ Geometry = $IconKey << IconKeyToGeometry ]`
  and `TextBlock [ Text = $Caption ]`. **No** `ContextMenuService.ContextMenu`, rename slot, or
  drag behavior — read-only.
- **`IconKeyToGeometry`** (plexus-core converter): maps the content keys
  (`folder`/`file`/`diagram`/`todl`) and the member key to the existing geometries the old
  `KindToGeometry` used — cashing the P1 "real icon = P2/registry" deferral. Every key the
  contributors/provider emit has a mapping (tested).
- **Expand/collapse wiring.** `TreeViewItem` expand state drives `HierarchyItemVM.OnExpand`/
  `OnCollapse`. P2 uses whichever expand hook the existing meta-model/reference trees use
  (a behavior or `IsExpanded` binding) — confirmed against that code in writing-plans, matched
  rather than reinvented.
- **Open-on-activate** (the one interaction in scope): double-click / Enter on a file row
  delegates to the surviving open path. The panel's activate handler reads the row's `Data`
  (`ProjectContentNode` — `Path` + `Kind`), resolves the owning member, and calls the existing
  `ProjectExplorerService`/document-host open-by-(member, path) entry. A small activate seam that
  P4 formalizes into the command model. Folder rows expand rather than open.

## 8. Testing

Per the migration spec: real fixtures where the engine is involved, fast fakes for logic. Tests
in `tests/` subfolders. Runner: `npx tsx --conditions=development --test [--test-force-exit]`.

**Mural (`framework/hierarchy/tests`), unit with a fake/real model + fake contributor:**

- `HierarchyItemVM`: expand realizes + subscribes; pushed `ChildAdded`/`ChildRemoved`/`ChildUpdated`
  patch `Children` (added lands at the model's index, not appended); `ChildUpdated` repaints
  Caption/IconKey/Severity; collapse clears + re-expand re-realizes; `dispose` unsubscribes and
  disposes descendants; `Data` returns the ExtObject.
- `HierarchyTreeVM`: `Roots` realizes the root's children at construction and patches on deltas;
  `dispose` tears down.
- Reactivity seam: `NotifyContributionsChanged` raises `PropertyChanged('Contributors')`;
  `internKeyed` on re-contribute keeps the same `HierarchyItemId` and emits `ChildUpdated` with
  refreshed props (assert id identity + new Caption/Severity).

**plexus-core (`modules/solution-explorer/tests`), `FakeStorage` + hand-built `Solution`:**

- `ProjectsListingContributor`: members → rows in order; add/remove a member patches the listing;
  `Status` flip repaints Severity/Caption with the **same id**; per-member `Status` subscriptions
  disposed on member removal (assert no leak via a subscription/dispose spy).
- `FileTreeContributor`: a resolved member mounts a provider and files appear on expand; an
  unresolved member is a non-expandable leaf carrying its Severity; pruning a member disposes its
  `ProjectContentStore` (assert watcher teardown via a `FakeStorage` watcher-count spy); disposing
  a never-expanded member's store does not throw.
- `SolutionExplorerService`: opening a solution publishes a `Tree` with a solution root + member
  rows; closing sets `Tree = undefined`; a second open disposes the prior model/contributors/stores;
  `IconKeyToGeometry` maps every content + member key to a geometry (exhaustive).
- **Real-fs integration:** a checked-in fixture project on real Node-fs storage, opened through a
  real `Solution` + real `ProjectContentProvider` + chokidar, expands to real files (the P1
  real-fs init allowance applies).

**apps/plexus (e2e):** the Solution Explorer panel renders the tree for an open solution;
double-click opens a file (open-on-activate). Retire/adjust the old `project-explorer` e2e
expectations that asserted the context menu / rename / delete.

## 9. Behavior port (the §5 rip-and-replace inventory, P2 disposition)

| Behavior (old tree)                              | P2 disposition |
|--------------------------------------------------|----------------|
| Browse / expand project files/folders            | **P2** (reactive, lazy, virtualized) |
| Open node / open file in editor                  | **P2** (open-on-activate, §7) |
| Add-New submenu, New Folder, Import file/folder  | P3 (mutation) |
| Inline Rename (F2), Delete (+close-guard), Move  | P3 (mutation) |
| Close project, Move project                      | P4 (commands) |
| Diagram Export SVG / PPTX                         | P4 (commands) |
| Publish / Version; agent/skill Run menu           | P4 (commands) |
| Selection redistribution → per-project commands   | P4 (selection) |
| LiveValidation ResyncProject / base refresh       | P4 (re-homed onto the model) |
| `IProjectTreeHost` reveal / file-watch reload     | P4 (re-point to the capability) |

`ProjectExplorerService` retains project **lifecycle** (open/close/restore, member resolution to
`OpenProject`, the surviving command *objects*) so P3/P4 have a target to re-home onto. Only the
projection and its templates/menus retire in P2.

## 10. Global constraints

Carried into every task (from global CLAUDE.md, in effect this workspace):

- OOP: every function a method or static member; no module-level free functions or state;
  `is<X>` type-guards follow the `isLocalFileAccess` free-function precedent.
- Allman braces (opening brace on its own line) for class/interface/enum/method/control blocks;
  `else`/`catch`/`finally` on their own line; object literals, block-arrow bodies, and genuine
  one-liners stay inline.
- No inline reused/keyed string literals — node keys, icon keys, property names, and status text
  are `private static readonly` PascalCase constants.
- View models extend `Observable`, not `MuralBase`.
- PascalCase for interfaces and all public methods.
- Enums over string-literal unions.
- Tests live in `tests/` subfolders beside their source.

## 11. Carried and open decisions

- **Node↔provider-root mapping: implicit (chosen).** The seeded root and each member node are
  ordinary keyed nodes; the file-tree contributor's `ProviderContribution` mounts the provider
  under the member node with no explicit root-child node. Resolves the umbrella §8 open item for P2.
- **Rename identity via stable ids** — the P1 provider already maps a rename to `ChildUpdated`
  with a `===`-stable id; the tree VM's `ChildUpdated` path repaints in place. Confirmed in scope.
- **`HierarchyModel` public child-observation** — P2 **adds** `ObserveChildren(id, sink)` to the
  model (§3.1); it has no such surface today, and it is the load-bearing new Mural API this phase
  needs. Not conditional.
- **`ProjectContentProvider` home** — stays in TODL for P2 (imported by plexus-core). Re-homing to
  the front-end per the "hierarchy is a front-end instrument" principle is a deferred cleanup.

## 12. Deliverable and release

A Plexus left panel whose tree is driven end-to-end by the hierarchy framework + engine: open a
solution → member rows appear (with load-status severity) → expand a resolved member → its files
stream in from the disk-watched content store → edits on disk reflect live → double-click opens a
file. The old projection is gone. Land + green in Mural, then plexus-core + apps; publishing and
the mural-pin bump are the user's deferred step. Ships behind the normal Mural release + Plexus
adoption cycle; P3 builds mutation on this tree.
