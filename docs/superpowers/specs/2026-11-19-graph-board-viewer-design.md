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
- The view renders the environment's **live graph** read via **Cypher over the
  environment relay** (`CypherQuery('MATCH (n) RETURN n', …)`, paged) — the real
  graph database (`@pragmatic-tech-ai/graph` GraphEngine), not the frozen package
  bundle. v1 reads the environment's currently-loaded graph ("just cypher for
  now"); loading an arbitrary promoted graph on demand is a later concern.
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

1. **Cypher the live graph DB + reuse the Board framework — CHOSEN.**
   The deployed graph is now a real graph database (`@pragmatic-tech-ai/graph`
   GraphEngine). Read it via `CypherQuery` over the environment relay
   (`MATCH (n) RETURN n`, paged; a node cell carries its outgoing `links`, so one
   query yields nodes AND edges — no `modelId`, which only narrows to one
   model/package within the graph). Project every node→`NodeViewModel` and every
   edge→`Connector` onto an in-memory read-only `BoardDocument`, auto-layout via
   fresco, open as a tab. Reads the actual live contents; reuses all board
   machinery. Cost: needs a small renderer Cypher-read passthrough over the relay.
2. **ModelView via a Develop session — rejected (wrong plane).** `ModelView` is a
   solution-authoring view keyed by a member of the active solution; a deployed
   graph is not a solution, so this does not address it.
3. **Merge the frozen contributed-package `modelJson` — rejected (bundle, not
   live).** Since the graph became a live DB, the packages are only the bundling
   snapshot; merging them would render the bundle, not what the live graph holds.
4. **Build a bespoke graph canvas from scratch — rejected.** The Board already
   renders node/connector models and auto-lays-out positionless nodes; building a
   second surface duplicates all of that.

## The design

### Data path (renderer → live graph via Cypher)

- Thread identity: `TenantExplorerService.LoadContents(target)` already has the
  environment `TargetRef`. Give `TenantExplorerNode.Graph` the `TargetRef` and
  the graph **name** (today it keeps only a label). Add selection/activation
  wiring to the Tenant Explorer `TreeView` (none exists): a `SelectedItem` +
  activation command that, for a `Graph` node, invokes the viewer open.
- New **renderer Cypher-read passthrough** over the environment relay (today only
  main touches Cypher): a thin main handler → preload bridge → renderer source
  exposing `Cypher(target, cypher, params?, page?) → CypherQueryPageDto` on the
  env Inspect relay (`client.CypherQuery`).
- Read the whole graph: `GraphCypherSource.LoadGraph(target)` runs
  `MATCH (n) RETURN n` **paged** (QueryAll-style) with **no `modelId`** (whole
  graph). Each row is a `NodeCellDto { id, concept, properties, links: {
  [relationship]: string[] } }`; map each node → a node, and each
  `links[rel] = [toId…]` entry → an edge `{ from: node.id, type: rel, to: toId }`.
  Produces a plain `GraphData { nodes, edges }` (decoupled from the board).
- **Scope (v1 ruling):** reads the environment's currently-loaded live graph.
  Loading an arbitrary promoted graph on demand is deferred ("just cypher for
  now"). If `links` are not populated for a bare `MATCH (n)`, fall back to a
  second `MATCH (a)-[r]->(b) RETURN …` relationships query.

### Projection (GraphData → read-only BoardDocument)

New renderer service `GraphBoardProjector` (a class; methods, not free
functions):

- Input: a plain `GraphData { nodes: GraphNodeData[], edges: GraphEdgeData[] }`
  (from `GraphCypherSource`), decoupled from both the board and the DB cell shape.
- For **every** node: a `NodeViewModel` subclass (`GraphNodeVM extends
  NodeViewModel`) with `Id = node.id`, a label from the node's key property
  (`properties.name`/`properties.label` ?? `id`), and a caption from `concept`.
  `doc.Nodes.Add(vm)`.
- For **every** edge: `doc.CreateConnector(new ConnectorEndpoint({ Node: src }),
  new ConnectorEndpoint({ Node: dst }))`, label = edge `type` — created only when
  both endpoints exist in the node set (skip dangling).
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

- **Loaded-graph scope (v1)** — the viewer reads the environment's currently
  loaded live graph. If an env holds several promoted graphs and the clicked one
  is not the loaded one, v1 shows the loaded graph; per-name load-on-demand is a
  deferred follow-up ("just cypher for now").
- **Cypher node-cell `links`** — the plan assumes a bare `MATCH (n) RETURN n`
  returns each node's outgoing `links` (so one query yields edges too); Task 1
  verifies this and falls back to a separate relationships query if not.
- **Performance** on large raw graphs — mitigated by the scale guard, but a
  multi-thousand-node layout may still be heavy; acceptable per the owner's
  "render everything" choice with a warning. Cypher paging bounds the fetch.
