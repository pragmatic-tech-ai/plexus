import { describe, it, expect } from 'vitest'
import { BoardDocument } from '@pragmatic-tech-ai/mural/framework'
import type { GraphData } from '../../graph-data.js'
import { GraphNodeVM } from '../../graph-node-vm.js'
import { GraphBoardProjector } from '../graph-board-projector.js'

const two: GraphData = {
    Nodes: [
        { Id: 'a', Concept: 'actor', Label: 'Alice', Properties: {} },
        { Id: 'b', Concept: 'actor', Label: 'Bob', Properties: {} },
    ],
    Edges: [{ From: 'a', Type: 'knows', To: 'b' }],
}

describe('GraphBoardProjector.Project', () =>
{
    it('adds a GraphNodeVM per node (Id/Label/Concept) and a connector per edge', () =>
    {
        const doc = new BoardDocument()
        new GraphBoardProjector().Project(two, doc)

        expect(doc.Nodes.Count).toBe(2)
        const vms = doc.Nodes.ToArray() as GraphNodeVM[]
        expect(vms.map(v => v.Id).sort()).toEqual(['a', 'b'])
        expect(vms.find(v => v.Id === 'a')?.Label).toBe('Alice')
        expect(vms.find(v => v.Id === 'a')?.Concept).toBe('actor')
        expect(doc.Connectors.Count).toBe(1)
        expect(doc.Connectors.ToArray()[0]?.LabelText).toBe('knows')
    })

    it('empty graph -> no nodes, no connectors', () =>
    {
        const doc = new BoardDocument()
        new GraphBoardProjector().Project({ Nodes: [], Edges: [] }, doc)
        expect(doc.Nodes.Count).toBe(0)
        expect(doc.Connectors.Count).toBe(0)
    })

    it('skips a dangling edge whose endpoint is absent', () =>
    {
        const doc = new BoardDocument()
        new GraphBoardProjector().Project(
            { Nodes: [{ Id: 'a', Concept: null, Label: 'A', Properties: {} }], Edges: [{ From: 'a', Type: 'x', To: 'ghost' }] },
            doc)
        expect(doc.Nodes.Count).toBe(1)
        expect(doc.Connectors.Count).toBe(0)
    })

    it('projects a self-edge and a duplicate pair as distinct connectors', () =>
    {
        const doc = new BoardDocument()
        const d: GraphData = {
            Nodes: [
                { Id: 'a', Concept: null, Label: 'A', Properties: {} },
                { Id: 'b', Concept: null, Label: 'B', Properties: {} },
            ],
            Edges: [
                { From: 'a', Type: 'self', To: 'a' },
                { From: 'a', Type: 'r', To: 'b' },
                { From: 'a', Type: 'r2', To: 'b' },
            ],
        }
        new GraphBoardProjector().Project(d, doc)
        expect(doc.Connectors.Count).toBe(3)
    })
})
