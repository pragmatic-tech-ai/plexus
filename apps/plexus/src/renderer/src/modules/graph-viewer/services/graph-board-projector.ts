import { ConnectorEndpoint, type BoardDocument } from '@pragmatic-tech-ai/mural/framework'
import type { GraphData } from '../graph-data.js'
import { GraphNodeVM } from '../graph-node-vm.js'

// Projects source-agnostic GraphData onto a BoardDocument: one GraphNodeVM per node, one connector
// per edge. Raw full graph — no filtering. A connector is created only when BOTH endpoints were
// projected (a dangling edge is skipped, not an error). Positions are NOT set here; GraphLayout
// seeds them afterwards. Pure over the document (no side effects beyond Nodes/Connectors).
export class GraphBoardProjector
{
    public Project(data: GraphData, doc: BoardDocument): void
    {
        const byId = new Map<string, GraphNodeVM>();
        for (const node of data.Nodes)
        {
            const vm = new GraphNodeVM();
            vm.Id = node.Id;
            vm.Label = node.Label;
            vm.Concept = node.Concept ?? '';
            doc.Nodes.Add(vm);
            byId.set(node.Id, vm);
        }
        for (const edge of data.Edges)
        {
            const source = byId.get(edge.From);
            const target = byId.get(edge.To);
            if (source === undefined || target === undefined)
            {
                continue;
            }
            const connector = doc.CreateConnector(new ConnectorEndpoint({ Node: source }), new ConnectorEndpoint({ Node: target }));
            if (connector !== null)
            {
                connector.LabelText = edge.Type;
            }
        }
    }
}
