import type { BoardDocument, Connector } from '@pragmatic-tech-ai/mural/framework'
import { BuildPipeline, LoadElementRepository, type PipelineConfiguration } from '@pragmatic-tech-ai/fresco'
import {
    extract,
    computeOutcome,
    type FigureLike,
    type ConnectorLike,
    type NodeSize,
    type PositionSet,
} from '../../board/layout/board-graph-adapter.js'

// GraphLayout — computes a position per node of a projected graph BoardDocument and
// seeds it via SetNodeVisual, using fresco's PURE layout pipeline: the same
// extract / BuildPipeline / computeOutcome path LayoutPipelineService runs on the
// live board, minus the ActiveView / realized-figure seam. The viewer's content VMs
// carry no geometry, so every node gets a uniform footprint; any node the pipeline
// leaves unplaced (or every node, if the pipeline errors) falls back to a visible
// row, so the read-only viewer never stacks nodes at the origin or loses one.
export class GraphLayout
{
    // Uniform node footprint. Content VMs carry no geometry, so one size serves
    // every node — fed to computeOutcome (center -> top-left shift) AND written as
    // each visual's w/h, kept equal so the shift matches the rendered box.
    private static readonly NodeWidth = 160
    private static readonly NodeHeight = 48
    private static readonly DefaultSize: NodeSize = { width: GraphLayout.NodeWidth, height: GraphLayout.NodeHeight }

    // MakeAcyclic runs first so a cyclic graph is broken into a DAG before the
    // longest-path layer assigner (which refuses cyclic input) sees it — mirrors
    // LayoutPipelineService's DEFAULT_CONFIG.
    private static readonly MakeAcyclicTransform = 'MakeAcyclicTransform'
    private static readonly DefaultConfig: PipelineConfiguration =
        { name: 'default', transforms: [GraphLayout.MakeAcyclicTransform], layout: {} }

    // Horizontal pitch of the fallback row for nodes the pipeline left unplaced
    // (disconnected, dropped, or an errored run), so each stays visible and distinct.
    private static readonly FallbackPitch = 200

    public Apply(doc: BoardDocument): void
    {
        const vms = doc.Nodes.ToArray()
        if (vms.length === 0)
        {
            return
        }

        // Pure FigureLike adapters keyed by their source VM, plus ConnectorLike
        // adapters pointing at the SAME adapters, so extract resolves edges by the
        // identity it was handed rather than by the live VM objects.
        const figByVm = new Map<object, FigureLike>()
        const figures: FigureLike[] = []
        for (const vm of vms)
        {
            const fig: FigureLike = { Id: (vm as { Id?: string }).Id, Left: 0, Top: 0 }
            figures.push(fig)
            figByVm.set(vm as object, fig)
        }

        const connectors: ConnectorLike[] = []
        for (const c of doc.Connectors.ToArray())
        {
            const source = (c as Connector).Source?.Node
            const target = (c as Connector).Target?.Node
            if (source === undefined || target === undefined)
            {
                continue
            }
            const from = figByVm.get(source as object)
            const to = figByVm.get(target as object)
            if (from === undefined || to === undefined)
            {
                continue
            }
            connectors.push({ Source: { Node: from }, Target: { Node: to } })
        }

        this.seed(doc, figures, this.computePositions(figures, connectors))
    }

    // Run the pure pipeline and return an id -> PositionSet map. On a pipeline error
    // the map is left empty and seed() lays every node out on the fallback row — a
    // viewer must still render.
    private computePositions(figures: FigureLike[], connectors: ConnectorLike[]): Map<string, PositionSet>
    {
        const out = new Map<string, PositionSet>()
        const { graph, index } = extract(figures, connectors)
        try
        {
            const { graphPipeline, layoutPipeline } = BuildPipeline(GraphLayout.DefaultConfig, LoadElementRepository())
            const transformed = graphPipeline.Apply(graph)
            const result = layoutPipeline.Apply(transformed)
            const outcome = computeOutcome(index, transformed, result.positions, () => GraphLayout.DefaultSize)
            for (const p of outcome.setPositions)
            {
                out.set(p.id, p)
            }
        }
        catch
        {
            // Swallowed deliberately: an unlayoutable graph still opens, every node
            // on the fallback row.
        }
        return out
    }

    // Seed a NodeVisual for every identified node: its computed position when the
    // pipeline placed it, else the next fallback slot so nothing is lost or stacked.
    private seed(doc: BoardDocument, figures: FigureLike[], positioned: Map<string, PositionSet>): void
    {
        let fallbackColumn = 0
        for (const fig of figures)
        {
            const id = fig.Id
            if (id === undefined || id === '')
            {
                continue
            }
            const placed = positioned.get(id)
            if (placed === undefined)
            {
                doc.SetNodeVisual(id, { left: fallbackColumn * GraphLayout.FallbackPitch, top: 0, w: GraphLayout.NodeWidth, h: GraphLayout.NodeHeight })
                fallbackColumn++
            }
            else
            {
                doc.SetNodeVisual(id, { left: placed.left, top: placed.top, w: GraphLayout.NodeWidth, h: GraphLayout.NodeHeight })
            }
        }
    }
}
