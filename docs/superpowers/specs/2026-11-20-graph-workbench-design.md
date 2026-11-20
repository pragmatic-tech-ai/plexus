# Graph Workbench — Design

**Status:** approved-pending (brainstormed 2026-11-20; supersedes the v1 read-only graph board viewer)
**Supersedes/evolves:** `2026-11-19-graph-board-viewer-design.md` (the shipped read-only viewer — its Cypher read seam, GraphData projection, fresco layout, and read-only board template are the foundation this builds on).

## Intent & why

Give users a single **visual surface to interact with a deployed graph's data** — not a static dump of the whole graph, but a progressive explorer that starts at the graph's entrypoints and grows as the user (or an agent acting for them) pulls in more. The same surface serves two ends of a spectrum without being two things:

- A **developer** validating a large chunk of structure + attributes reads it as a network of nodes (generic structural rendering carries this).
- A **regular user** mostly *talks* to the graph: the agent answers, produces a subgraph, and offers to put it on the board, where each node is drawn using the rich DataTemplate its own package contributes.

One component, adapting from task to task. No artificial segregation between "dev view" and "user view" — the difference is only which inputs populate the board and whether a node's package ships a template.

The deeper why: a deployed graph is opaque today. People need to *see what's in it*, follow its relationships, and ask questions of it in place — with an agent that can drive the same board they're touching.

## The experience

Clicking a graph (in the Tenant Explorer) opens the workbench: a **board seeded with the graph's entrypoint (root) nodes**, beside a **chat bound to that graph**. From there the user works three interchangeable ways on the *same* board:

1. **Navigate manually** — expand a node to pull in its neighbors, collapse to remove them, select nodes, arrange them.
2. **Query manually** — a query affordance for power users to pull a slice directly.
3. **Ask the chat** — the agent interprets intent, chooses the appropriate query scope itself, runs it, and replies with a **card**: a short summary plus **Add** and **Replace** buttons. Nothing hits the board until the user clicks one — the card is the staging area. *Add* folds the result into the current working set; *Replace* swaps the board to just the result.

Nodes render with the **class + DataTemplate contributed by the package that defines their concept**, falling back to a generic structural tile (label + concept + attributes) when a package ships none.

## The spine — a graph session / working-set model

One session object per open graph is the center of gravity. It holds:

- the current **nodes + edges on the board** (the working set),
- each node's **expand/collapse state**,
- the **selection**.

Three sources mutate it — manual expand/collapse, manual query, and *accepted* agent results. Two consumers read it — the **board** renders it, and the **chat/agent** uses it (plus the selection) as the context it scopes queries against. Every capability below hangs off this model; it is the first thing built and the contract everything else speaks.

## Goals

- Open a graph seeded with its entrypoint nodes and a graph-bound chat.
- Grow/prune the board by hand: expand neighbors, collapse, select, arrange.
- A manual query path for power users (validation/dev).
- Package-driven rendering: concept → package class + DataTemplate, generic fallback.
- Agent loop: intent → scope → query → card (summary + Add/Replace) → board, user-gated.
- View-only over the data, architected so write-back can be added later without redesign.

## Non-goals (v1)

- Writing back to the graph DB (editing nodes/edges/attributes that persist). Seamed for later, not built.
- Live auto-subscription to graph changes / incremental diffing (manual re-query/refresh only; the env relay exposes no change push to the renderer — carried over from v1).
- Multiple graphs on one board; cross-graph queries.
- Whole-graph rendering with a scale guard (the v1 approach — retired in favor of entrypoint-seeded progressive expansion).

## Anti-goals (failure even if it "works")

- A hairball: dumping so many nodes at once that nothing is readable. Expansion is deliberate and bounded.
- Clobbering the user's hand-built arrangement on every agent action. Agent results are staged in a card and only land on *Add*/*Replace*.
- A node that can't draw itself: there is always a generic fallback; a missing package template degrades, never breaks.

## Constraints

- **View-only over the data in v1**, with explicit seams (a mutation path that is absent, not forbidden) so editing can be added later. Because no write path exists, the board being interactive (drag, arrange, expand, collapse) is safe and expected — the v1 "lock the board" concern is void; the guarantee is "no write path to the graph DB," which the architecture gives for free.
- **Entrypoints are conceptually a TODL annotation on the entity, but that annotation is not exposed per-node over the live Cypher seam yet** (the node cell carries `concept`/`class`/`fields`/`refs`, not annotations; today the annotation is model-scoped). So **v1 seeds from a roots heuristic** — nodes with no incoming edges — and switches to filtering on the entrypoint annotation once the engine surfaces it per-node. See External dependencies.
- **The workbench targets any environment the Tenant Explorer lists** (dev or runtime/deployed), reading over the Cypher seam. Query capability can differ by environment type (e.g. model-scoped queries may be unavailable on runtime environments); the workbench uses only whole-graph/adjacency/property queries that work across both, and degrades gracefully (clear message, not a crash) where a needed query is unsupported.
- **Rendering resolves per concept** through the presentation registry from locally-available packages, generic fallback otherwise.
- Reuse the shipped foundation: the environments **Cypher read seam**, `GraphData` projection, `GraphBoardProjector`, `GraphLayout` (fresco pure pipeline), and the read-only board template.
- Workspace conventions: OOP (no free functions / module-level mutable state), Allman braces, no inline/reused string literals (`.mu` labels excepted), VMs extend `Observable` (board content nodes excepted — `NodeViewModel`), engine never calls up, tests in `tests/` subfolders.

## Approaches considered

- **A — Evolve the shipped viewer, board-first then agent (CHOSEN).** Reshape the v1 `GraphViewerDocument`/Cypher/projector/layout into the interactive explorer (entrypoint seed, expand/collapse, selection, incremental layout, package rendering) around the session model; then add the graph-bound chat + agent→card→board loop as a second slice on the now-stable session. Keeps the single-component promise, reuses everything in `main`, and sequences the hard agent loop onto proven ground. Front-loads the one real unknown (package-template resolution for deployed graphs), which the first slice proves.
- **B — Dedicated workbench built whole.** New two-pane surface designed around the session model from day one, v1 treated as a spike. Cleaner seams, but more upfront and discards working code. Rejected: the reuse and incremental proof of A outweigh the cleanliness.
- **C — Two independent projects, rendering-first.** Ship package rendering + expand/collapse separately, then the agent loop. Rejected as a *framing*; its good idea (prove rendering first) is absorbed into A's first slice.

## The decided how

- **Session model** (above) is the spine; build and test it first, headless, against fakes.
- **Entrypoint seeding:** v1 populates the initial working set from a **roots heuristic** (nodes with no incoming edges), read via the Cypher seam. When the engine exposes the entrypoint annotation per-node (external dependency below), the seed query switches to filtering on it — the session model and board don't change, only the seed query behind them.
- **Expand/collapse:** expanding a node runs an adjacency query (its edges + neighbor nodes) and adds them to the session; collapsing removes the nodes it brought in (that nothing else still anchors). High-degree nodes expand by relationship type to avoid a hairball. Layout re-runs over the working set on change, preserving hand-dragged positions where feasible and anchoring around the expanded node.
- **Package-driven rendering:** each node's concept resolves to its package's view class + DataTemplate through the presentation registry; a generic structural tile (label, concept, attributes) is the fallback. **Open build question:** how presentation reaches the client for a *deployed/remote* graph — packages installed locally vs. presentation carried down. This is the first slice's headline risk (see Review Focus).
- **Manual query:** a query affordance (power-user) that runs against the graph and merges its result into the working set, same as an accepted agent result.
- **Agent loop (second slice):** the chat is bound to the open graph; the agent receives the working set + selection as context, identifies scope from intent, runs a graph query via a dedicated agent capability, and returns a **card** (summary + Add/Replace). Accepting applies the subgraph to the session (add/replace); the card persists in chat history.
  - *Binding decision (builder call made during review):* reuse the existing agent-chat transcript + accept-a-card mechanism (the same shape as the shipped `propose_model_patch` → card-in-transcript → Accept flow), rather than invent a new chat UI. The new plumbing slice 2 adds is: a **graph-bound conversation carrying the target `TargetRef`**, a **main-side graph-query MCP tool** that receives that target (so the query runs where the relay/session lives, as v1's Cypher seam does), and **working-set + selection context injection** into the turn (the per-session context-store pattern the agent already uses). This is a reuse-plus-binding, not a new agent.
- **View-only now, write later:** all mutation of the session is view-state only; the data layer is read. A future write path attaches at the session boundary without reshaping it.

## Build order (each slice is working software)

1. **Session core + entrypoint-seeded board + expand/collapse + package rendering + manual query + selection.** Proves the rendering unknown; delivers a usable manual explorer.
2. **Graph-bound chat + agent intent→scope→query→card(Add/Replace)→board loop.** The headline user experience, on the stable session API.

Each slice gets its own implementation plan.

## External dependencies (coordination, not built here)

- **Engine: expose the entrypoint annotation per-node over Cypher.** Entity-level `entrypoint` annotations don't reach the live graph's node cells today. Surfacing them (as a field, concept/class marker, or a dedicated query) is TODL/engine work in another agent's lane — coordinate it as status, don't build it here. Until it lands, v1 uses the roots heuristic; the switch-over is a one-line query change behind the unchanged session model.

## Left to the builder

- Incremental-layout polish (stability of existing positions, animation) beyond "re-layout the working set."
- Exact query shapes for adjacency/entrypoint (Cypher) and the agent's graph-query capability signature.
- Card visual + chat-binding integration specifics against the existing agent-chat infrastructure.
- The presentation-resolution mechanism for deployed graphs (pending the open question above).
