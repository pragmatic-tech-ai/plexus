// Structural view of a todl Entity: enough to walk a scenario's flow. The real
// Entity (@pragmatic-tech-ai/todl) satisfies this (its refs(member) returns Entity[]).
export interface FlowEntity {
  id: string
  refs(member: string): FlowEntity[]
}

// Walk scenario -> sequences -> steps -> (src,dst); return the participant ids
// (union, first-seen order) and the deduped directed step edges. A step missing
// either endpoint is skipped.
export function collectScenarioFlow(scenario: FlowEntity): { participants: string[]; edges: Array<[string, string]> } {
  const participants: string[] = []
  const seenNode = new Set<string>()
  const edges: Array<[string, string]> = []
  const seenEdge = new Set<string>()
  const note = (id: string): void => { if (!seenNode.has(id)) { seenNode.add(id); participants.push(id) } }

  for (const seq of scenario.refs('sequences')) {
    for (const step of seq.refs('steps')) {
      const src = step.refs('src')[0]
      const dst = step.refs('dst')[0]
      if (src === undefined || dst === undefined) continue
      note(src.id); note(dst.id)
      const key = `${src.id}|${dst.id}`
      if (!seenEdge.has(key)) { seenEdge.add(key); edges.push([src.id, dst.id]) }
    }
  }
  return { participants, edges }
}

// The directed step pairs to draw for a set of active scenarios, restricted to
// pairs whose BOTH endpoints are currently placed, deduped across scenarios.
// Used by the diagram binding to project a scenario's steps as connectors (so
// they are model-derived and survive the connector-authoritative rescan).
export function scenarioStepPairs(scenarios: FlowEntity[], placed: ReadonlySet<string>): Array<[string, string]> {
  const seen = new Set<string>()
  const out: Array<[string, string]> = []
  for (const sc of scenarios) {
    for (const [s, d] of collectScenarioFlow(sc).edges) {
      if (!placed.has(s) || !placed.has(d)) continue
      const key = `${s}|${d}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push([s, d])
    }
  }
  return out
}

export interface DropDims { colDx: number; rowDy: number }
export interface PlannedNode { id: string; left: number; top: number; isNew: boolean }

const DEFAULT_DIMS: DropDims = { colDx: 200, rowDy: 120 }

// Placement context that lets a scenario drop target existing location/block
// containers already on the canvas: a participant whose model containment parent
// (`in` / `in_block`) is a placed container gets laid out INSIDE that container
// instead of in the free flow. The factory builds this from the ArchModel + doc;
// when absent (or no participant nests) the layout is the plain L-R flow.
export interface ContainmentLayout {
  // The placed container a participant nests into, or undefined for free flow.
  containerOf(participantId: string): string | undefined
  // Current diagram-space top-left of a placed container (undefined if unplaced).
  containerAt(containerId: string): { left: number; top: number } | undefined
  // How many children already sit in a container — the slot offset new members
  // start from, so a scenario drop stacks below existing landscape content.
  existingChildren(containerId: string): number
}

// Wrapping grid used to place a scenario's components INSIDE a target container.
// The insets clear mural's container title band + padding (ContentOrigin =
// CONTAINER_PADDING across, CONTAINER_TITLE_BAND + CONTAINER_PADDING down) so a
// child's converted local origin lands in the content area; the container
// auto-grows on reparent to bound whatever we place.
const CONTAIN_COLS = 3
const CONTAIN_DX = 96
const CONTAIN_DY = 76
const CONTAIN_INSET_X = 8    // mural CONTAINER_PADDING
const CONTAIN_INSET_TOP = 32 // mural CONTAINER_TITLE_BAND + CONTAINER_PADDING

// The diagram-space top-left for the `slot`-th child inside a container whose
// top-left is `base` — the wrapping grid shared by planScenarioDrop's contained
// participants and the factory's full-membership materialization.
export function containerChildSlot(base: { left: number; top: number }, slot: number): { left: number; top: number } {
  const c = slot % CONTAIN_COLS
  const r = Math.floor(slot / CONTAIN_COLS)
  return { left: base.left + CONTAIN_INSET_X + c * CONTAIN_DX, top: base.top + CONTAIN_INSET_TOP + r * CONTAIN_DY }
}

// Drop the edges that close a cycle (a DFS back-edge), so the layering graph is
// a DAG. Dropped edges are still drawn as connectors — they just don't drive
// columns.
function acyclicEdges(nodes: string[], edges: Array<[string, string]>): Array<[string, string]> {
  const adj = new Map<string, string[]>()
  for (const n of nodes) adj.set(n, [])
  for (const [s, d] of edges) adj.get(s)?.push(d)
  const state = new Map<string, number>()   // 0 unvisited, 1 on-stack, 2 done
  const back = new Set<string>()
  const visit = (u: string): void => {
    state.set(u, 1)
    for (const v of adj.get(u) ?? []) {
      const st = state.get(v) ?? 0
      if (st === 1) back.add(`${u}|${v}`)
      else if (st === 0) visit(v)
    }
    state.set(u, 2)
  }
  for (const n of nodes) if ((state.get(n) ?? 0) === 0) visit(n)
  return edges.filter(([s, d]) => !back.has(`${s}|${d}`))
}

// column(v) = longest path length from any source, over the acyclic graph.
export function layoutColumns(participants: string[], edges: Array<[string, string]>): Map<string, number> {
  const preds = new Map<string, string[]>()
  for (const n of participants) preds.set(n, [])
  for (const [s, d] of acyclicEdges(participants, edges)) preds.get(d)?.push(s)

  const col = new Map<string, number>()
  const compute = (u: string): number => {
    const cached = col.get(u)
    if (cached !== undefined) return cached
    let m = 0
    for (const p of preds.get(u) ?? []) m = Math.max(m, compute(p) + 1)
    col.set(u, m)
    return m
  }
  for (const n of participants) compute(n)
  return col
}

// Compute the drop plan: positions for every participant (grid by column/row,
// from the drop origin) plus the deduped step edges. `isNew` is false for a
// participant already on the canvas (those keep their place; the factory does
// not reposition them).
export function planScenarioDrop(
  scenario: FlowEntity,
  placed: ReadonlySet<string>,
  origin: { x: number; y: number },
  dims: DropDims = DEFAULT_DIMS,
  layout?: ContainmentLayout,
): { nodes: PlannedNode[]; edges: Array<[string, string]> } {
  const { participants, edges } = collectScenarioFlow(scenario)

  // Partition: a participant whose containment parent is a PLACED container is
  // laid out inside that container; everything else flows in the free grid.
  const containerFor = new Map<string, string>()
  if (layout !== undefined)
    for (const id of participants) {
      const cid = layout.containerOf(id)
      if (cid !== undefined && layout.containerAt(cid) !== undefined) containerFor.set(id, cid)
    }

  const nodes: PlannedNode[] = []

  // Contained: wrapping grid inside each container, new members appended after
  // the container's existing children (already-placed participants keep place).
  const nextSlot = new Map<string, number>()
  for (const id of participants) {
    const cid = containerFor.get(id)
    if (cid === undefined) continue
    const base = layout!.containerAt(cid)!
    if (placed.has(id)) { nodes.push({ id, left: base.left, top: base.top, isNew: false }); continue }
    const slot = nextSlot.get(cid) ?? layout!.existingChildren(cid)
    nextSlot.set(cid, slot + 1)
    const pos = containerChildSlot(base, slot)
    nodes.push({ id, left: pos.left, top: pos.top, isNew: true })
  }

  // Free flow: the L-R column algorithm over the participants that did NOT nest,
  // and the edges between them (identical to the pre-container behavior when no
  // participant nests — the whole set flows here).
  const free = participants.filter((id) => !containerFor.has(id))
  const freeEdges = edges.filter(([s, d]) => !containerFor.has(s) && !containerFor.has(d))
  const col = layoutColumns(free, freeEdges)
  const rowOf = new Map<string, number>()
  const nextRow = new Map<number, number>()   // column -> next free row
  for (const id of free) {                     // stable first-seen order
    const c = col.get(id) ?? 0
    const r = nextRow.get(c) ?? 0
    rowOf.set(id, r)
    nextRow.set(c, r + 1)
  }
  for (const id of free)
    nodes.push({
      id,
      left: origin.x + (col.get(id) ?? 0) * dims.colDx,
      top: origin.y + (rowOf.get(id) ?? 0) * dims.rowDy,
      isNew: !placed.has(id),
    })

  return { nodes, edges }
}
