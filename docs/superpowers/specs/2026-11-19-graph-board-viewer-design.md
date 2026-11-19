# Graph Board Viewer — Design

**Status:** awaiting approval
**Author:** (brainstormed 2026-11-19)
**Kind:** Spec (to be registered in GitHub Project #1 per repo CLAUDE.md on approval)

## Intent and why

When the user clicks a **graph** node in the environment tree (the **Tenant
Explorer**), they want to *see what that graph holds* — its nodes and edges — on
a **Board** (the node-and-connector surface, recently renamed from "Diagram").
Today that tree node is an inert label: no identity, no click behaviour. This
feature makes a selected environment graph openable as a **read-only Board**
that renders the graph's full TODL model, so the user can visually inspect it.

The rename to "Board" was done first precisely so this viewer is built on the
final vocabulary.

## Goals

- Clicking (activating) a graph node in the Tenant Explorer opens a **read-only
  Board tab** showing that graph's nodes and edges.
- The view works for **any graph** listed under an environment, sourced from the
  compiled **`ModelView`** (a `Repository`) of a **Develop** session on the
  environment target.
- Render the **raw full TODL graph** — every node and every edge in the
  compiled model, including prelude / system / meta-model / ontology scaffolding
  (the user asked for the literal, complete graph, not a filtered content view).
- Nodes are **positionless** in TODL, so the viewer **auto-lays-out** via the
  existing fresco layout pipeline before/at display.
- The board is **read-only**: no editing, no mutation, no drop, no editing
  toolbar/context-menu; camera (zoom/pan) stays enabled.
- On open, the user may choose **Snapshot** (default) or **Live**: Snapshot
  renders the current state with a Refresh action; Live subscribes to the
  session's `GraphChanged` and re-projects.
- For a **very large** graph (node count over a threshold), a confirm/warning is
  shown before laying out (fresco layout + render of thousands of nodes is slow).

## Non-goals

- **Editing the graph.** Strictly a viewer. No write-back, no mutation commands.
- **A curated / filtered "architecture" view.** The user explicitly chose the
  raw full graph; per-type styling and scaffolding-filtering are out of scope
  (possible future "pretty" mode).
- **Persisting the view.** The board is in-memory and transient; it is not saved
  to disk as a `.board` file and does not round-trip.
- **Changing the graph's contents or the Develop session's lifecycle semantics**
  beyond opening a session to read `ModelView`.

## Anti-goals (would make this a failure even if it "works")

- A board the user can accidentally **edit** (and thus think they changed the
  real graph). Read-only must be real: no mutator wired, no editing affordances.
- **Freezing the app** by laying out a huge graph with no warning.
- Leaking or holding a **Develop session** forever after the tab is closed
  (Snapshot should not keep a live subscription; Live must release on close).

## Constraints

- **OOP / Allman / no-inline-literals (TS) / PascalCase** house rules. New
  view-model classes extend `Observable` unless they need the DP system; a board
  content node must be a `NodeViewModel` (the type the board generator expects).
- The engine never calls up; UX → engine/relay calls are normal. The viewer is
  pure renderer/UX over the existing dev-session + board framework.
- **Merge locally; never push/publish without explicit instruction.**
- Tests live in `tests/` subfolders.
- The held **Develop session is a singleton** bound to one target at a time
  (`devSession.Open(target)` rebinds). The viewer must cooperate with that.

## Approaches considered

1. **ModelView via a Develop session + reuse the Board framework — CHOSEN.**
   Open a Develop session on the environment target, pull the compiled
   `Repository` via `ModelView`, project every node→`NodeViewModel` and every
   edge→`Connector` onto an in-memory read-only `BoardDocument`, auto-layout via
   fresco, open as a tab. Richest/most-complete model; works for any graph.
   Cost: spins up a Develop session to view; singleton-session contention.
2. **Parse the graph's contributed package `modelJson` via the read-only Inspect
   path — rejected by owner.** Lighter and read-only, but `Contents` discards the
   packages and `GetLoadedGraph` returns only the env's single loaded graph, so
   "any graph" wouldn't be covered without new backend work. Owner chose the
   richer ModelView path.
3. **Build a bespoke graph canvas from scratch — rejected.** The Board already
   renders node/connector models and auto-lays-out positionless nodes; building a
   second surface duplicates all of that.

## The design

### Data path (renderer → compiled model)

- Thread identity: `TenantExplorerService.LoadContents(target)` already has the
  environment `TargetRef`. Give `TenantExplorerNode.Graph` the `TargetRef` and
  the graph **name** (today it keeps only a label). Add selection/activation
  wiring to the Tenant Explorer `TreeView` (none exists): a `SelectedItem` +
  activation command that, for a `Graph` node, invokes the viewer open.
- Open the viewer: `PlexusDevSession` (`IpcDevSession` over `window.api.devSession`)
  → `Open(target)` to bind the held Develop session to the environment, then
  `ModelView(...)` → `SolutionModelView { model: Repository }`.
- **Named-graph targeting (KEY RISK — resolved in the plan):** the held session
  is singular and `ModelView` takes a storage/document argument. The plan must
  establish the exact call that yields the *selected* graph's model (select/load
  the named graph on the session, then `ModelView`), with a concrete fallback if
  only the session's developed graph is reachable (v1 may target the developed
  graph and treat multi-graph selection as the first plan task to validate).

### Projection (Repository → read-only BoardDocument)

New renderer service `GraphBoardProjector` (a class; methods, not free
functions):

- Input: a `Repository` (from `ModelView`).
- For **every** node (`model.allNodes()`): a `NodeViewModel` subclass
  (`GraphNodeVM extends NodeViewModel`) with `Id = node.id` and a label derived
  from `localId ?? id`; a small secondary caption from `metaKind`/`type` for
  legibility. `doc.Nodes.Add(vm)`.
- For **every** edge: `doc.CreateConnector(new ConnectorEndpoint({ Node: src }),
  new ConnectorEndpoint({ Node: dst }))`, label = edge `kind` (or `via`).
- No filtering — raw full graph (honours the owner's choice).

### Read-only board document + template

- New `GraphViewerDocument` (either a thin `BoardDocument` subclass or a
  `BoardDocument` instance presented via a dedicated template) implementing
  `IDocument`. It is **not** file-backed (no `BoardStorage`), so `Save()`/`Load()`
  no-op and it never persists.
- A dedicated `DataTemplate [DataType = GraphViewerDocument]` renders a `Board`
  with editing affordances **off**: `SelectionResizeEnabled=false`,
  `ConnectorInteractionsEnabled=false`, no `Mutator`, no `DropReceiver`, no
  `ContextMenuService.ContextMenu`, `CameraEnabled=true`. It declares **no**
  `BoardEditingContext`, so no align/text/connector toolbar appears. (Read-only
  is achieved by template + context composition; there is no single flag.)

### Layout

- Precompute positions with fresco's **pure** pipeline (`BuildPipeline` +
  `graphPipeline.Apply` / `layoutPipeline.Apply` as `LayoutPipelineService` wraps
  it) over the projected nodes/edges, then seed geometry via
  `doc.SetNodeVisual(id, { left, top, w, h })` **before** opening — so nodes have
  positions the moment the view mounts and no post-mount mutation/dirty/autosave
  occurs. (Running `LayoutPipelineService.Run()` after mount is rejected: it
  mutates/dirties a doc we want inert.)

### Liveness (chosen on open)

- The viewer offers **Snapshot** (default) and **Live** at open — a toggle in the
  viewer header (so the choice is available without a nagging prompt each time).
- Snapshot: project once; a **Refresh** re-pulls `ModelView` and re-projects.
  No `GraphChanged` subscription held.
- Live: subscribe via `OnGraphChanged`; on change, re-pull `ModelView` and
  re-project (full re-project for v1; incremental diffing is a later concern).
  The subscription is released when the tab closes.

### Scale guard

- Before layout, if projected node count exceeds a threshold (start at **800**,
  a named constant), show a confirm ("This graph has N nodes; rendering may be
  slow. Continue?"). Proceed on confirm; otherwise abort the open.

### Module layout

- New module `apps/plexus/src/renderer/src/modules/graph-viewer/` holding
  `GraphBoardProjector`, `GraphViewerDocument`, `GraphNodeVM`, the open/service
  seam (`GraphViewerService`), the `.mu` template, and `tests/`.
- Selection wiring added in the existing `tenant-explorer` module
  (`TenantExplorerService` / node model / `.resources.mu` TreeView).

## What is left to the builder

- The exact `ModelView`-for-a-named-graph call sequence and its fallback (the
  KEY RISK above) — validated as the first implementation task.
- The precise fresco pure-pipeline invocation for a positionless projected graph
  (mirroring `LayoutPipelineService.computeLayout`, minus the live-board seam).
- Node/edge label formatting details and a default node size.
- The exact read-only template wiring in `.mu` (mirroring the editable board
  template with affordances removed).
- The scale threshold's final value and the confirm UX surface.

## Risks

- **Named-graph targeting** on a singleton Develop session (above) — the main
  feasibility unknown; the plan proves it first.
- **Performance** on large raw graphs — mitigated by the scale guard, but a
  multi-thousand-node layout may still be heavy; acceptable per the owner's
  "render everything" choice with a warning.
- **Session contention** — opening the viewer rebinds the held Develop session;
  if another feature relies on it, there may be interference. The plan notes the
  current single-session ownership and keeps the viewer's use scoped.
