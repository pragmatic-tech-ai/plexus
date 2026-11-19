// Plain, source-agnostic graph data the Board viewer renders. Decoupled from both the
// Cypher wire cells (GraphCypherSource produces this) and the board (GraphBoardProjector
// consumes this), so neither the DB shape nor the board leaks across the seam.

export interface GraphNodeData
{
    readonly Id: string;
    readonly Concept: string | null;
    readonly Label: string;
    readonly Properties: Record<string, unknown>;
}

export interface GraphEdgeData
{
    readonly From: string;
    readonly Type: string;
    readonly To: string;
}

export interface GraphData
{
    readonly Nodes: readonly GraphNodeData[];
    readonly Edges: readonly GraphEdgeData[];
}
