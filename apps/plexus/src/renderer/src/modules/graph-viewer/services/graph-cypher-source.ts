import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { CypherCells } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { IEnvironmentsApi } from '../../../../../shared/environment-contents-api.js'
import type { GraphData, GraphEdgeData, GraphNodeData } from '../graph-data.js'

// A source of graph data for a target, independent of HOW it is read. GraphCypherSource
// is the v1 (live-Cypher) implementation; GraphViewerService resolves this seam, so a
// different backend (a frozen bundle, a snapshot cache) can be registered later under
// GraphSourceKey without touching the open pipeline.
export interface IGraphSource
{
    LoadGraph(target: TargetRef): Promise<GraphData>
}

export const GraphSourceKey = new ServiceKey<IGraphSource>('GraphViewerGraphSource')

// Reads the live graph behind a target environment's inspect relay via Cypher and shapes it into
// a source-agnostic GraphData. `MATCH (n) RETURN n` with NO modelId returns the WHOLE graph; each
// row is a single node cell (`{ $node: CypherNodeCellDto }`) whose `refs` carry its outgoing edges,
// so one query yields nodes AND edges. Paged: follow `nextCursor` until exhausted.
export class GraphCypherSource implements IGraphSource
{
    private static readonly MatchAllNodes = 'MATCH (n) RETURN n';
    private static readonly NodeColumn = 0;

    public constructor(private readonly api: IEnvironmentsApi)
    {
    }

    public async LoadGraph(target: TargetRef): Promise<GraphData>
    {
        const nodes: GraphNodeData[] = [];
        const edges: GraphEdgeData[] = [];
        let cursor: string | undefined;
        do
        {
            const page = await this.api.Cypher(target, GraphCypherSource.MatchAllNodes, undefined, cursor === undefined ? undefined : { cursor });
            for (const row of page.items)
            {
                // Reuse the protocol's canonical node-cell decoder (the `$node` wrapper
                // discrimination) rather than a private copy, so the two cannot drift.
                const cell = CypherCells.AsNode(row[GraphCypherSource.NodeColumn]);
                if (cell === undefined)
                {
                    continue;
                }
                nodes.push({ Id: cell.id, Concept: cell.concept, Label: cell.label, Properties: { ...cell.fields } });
                for (const [type, targets] of Object.entries(cell.refs))
                {
                    for (const to of targets)
                    {
                        edges.push({ From: cell.id, Type: type, To: to });
                    }
                }
            }
            cursor = page.nextCursor;
        }
        while (cursor !== undefined);
        return { Nodes: nodes, Edges: edges };
    }
}
