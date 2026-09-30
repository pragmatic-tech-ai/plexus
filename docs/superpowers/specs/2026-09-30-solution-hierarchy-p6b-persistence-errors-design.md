# Solution Hierarchy P6b — Persistence & Errors — Design

**Status:** Draft for review
**Date:** 2026-09-30
**Builds on:** P0–P5 (Solution Hierarchy), P6a (scope-based property bags)
**Repos touched:** Mural (hierarchy framework + tree-view), Plexus/plexus-core (solution-explorer), Plexus/apps (wiring)

## Goal

Give the Solution Hierarchy durable, per-solution view state and a coherent
removal verb:

1. **Canonical-name persistence + reactive restore** — remember which tree rows
   were expanded and which were selected, per solution, and restore that state
   reactively as the tree realizes on the next open.
2. **Extend the two `HierarchyModel` P0 stubs** — `CanonicalNameOf` to full
   ancestor-path names with provider-boundary delegation, and `Reveal` to a
   realize-on-demand lookup.
3. **"Remove from Solution"** — one removal verb on every member row, covering
   both resolved (projected) members and unresolved/errored members that the
   current "Close Project" action silently no-ops on.

## Context

The Solution Hierarchy (P0–P5) renders a keyed-regime `HierarchyModel` walked
into `HierarchyItemVM`/`HierarchyTreeVM` rows, hosted by Mural's `TreeView`.
Providers (file trees, references, connections) own opaque subtrees below a
provider boundary. P6a shipped the scope-based property-bag substrate:
`GlobalBagPersister` (a durable, app-scoped `IBagPersister` over
`userData/application-bags.json`) is the natural home for user-local,
never-committed view state.

Today the tree opens fully collapsed with no selection every time, and the
`CanonicalNameOf`/`Reveal` methods on `HierarchyModel` are single-segment P0
stubs with **zero callers** — free to reshape. The member context menu offers
"Close Project", which routes to `IContentMutations.CloseMember`; that method
is a **no-op for any member that was never projected** (an unresolved or
load-failed member), so those rows currently have no working removal action.

## Decisions locked (from brainstorming)

These three forks were settled with the user before this spec:

- **State scope = Global, keyed by solution path.** View state is user-local,
  never written to the shareable solution manifest. It lives in the global
  durable bag store keyed by the solution's on-disk root path. An **untitled**
  solution (no location) gets **session-only** in-memory state — nothing is
  persisted until it is saved and gains a path.
- **Removal verb on ALL member rows.** No separate "unload" concept.
- **Rename "Close Project" → "Remove from Solution"** on every `NodeKey.Project`
  row. Resolved members keep today's guarded behaviour (prompt on dirty tabs,
  then remove membership); unresolved members are removed directly. The
  "Close Project" label is retired.

## Architecture overview

Four units, across two repos. Each has one responsibility and a narrow seam:

| Unit | Repo | Responsibility |
|------|------|----------------|
| **A. Canonical names** | Mural `hierarchy-model.ts` | Full ancestor-path `CanonicalNameOf` + provider delegation; realize-on-demand `Reveal`. |
| **B. Programmatic expansion** | Mural `hierarchy-item-vm.ts` + solution-tree template | Observable `IsExpanded` + `Expand()`/`Collapse()` on the row VM; two-way bound to `TreeViewItem.IsExpanded`. |
| **C. Tree-state service** | Plexus `solution-explorer` | Persist + reactively restore expansion/selection via `GlobalBagPersister`, keyed by solution path. |
| **D. Remove from Solution** | Plexus `solution-explorer` + `project-explorer` | Rename the action; `RemoveMember` handling projected and non-projected members. |

Units A and B are the Mural-side primitives (a Mural publish + Plexus re-adopt,
like the todl cascade in P6a). C and D are Plexus-only and consume A/B.

---

## Section 1 — Canonical names in `HierarchyModel` (Unit A)

### Parent pointers

`Entry` currently records `node`, `children`, and provider bookkeeping but **no
parent**. Add `parent?: HierarchyItemId` to `Entry`, set wherever a child entry
is created:

- `internKeyed` — the interned child's entry gets `parent = parentId`.
- `patch`'s `ChildAdded` — the provider-added child's entry gets
  `parent = parentId` (alongside the existing `owner`).
- `SeedRoot` — the root's entry has `parent` undefined.

This is the only structural change to the model's state.

### `CanonicalNameOf(id)` — full ancestor path with provider delegation

Compose the path root→node, one **segment per node**, joined by `/`:

- A **keyed** node (no `entry.owner`) contributes its `node.Key`.
- A **provider-owned** node (below a provider boundary, `entry.owner` set)
  contributes the provider's own segment for that node — the provider is the
  authority for naming inside its subtree. The model asks the owner via
  `owner.GetProperty(id, HierarchyPropertyId.CanonicalName)`, falling back to
  `node.Key` when the provider returns nothing.

Walk `entry.parent` from `id` up to the root, collect each node's segment, then
join in root→leaf order with `/`. The root segment is included so names are
absolute within the tree. Provider-relative segments that themselves contain
`/` (e.g. file paths) are the provider's concern: a provider that emits
multi-segment names is internally consistent with its own
`ParseCanonicalName`, and the model treats the provider's contributed segment
as opaque text between the boundary separators.

`GetProperty(id, CanonicalName)` — currently returns `node.Key` unconditionally
— is **repointed to delegate to `CanonicalNameOf(id)`** so a single method is
the authority and provider-owned nodes report their full path, not a bare key.

### `Reveal(canonicalName)` — realize-on-demand lookup

Replace the flat scan-realized-entries stub with a descend-and-realize walk:

1. Split the name into segments on `/`.
2. Start at the root; for each segment, `RealizeChildren` the current node
   (synchronous for the keyed regime), then find the child whose own segment
   matches; descend.
3. Return the matched `HierarchyItemId`, or `HierarchyItemId.Nil` if any
   segment has no match.

**Provider-boundary limitation (documented, by design):** realization below a
provider boundary is asynchronous (the provider emits `ChildAdded` through
`ObserveChildren` on its own schedule), so a synchronous `Reveal` cannot force
a provider subtree to materialize. `Reveal` descends the keyed regime fully and
resolves provider-owned nodes **only if already realized**; an unrealized
provider-subtree target returns `Nil`. This is acceptable because the reactive
restore (Section 3) does **not** use `Reveal` to descend — it matches canonical
names of nodes as they appear. `Reveal` remains a best-effort primitive for
callers that want "resolve this name to a live node id if present."

---

## Section 2 — Programmatic expansion (Unit B)

### The problem

Expansion today flows **view → data** only: clicking a chevron sets
`TreeViewItem.IsExpanded` (a DP), whose change handler calls the bound data's
`OnExpand()`/`OnCollapse()` (the `HierarchyItemVM`, which realizes/releases the
subtree). There is no **data → view** path, so nothing can restore expansion
programmatically.

### The seam

Give `HierarchyItemVM` an observable expanded state and programmatic methods,
and bind `TreeViewItem.IsExpanded` **two-way** to it in the solution-tree
template — mirroring how `TreeView.SelectedDataItem` is already two-way bound.

`HierarchyItemVM` changes:

- The private `expanded` flag becomes the backing store of a public
  `get IsExpanded(): boolean`.
- `OnExpand()`/`OnCollapse()` (the framework view→data hooks) additionally
  raise `PropertyChanged('IsExpanded')` so the mirror stays truthful.
- New `Expand()` / `Collapse()` public methods drive expansion from code: they
  run the same realize/release logic as `OnExpand`/`OnCollapse` and raise
  `IsExpanded`. (Implementation: `Expand()`/`Collapse()` and the framework
  hooks share one private core; all are idempotent on the `expanded` flag.)
- New `get CanonicalName(): string` → `model.CanonicalNameOf(this.Id)`, the
  address the state service persists and matches on (mirrors the existing
  `Key` getter).

Template change (solution-tree `HierarchicalDataTemplate` in plexus-core):
add `IsExpanded={Binding IsExpanded, Mode=TwoWay}` to the `TreeViewItem`.

### Why the cascade works

Setting `vm.Expand()` raises `IsExpanded` → the two-way binding pushes
`true` into `TreeViewItem.IsExpanded` → the DP handler calls `OnExpand()` →
children realize → child VMs appear in `Children` → their containers
materialize and, being two-way bound, pick up each child VM's `IsExpanded` on
attach. So expanding a node whose children are also in the persisted-expanded
set cascades automatically. Re-entrancy is bounded by the idempotent
`expanded` flag (a second `OnExpand` after `Expand` already realized is a
no-op).

---

## Section 3 — Tree-state service (Unit C)

A new `SolutionTreeStateService` in `plexus-core/.../solution-explorer`,
constructed by the solution-explorer wiring alongside each solution's
`HierarchyTreeVM`, and disposed + rebuilt on solution swap.

**Dependencies (constructor):** the `HierarchyTreeVM` for the active solution,
the `GlobalBagPersister` (resolved via `GlobalBagPersisterKey`), and the active
`Solution` (for its keying path and `HasLocation`).

### Storage shape

One bag per solution in the global durable store:

- kind = `'solution-tree-state'` (a `private static readonly` const)
- id = the solution's on-disk root path (from `Solution.Storage`); the plan
  pins the exact accessor.
- properties on the bag:
  - `expanded`: `string[]` — canonical names of currently-expanded rows.
  - `selection`: `string[]` — canonical names of selected rows.
  - `anchor`: `string` — canonical name of the selection anchor (or absent).

**Untitled solution** (`HasLocation === false`): the service keeps this state
in an in-memory map for the session only and never touches the durable store.
If the solution is later saved (gains a path), state written from that point
persists under the new path; pre-save state is not migrated (YAGNI).

### Persist

The service observes:

- each realized row VM's `PropertyChanged('IsExpanded')` (subscribed as VMs
  appear, disposed as they vanish), and
- `HierarchyTreeVM.Selection` collection changes + anchor.

On any change it schedules a **debounced** save: walk the realized VM tree,
collect `CanonicalName` of every expanded VM and every selected VM plus the
anchor, and write the three properties to the bag (create-on-write via
`GlobalBagPersister.Bag`). The durable store's own debounced save flushes to
disk. Stale names (a row that no longer exists) are naturally absent from the
freshly-collected set, so the persisted set **self-prunes** on the next save.

### Restore (reactive / delta-driven)

On solution open, after the `HierarchyTreeVM` is built, the service loads the
saved `expanded`/`selection`/`anchor` for that solution's key (missing or
malformed → empty, no crash) and drives restore as the tree realizes:

- Subscribe to `HierarchyTreeVM.Roots` and, recursively, each
  `HierarchyItemVM.Children`.
- As each VM appears, compute `vm.CanonicalName`:
  - if it is in the `expanded` set → `vm.Expand()` (which realizes its
    children, feeding more appearances — the cascade);
  - if it is in the `selection` set → add it to the tree's selection
    (`HierarchyTreeVM.Selection`), and set it as anchor if its name matches
    `anchor`.
- Names that never resolve (a removed or renamed member/file) are simply never
  applied and drop out on the next save.

The service never forces a synchronous full descent; it reacts to the same
delta stream the VMs already consume, so provider subtrees restore as they
asynchronously materialize.

### Isolation

The service's only outward effects are `vm.Expand()`, mutating
`HierarchyTreeVM.Selection`, and reading/writing its own bag. It does not reach
into the model, the view containers, or other services. It can be unit-tested
against a `HierarchyTreeVM` over a fake model and a fake `IBagPersister`.

---

## Section 4 — Remove from Solution (Unit D)

### Action rename

In `ProjectActionsContributor` (solution-explorer): rename the `CloseLabel`
constant value from `'Close Project'` to `'Remove from Solution'`, and route it
to a new `IContentMutations.RemoveMember(member)` instead of `CloseMember`. The
action stays on `NodeKey.Project` rows (all member rows). No other action in the
menu changes.

### `RemoveMember` on `IContentMutations` / `ProjectExplorerService`

Add `RemoveMember(member: SolutionMember): Promise<void>`:

- **Projected (resolved) member** — an `OpenProject` exists in `this.projected`:
  delegate to the existing `closeProject(op)` path, which prompts through
  `DocumentCloseGuard` on dirty tabs (Cancel aborts the removal), then calls
  `manager.CloseProject(member)` → membership removed → `onMemberRemoved`
  teardown. This is exactly today's "Close Project" behaviour, now relabelled.
- **Non-projected member** — present in the tree but never projected (an
  unresolved / load-failed / unknown-type row): remove it directly from
  `ActiveSolution.Members` (the same mechanism `dropUnresolvedMember` uses),
  which fires the standard `onMemberRemoved` teardown. No tabs exist to guard.

`CloseMember` may remain as-is (still used programmatically); `RemoveMember` is
the superset the UI calls. The plan decides whether `CloseMember` is folded
into `RemoveMember` or kept as the projected-only fast path.

### Visibility of unresolved members

`ProjectsListingContributor` already contributes unresolved member rows with
severity (`LoadFailed` → Error, `UnknownType` → Warning) and marks them
non-expandable. For "Remove from Solution" to have subjects, such rows must
remain visible rather than being silently auto-dropped. **Design requirement:**
a member that is present in `ActiveSolution.Members` and shown in the tree must
be user-removable via this action regardless of its `SolutionMemberStatus`. If
implementation reveals that `ProjectExplorerService.dropUnresolvedMember`
auto-removes a class of member the user should be able to see and remove, the
executor rules on narrowing that auto-drop so those rows persist for the user
— recorded as a ruling. (Flagged as an open question for review below.)

---

## Section 5 — Errors & edge cases

- **Corrupt / missing state bag:** reads defend with defaults (empty
  arrays / absent anchor); never throws into tree construction.
- **Stale canonical names:** never applied; self-pruned on next save (Section 3).
- **Untitled solution:** session-only, no disk writes (Section 3).
- **Solution swap:** the service is disposed (drops all VM subscriptions and
  the bag handle) and a fresh one built for the new solution's tree.
- **Removal of a selected/expanded member:** its `ChildRemoved` disposes the
  VM (existing behaviour deselects it), and its name drops from the persisted
  sets on the next save.
- **Rename round-trip:** a renamed keyed node keeps its VM via `ChildUpdated`;
  its canonical name changes with its key, so the old name self-prunes and the
  new expanded/selected state is captured on the next save.

## Section 6 — Testing strategy

TDD throughout. Test homes follow house style (`tests/` next to source).

**Mural (Unit A):**
- `CanonicalNameOf` composes a multi-level keyed ancestor path.
- `CanonicalNameOf` delegates the provider-owned segment to the owner and
  prefixes the keyed ancestor path.
- `Reveal` descends and realizes a collapsed keyed target and returns its id;
  returns `Nil` for an unknown name and for an unrealized provider target.

**Mural (Unit B):**
- `Expand()`/`Collapse()` toggle `IsExpanded`, realize/release children, and
  raise `PropertyChanged('IsExpanded')`.
- Framework `OnExpand`/`OnCollapse` keep `IsExpanded` truthful.
- `CanonicalName` getter returns the model's full path.

**Plexus (Unit C):**
- Persists expanded + selection + anchor after changes (debounce flushed).
- Reactively restores expansion and selection across a rebuild, including a
  cascade two levels deep.
- A stale persisted name is skipped without error and disappears on next save.
- Untitled solution: nothing written to the durable store; state survives
  within the session.

**Plexus (Unit D):**
- `RemoveMember` on a projected member guards dirty tabs (Cancel aborts) and
  removes membership.
- `RemoveMember` on a non-projected (unresolved) member removes it from
  `Members` directly.
- The action label reads "Remove from Solution" and is present on member rows.

## Cross-repo / publish impact

- **Mural** changes (Units A, B): publish a new Mural version, bump the pin in
  Plexus (and Fresco/TODL as the workspace requires), `npm install`, rebuild
  plexus-core `dist`. plexus-core's vitest aliases mural → dist, so its tests
  pick up the built change.
- **Plexus** changes (Units C, D): plexus-core src + the solution-tree template
  + apps wiring (the state service is constructed where the solution-explorer
  tree is built). No todl-runtime/TODL source changes expected.
- Follow the standing rule: bump to the newest published versions.

## Out of scope (YAGNI)

- Scroll position / horizontal state — only expansion + selection.
- Cross-device / committed view state — global-local by decision.
- Migrating untitled state on Save As.
- A separate "unload" (keep-membership-but-close) concept — explicitly rejected.
- Using `Reveal` to force async provider descent — the reactive path covers restore.

## Open questions for review

1. **Auto-drop of unresolved members (Section 4).** Should P6b narrow
   `ProjectExplorerService.dropUnresolvedMember` so unresolved members stay
   visible and user-removable, or are the only unresolved rows that reach the
   tree ones the auto-drop already leaves alone? This determines whether Unit D
   includes a small change to the projection path or is purely additive.
2. **Canonical-name separator.** `/` is proposed; confirm no keyed `Key`
   value contains `/` in a way that would collide (provider segments are
   treated as opaque and are the provider's own concern).
