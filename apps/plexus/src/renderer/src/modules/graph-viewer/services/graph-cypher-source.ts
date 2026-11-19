import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { CypherCellDto, CypherNodeCell, CypherNodeCellDto } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { IEnvironmentsApi } from '../../../../../shared/environment-contents-api.js'
import type { GraphData, GraphEdgeData, GraphNodeData } from '../graph-data.js'

// Reads the live graph behind a target environment's inspect relay via Cypher and shapes it into
// a source-agnostic GraphData. `MATCH (n) RETURN n` with NO modelId returns the WHOLE graph; each
// row is a single node cell (`{ $node: CypherNodeCellDto }`) whose `refs` carry its outgoing edges,
// so one query yields nodes AND edges. Paged: follow `nextCursor` until exhausted.
export class GraphCypherSource
{
    private static readonly MatchAllNodes = 'MATCH (n) RETURN n';
    private static readonly NodeKey = '$node';
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
                const cell = GraphCypherSource.NodeOf(row[GraphCypherSource.NodeColumn]);
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

    // A row cell is a node only when it is the reserved `{ $node: … }` wrapper; everything else
    // (scalars, arrays, plain maps) is not a node and is skipped.
    private static NodeOf(cell: CypherCellDto | undefined): CypherNodeCellDto | undefined
    {
        if (typeof cell !== 'object' || cell === null || Array.isArray(cell))
        {
            return undefined;
        }
        if (!(GraphCypherSource.NodeKey in cell))
        {
            return undefined;
        }
        return (cell as CypherNodeCell).$node;
    }
}
