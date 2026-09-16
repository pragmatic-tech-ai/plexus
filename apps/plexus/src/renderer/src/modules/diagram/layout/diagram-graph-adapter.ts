import { Graph } from '@pragmatic-tech-ai/fresco'

// A layout position from Fresco. Fresco's Point (X/Y) satisfies this;
// declared locally so the adapter's tests don't need mural's Point.
export interface PointLike { X: number; Y: number }

// Diagram <-> Fresco Graph adapter.
//
// Pure logic, deliberately decoupled from the mural framework: it works
// against small structural interfaces that the real mural Figure and
// Connector satisfy (Figure has Id/Left/Top; Connector has Source/Target
// with a .Node reference). This keeps the risk surface — identity
// mapping, coordinate conversion, drop diffing — unit-testable without
// the Electron/mural runtime.

// A diagram node, as far as layout cares. mural's Figure satisfies this.
export interface FigureLike
{
    Id:   string | undefined
    Left: number
    Top:  number
}

// One end of a connector. mural's ConnectorEndpoint satisfies this:
// .Node points at the endpoint figure, and PortSide is a settable
// cardinal ('N'|'S'|'E'|'W') that drives the diagram's own port
// assignment. Typed as a bare string here (not mural's PortSide enum)
// to keep the adapter runtime-decoupled and unit-testable — the enum's
// values are those very strings, so the assignment is value-identical.
export interface EndpointLike
{
    Node?:     unknown
    PortSide?: string
}

// A diagram connector. mural's Connector satisfies this (Source/Target
// are ConnectorEndpoint, whose .Node points at the endpoint figure).
export interface ConnectorLike
{
    Source?: EndpointLike
    Target?: EndpointLike
}

// A connector paired with the node ids its ends resolved to. Emitted by
// extract so a later side/port pass can address the real connector
// objects without re-deriving identity.
export interface ConnectorEdge
{
    connector: ConnectorLike
    from:      string
    to:        string
}

export interface ExtractResult
{
    graph: Graph
    index: Map<string, FigureLike>
    connectorEdges: ConnectorEdge[]
}

// Builds a Fresco Graph from the diagram's figures and connectors.
// Figures missing an Id are assigned one (persisted back onto the figure
// so identity is stable across re-runs). `index` maps each id to its
// figure for writing positions back. A connector becomes an edge only
// when both endpoint figures resolve.
export function extract(
    nodes: FigureLike[],
    connectors: ConnectorLike[],
    idGen: (i: number) => string = (i) => `n${i}`,
): ExtractResult
{
    const graph = new Graph()
    const index = new Map<string, FigureLike>()
    const idOf = new Map<object, string>()
    const connectorEdges: ConnectorEdge[] = []

    nodes.forEach((fig, i) => {
        // Use the node's own Id when it has one; otherwise synthesise a
        // GRAPH-LOCAL id for this run only. Never write it back onto the node —
        // mutating fig.Id corrupts the node's identity for everything else
        // (arch-model binding keys off it, serialization persists it), which is
        // how empty-Id arch nodes ended up saved as "n8".."n13". The id lives
        // only in `index` / `idOf` for this extract's lifetime.
        const gid = fig.Id === undefined || fig.Id === '' ? idGen(i) : fig.Id
        index.set(gid, fig)
        idOf.set(fig as object, gid)
        graph.AddNode(gid)
    })

    for (const conn of connectors) {
        const from = conn.Source?.Node ? idOf.get(conn.Source.Node as object) : undefined
        const to   = conn.Target?.Node ? idOf.get(conn.Target.Node as object) : undefined
        if (from !== undefined && to !== undefined) {
            graph.AddEdge(from, to)
            connectorEdges.push({ connector: conn, from, to })
        }
    }

    return { graph, index, connectorEdges }
}

// A cardinal side pair for an edge, keyed by node id. Fresco's EdgeSides
// (with a Side enum) satisfies this — the values are the same 'N'|'S'|
// 'E'|'W' strings the diagram's PortSide expects.
export interface EdgeSideLike { source: string; target: string }

// Writes a cardinal side onto each connector's source/target endpoint,
// engaging the diagram's own port assignment (which places the concrete
// point on the chosen side and fans parallel connectors into slots).
//
// `sidesByPair` is keyed `${from}|${to}`; connectors whose pair is
// absent (e.g. an endpoint dropped by a transform) are left untouched.
// Returns the number of connectors assigned.
export function applySides(
    connectorEdges: ConnectorEdge[],
    sidesByPair: Map<string, EdgeSideLike>,
): number
{
    let assigned = 0
    for (const ce of connectorEdges) {
        const sides = sidesByPair.get(`${ce.from}|${ce.to}`)
        if (sides === undefined) continue
        if (ce.connector.Source) ce.connector.Source.PortSide = sides.source
        if (ce.connector.Target) ce.connector.Target.PortSide = sides.target
        assigned++
    }
    return assigned
}

export interface NodeSize { width: number; height: number }

// A node whose footprint layout needs. The layout pipeline resolves every node
// to its container Figure (see LayoutPipelineService.geometryFigures), which
// exposes the authored Width/Height DPs and, as a Visual, a measured RenderSize.
export interface SizedLike
{
    Width?:      number
    Height?:     number
    RenderSize?: { Width: number; Height: number }
}

// Resolve a node's layout footprint: prefer the authored Width/Height DPs, fall
// back to a measured RenderSize, then to `fallback`.
export function nodeSize(fig: SizedLike, fallback: NodeSize): NodeSize
{
    if (typeof fig.Width === 'number' && typeof fig.Height === 'number' && fig.Width > 0 && fig.Height > 0) {
        return { width: fig.Width, height: fig.Height }
    }
    const rs = fig.RenderSize
    if (rs && rs.Width > 0 && rs.Height > 0) return { width: rs.Width, height: rs.Height }
    return fallback
}

// A resolved top-left position to write onto a figure.
export interface PositionSet { id: string; left: number; top: number }

// The result of running a layout: where each surviving node should go
// (as top-left corners) and which original nodes the transforms dropped.
export interface LayoutOutcome
{
    setPositions:  PositionSet[]
    droppedNodeIds: string[]
}

// Turns Fresco layout output into a diagram-space outcome.
//
// Fresco positions are node *centers*; mural figures are placed by their
// top-left corner (Left/Top), so each center is shifted by half the
// figure's size. `droppedNodeIds` are ids present before layout (in the
// index) but absent from the transformed graph — i.e. removed by a graph
// transform such as DropIsolatedNodes / FilterNodes.
export function computeOutcome(
    index: Map<string, FigureLike>,
    transformed: Graph,
    positions: Map<string, PointLike>,
    sizeOf: (fig: FigureLike) => NodeSize,
): LayoutOutcome
{
    const surviving = new Set(transformed.nodes.map((n) => n.Id))

    const setPositions: PositionSet[] = []
    for (const [id, pt] of positions) {
        const fig = index.get(id)
        if (!fig) continue
        const { width, height } = sizeOf(fig)
        setPositions.push({ id, left: pt.X - width / 2, top: pt.Y - height / 2 })
    }

    const droppedNodeIds = [...index.keys()].filter((id) => !surviving.has(id))
    return { setPositions, droppedNodeIds }
}
