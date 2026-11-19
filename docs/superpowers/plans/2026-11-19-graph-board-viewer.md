# Graph Board Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a graph node in the Tenant Explorer opens a read-only Board that renders the selected environment graph's full raw TODL model (every node and edge), sourced from a Develop-session `ModelView`, auto-laid-out via fresco, with a snapshot/live choice on open and a scale guard.

**Architecture:** A new renderer module `modules/graph-viewer/` built over the existing Board framework and a new renderer Cypher-read passthrough over the environment relay. The deployed graph is a live graph database (`@pragmatic-tech-ai/graph`); a `GraphCypherSource` reads it via `CypherQuery('MATCH (n) RETURN n', …)` (paged, no `modelId` = whole graph) and parses the `NodeCellDto`s (each carrying `links`, so one query yields nodes AND edges) into a plain `GraphData { nodes, edges }`; a `GraphBoardProjector` maps `GraphData` → `GraphNodeVM`s + `Connector`s on an in-memory read-only `GraphViewerDocument`; a `GraphLayout` seeds positions from fresco's pure pipeline via `SetNodeVisual`; a `GraphViewerService` orchestrates open (fetch → project → layout → open tab), the snapshot/live toggle, and the scale guard. Selection wiring is added to the existing `tenant-explorer` module. The frozen contributed packages are the bundle, NOT the live contents — not read here.

**Tech Stack:** TypeScript (ESM, strict), mural Board framework + `.mu` markup (`compile:mu`), fresco layout engine, the environment relay Cypher API (`CypherQuery` → `CypherQueryPageDto`; `NodeCellDto` from `@pragmatic-tech-ai/graph`), a new `window.api.environments`-side Cypher passthrough, vitest.

**Spec:** `docs/superpowers/specs/2026-11-19-graph-board-viewer-design.md`

## Global Constraints

- **Read-only.** The board never mutates the graph: no `Mutator` bound, no drop/context-menu/editing toolbar, no `BoardEditingContext`; `SelectionResizeEnabled=false`, `ConnectorInteractionsEnabled=false`, `CameraEnabled=true`. The document is in-memory (no `BoardStorage`); `Save()` no-ops.
- **Raw full graph.** Project EVERY node and EVERY edge from the `Repository` — no filtering of prelude/system/meta/ontology.
- **House rules:** OOP (methods on classes; no free functions / module-global mutable state; module `const` for true constants ok); Allman braces; no inline string literals in `.ts` (hoist to `private static readonly` PascalCase); `.mu` labels stay inline. PascalCase interfaces/public methods. New VMs extend `Observable` — EXCEPT a board content node, which must extend `NodeViewModel` (the type the board generator/serializer expect).
- **Engine never calls up.** This is pure renderer/UX over the dev-session + board framework; no engine change.
- **Tests live in `tests/` subfolders.**
- **Generated files** (`*.mu.js`) are regenerated via `compile:mu`, never hand-edited.
- **Merge locally; never push without explicit instruction.**
- Default node size when unmeasured: `{ w: 160, h: 48 }` (named constant). Scale-guard threshold: `800` nodes (named constant).

## Review Focus

Inputs the design implies but no single task's happy-path test exercises — each gets a test in the owning task:
- **An empty graph** (0 nodes) opens without error and shows an empty board. → Task 2 test.
- **A dangling edge** (edge whose `from`/`to` node is absent from `allNodes()`) is skipped, not crashed on. → Task 2 test (connector only created when both endpoints projected).
- **A duplicate/self edge** (node → itself, or two edges same pair) each project to a distinct connector without throwing. → Task 2 test.
- **A graph over the scale threshold** triggers the confirm and aborts cleanly when declined (no tab, session released). → Task 5 test.
- **Closing a Live tab** releases the `GraphChanged` subscription (no leak, no re-project after close). → Task 7 test.

---

## Task 1: Cypher read seam + GraphCypherSource — live graph → GraphData

**Files:**
- Create: `apps/plexus/src/renderer/src/modules/graph-viewer/services/graph-cypher-source.ts`, `apps/plexus/src/renderer/src/modules/graph-viewer/graph-data.ts` (the `GraphData`/`GraphNodeData`/`GraphEdgeData` types).
- Modify (renderer Cypher-read passthrough): `apps/plexus/src/main/environments/*` (a `Cypher` handler on the env Inspect relay calling `client.CypherQuery`), `apps/plexus/src/preload/index.ts` (`environments.Cypher`), `packages/plexus-core/src/shared/environment-contents-api.ts` (the `Cypher` method on `IEnvironmentsBridge`/`EnvironmentsApiKey`).
- Test: `.../services/tests/graph-cypher-source.test.ts`

**Interfaces — Produces:**
- `interface GraphNodeData { Id: string; Concept: string | null; Label: string; Properties: Record<string, unknown> }`, `interface GraphEdgeData { From: string; Type: string; To: string }`, `interface GraphData { Nodes: GraphNodeData[]; Edges: GraphEdgeData[] }`.
- `class GraphCypherSource` with `public async LoadGraph(target: TargetRef): Promise<GraphData>` — runs `MATCH (n) RETURN n` paged over the env relay Cypher seam (no `modelId`), maps each `NodeCellDto { id, concept, properties, links: { [rel]: string[] } }` → a `GraphNodeData` and its `links` → `GraphEdgeData`s.
- The env bridge gains `Cypher(target: TargetRef, cypher: string, params?, page?): Promise<CypherQueryPageDto>`.

**Verify first (ledger ruling already recorded):** confirm a bare `MATCH (n) RETURN n` returns each node's `links` (so edges come for free). If not, add a `MATCH (a)-[r]->(b) RETURN …` relationships query inside `LoadGraph` and record the fallback.

- [ ] **Step 1 (RED):** Test with a fake env-Cypher seam returning two paged `CypherQueryPageDto`s whose rows are `NodeCellDto`s (2 nodes, one with a `links` entry to the other). Assert `LoadGraph(target)` returns `GraphData` with 2 `Nodes` (Ids/Concepts/Labels mapped) and 1 `Edge` (`{From, Type, To}`). Run — fails (class absent).
- [ ] **Step 2 (GREEN):** Add the Cypher-read passthrough (main handler → preload → `EnvironmentsApiKey.Cypher`); implement `GraphCypherSource.LoadGraph` paging `MATCH (n) RETURN n` and mapping cells (inject the bridge via constructor/`ServiceKey`, not a global).
- [ ] **Step 3:** Run the test. Expected: PASS. Add an empty-result case (0 rows → empty `GraphData`, no throw) and a multi-page case (paging accumulates).
- [ ] **Step 4:** `typecheck` (node + web for the preload/shared changes). Expected: green.
- [ ] **Step 5:** Commit `feat(graph-viewer): env Cypher read seam + GraphCypherSource -> GraphData`.

## Task 2: GraphNodeVM + GraphBoardProjector — Repository → board nodes/edges

**Files:**
- Create: `apps/plexus/src/renderer/src/modules/graph-viewer/graph-node-vm.ts`, `apps/plexus/src/renderer/src/modules/graph-viewer/services/graph-board-projector.ts`
- Test: `.../services/tests/graph-board-projector.test.ts`

**Interfaces:**
- Consumes: `GraphData` (from Task 1: `Nodes: GraphNodeData[]`, `Edges: GraphEdgeData[]`), a `BoardDocument` (`Nodes.Add`, `CreateConnector(src, dst)` with `ConnectorEndpoint({ Node })`).
- Produces: `class GraphNodeVM extends NodeViewModel` (`Id`, a `Label` from the node's `Label`, a `Caption` from `Concept`); `class GraphBoardProjector` with `public Project(data: GraphData, doc: BoardDocument): void`.

- [ ] **Step 1 (RED):** Test: a tiny `GraphData` (2 nodes + 1 edge between them) → `Project` adds 2 `GraphNodeVM`s (Ids match, `doc.Nodes.Count === 2`) and 1 connector (`doc.Connectors.Count === 1`). Run — fails.
- [ ] **Step 2 (GREEN):** Implement `GraphNodeVM` and `GraphBoardProjector.Project`: one VM per `data.Nodes` with `Id = node.Id`; build an id→VM map; for each edge, create a connector ONLY when both endpoints are in the map (skip dangling). Label connectors with edge `Type`.
- [ ] **Step 3:** Run. Expected: PASS.
- [ ] **Step 4 (Review Focus):** Add tests — empty graph (0 nodes → 0 nodes/0 connectors, no throw); dangling edge (skipped); self-edge and duplicate pair (each a distinct connector, no throw). Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(graph-viewer): project a Repository onto a BoardDocument`.

## Task 3: GraphLayout — seed positions from fresco's pure pipeline

**Files:**
- Create: `apps/plexus/src/renderer/src/modules/graph-viewer/services/graph-layout.ts`
- Test: `.../services/tests/graph-layout.test.ts`

**Interfaces:**
- Consumes: the projected `BoardDocument` (`Nodes`, `Connectors`), `doc.SetNodeVisual(id, { left, top, w, h })`; fresco's pure pipeline as used by `modules/board/layout/layout-pipeline-service.ts` `computeLayout` and `board-graph-adapter.ts` (`BuildPipeline`, `graphPipeline.Apply`, `layoutPipeline.Apply`), minus the live-board seam.
- Produces: `class GraphLayout` with `public Apply(doc: BoardDocument): void` — computes a position per node and seeds it via `SetNodeVisual` (default size the `{160,48}` constant).

- [ ] **Step 1 (RED):** Test: a projected doc of 3 nodes + 2 edges → after `Apply`, every node Id has a `GetNodeVisual` with finite numeric `left`/`top` and the default `w`/`h`. Run — fails.
- [ ] **Step 2:** Read `layout-pipeline-service.ts` `computeLayout`/`applyPositions` and `board-graph-adapter.ts` `extract`/`computeOutcome`; mirror the PURE path (no `ActiveView`, no realized figures) to produce an id→position map.
- [ ] **Step 3 (GREEN):** Implement `GraphLayout.Apply` seeding `SetNodeVisual` for every node. Do not mark the doc dirty / autosave (in-memory doc has no storage, so this is already inert — assert `doc.IsDirty` handling is acceptable for a viewer).
- [ ] **Step 4:** Run. Expected: PASS. Add a 1-node and a 0-node case (no throw).
- [ ] **Step 5:** Commit `feat(graph-viewer): fresco auto-layout seeds node positions`.

## Task 4: GraphViewerDocument + read-only board template

**Files:**
- Create: `apps/plexus/src/renderer/src/modules/graph-viewer/graph-viewer-document.ts`, `apps/plexus/src/renderer/src/modules/graph-viewer/graph-viewer.resources.mu`
- Test: `.../tests/graph-viewer-document.test.ts`

**Interfaces — Produces:** `class GraphViewerDocument extends BoardDocument` — in-memory (constructed with no/throwaway `BoardStorage`), `implements IDocument`; a settable `Title`; `Save()` no-ops. A `DataTemplate [DataType = GraphViewerDocument]` in `.mu` rendering a `Board` with `ItemsSource=$Nodes`, `Connectors=$Connectors`, `SelectionResizeEnabled=false`, `ConnectorInteractionsEnabled=false`, `AlignmentGuidesEnabled=false`, `RulersVisible=false`, `CameraEnabled=true`, no `Mutator`, no `DropReceiver`, no `ContextMenuService.ContextMenu`.

- [ ] **Step 1 (RED):** Test: `new GraphViewerDocument()` is an `IDocument` (has `Id`, `Title`, `IsDirty`, `Save`); `Save()` returns without throwing and persists nothing; `Title` is settable. Run — fails.
- [ ] **Step 2 (GREEN):** Implement `GraphViewerDocument` (subclass; pass no storage so base `Save`/`Load` no-op). Author the read-only `.mu` template mirroring `modules/board/board.resources.mu:110-136` with the editing affordances removed.
- [ ] **Step 3:** `compile:mu`; `typecheck:web`; run the test. Expected: PASS + green typecheck.
- [ ] **Step 4:** Commit `feat(graph-viewer): read-only GraphViewerDocument + board template`.

## Task 5: GraphViewerService — orchestrate open + scale guard + module registration

**Files:**
- Create: `apps/plexus/src/renderer/src/modules/graph-viewer/services/graph-viewer-service.ts`, `apps/plexus/src/renderer/src/modules/graph-viewer/graph-viewer.module.mu`
- Modify: wire the module into the app (`apps/plexus/src/renderer/src/main.js` or the module aggregation point — mirror how `tenant-explorer` / `board` modules are registered).
- Test: `.../services/tests/graph-viewer-service.test.ts`

**Interfaces:**
- Consumes: `GraphCypherSource`, `GraphBoardProjector`, `GraphLayout`, `ContentHostService` (cast to `DocumentsContentHostService`, `Open(doc)`), a confirm seam (`DialogService` or equivalent).
- Produces: `class GraphViewerService` with `public async OpenGraph(target: TargetRef, graphName: string, mode: GraphViewMode): Promise<void>` where `enum GraphViewMode { Snapshot, Live }`. Pipeline: `LoadGraph(target)` → scale guard (confirm when `data.Nodes.length > 800`) → `Project` → `GraphLayout.Apply` → build `GraphViewerDocument` (`Title = graphName`) → `host.Open(doc)`.

- [ ] **Step 1 (RED):** Test with fakes (cypher source returning a small `GraphData`, a fake content host capturing `Open`): `OpenGraph(target, 'g', Snapshot)` opens exactly one `GraphViewerDocument` titled `'g'` with projected nodes. Run — fails.
- [ ] **Step 2 (GREEN):** Implement `GraphViewerService.OpenGraph` (Snapshot path) wiring the pipeline via injected collaborators (ServiceKeys, no globals).
- [ ] **Step 3 (Review Focus):** Test the scale guard: a `GraphData` with > 800 nodes and a fake confirm that DECLINES → no document opened; a fake confirm that ACCEPTS → opens. Run. Expected: PASS.
- [ ] **Step 4:** Author `graph-viewer.module.mu` registering the services; wire the module into the app alongside the other renderer modules. `compile:mu`; `typecheck`.
- [ ] **Step 5:** Commit `feat(graph-viewer): GraphViewerService open pipeline + scale guard + module`.

## Task 6: Tenant Explorer selection wiring

**Files:**
- Modify: `apps/plexus/src/renderer/src/modules/tenant-explorer/services/tenant-explorer-node.ts` (Graph node carries `TargetRef` + graph name), `.../services/tenant-explorer-service.ts` (pass `target` into `TenantExplorerNode.Graph`; expose an activation that calls `GraphViewerService.OpenGraph`), `.../tenant-explorer.resources.mu` (TreeView `SelectedItem`/activation → command).
- Test: `.../services/tests/tenant-explorer-graph-activation.test.ts`

**Interfaces:**
- Consumes: `GraphViewerService.OpenGraph`.
- Produces: `TenantExplorerNode.Graph(name, target)` now stores identity; an activation command on the service that, for a `Graph` node, invokes `OpenGraph(node.Target, node.Name, mode)`.

- [ ] **Step 1 (RED):** Test: activating a `Graph` node calls a fake `GraphViewerService.OpenGraph` with the node's `TargetRef` and name. Run — fails (no identity / no wiring).
- [ ] **Step 2 (GREEN):** Thread `target` from `LoadContents` into `TenantExplorerNode.Graph`; add the activation path (command/`SelectedItem` handler) on the service; wire the TreeView in `.mu` (add `SelectedItem`/double-click/activation — none exists today).
- [ ] **Step 3:** `compile:mu`; `typecheck`; run the test. Expected: PASS. Decide the snapshot/live choice surface (default Snapshot) — a header toggle on the viewer (Task 7) OR a quick pick on activate; record the ruling.
- [ ] **Step 4:** Commit `feat(tenant-explorer): activate a graph node to open the Board viewer`.

## Task 7: Live mode — subscribe, refresh, release on close

**Files:**
- Modify: `graph-viewer-service.ts` (Live path), `graph-viewer-document.ts` (hold/release the subscription + a `Refresh` the view can invoke), `graph-viewer.resources.mu` (header: a Live toggle + Refresh affordance).
- Test: `.../services/tests/graph-viewer-live.test.ts`

**Interfaces:**
- Consumes: `GraphCypherSource.LoadGraph` (re-pull), the content host `Close`/`OpenDocuments` to detect close, and the env relay's graph-change subscription IF one is exposed to the renderer (`environments.OnGraphChanged` or similar).
- Produces: `Refresh()` on `GraphViewerDocument` (re-`LoadGraph` + re-`Project` + re-`GraphLayout`) for both modes; Live mode subscribes to the env change signal and calls `Refresh` on change; a disposer invoked when the tab closes.

**Ruling to make in Step 1:** check whether the env Inspect relay exposes a graph-change push to the renderer. If NOT, Live degrades to manual `Refresh` only (record the ruling); do not reach into the Develop-session `OnGraphChanged` (wrong plane).

- [ ] **Step 1 (RED):** Test with a fake change emitter: opening in Live mode and firing a change calls `LoadGraph`/re-projects again; closing the tab unsubscribes and a subsequent change does NOT re-project. (If no env push exists, test `Refresh()` re-pulls + re-projects and record the degrade ruling.) Run — fails.
- [ ] **Step 2 (GREEN):** Implement `Refresh` (both modes) + the subscription/dispose-on-close (or Refresh-only per the ruling).
- [ ] **Step 3:** Run. Expected: PASS. `compile:mu`; `typecheck` for the `.mu` header changes.
- [ ] **Step 4:** Commit `feat(graph-viewer): live auto-refresh + refresh action + release on close`.
