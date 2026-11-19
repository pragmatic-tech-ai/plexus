import { describe, it, expect } from 'vitest'
import { BoardDocument } from '@pragmatic-tech-ai/mural/framework'
import type { GraphData } from '../../graph-data.js'
import { GraphBoardProjector } from '../graph-board-projector.js'
import { GraphLayout } from '../graph-layout.js'

const chain: GraphData = {
    Nodes: [
        { Id: 'a', Concept: 'actor', Label: 'A', Properties: {} },
        { Id: 'b', Concept: 'actor', Label: 'B', Properties: {} },
        { Id: 'c', Concept: 'actor', Label: 'C', Properties: {} },
    ],
    Edges: [
        { From: 'a', Type: 'r', To: 'b' },
        { From: 'b', Type: 'r', To: 'c' },
    ],
}

describe('GraphLayout.Apply', () =>
{
    it('seeds a finite position and the default size for every node', () =>
    {
        const doc = new BoardDocument()
        new GraphBoardProjector().Project(chain, doc)
        new GraphLayout().Apply(doc)

        for (const id of ['a', 'b', 'c'])
        {
            const v = doc.GetNodeVisual(id)
            expect(v, id).toBeDefined()
            expect(Number.isFinite(v!.left)).toBe(true)
            expect(Number.isFinite(v!.top)).toBe(true)
            expect(v!.w).toBe(160)
            expect(v!.h).toBe(48)
        }
    })

    it('single node -> one finite visual, no throw', () =>
    {
        const doc = new BoardDocument()
        new GraphBoardProjector().Project(
            { Nodes: [{ Id: 'solo', Concept: null, Label: 'S', Properties: {} }], Edges: [] },
            doc)
        expect(() => new GraphLayout().Apply(doc)).not.toThrow()
        const v = doc.GetNodeVisual('solo')
        expect(v).toBeDefined()
        expect(Number.isFinite(v!.left)).toBe(true)
        expect(Number.isFinite(v!.top)).toBe(true)
    })

    it('empty graph -> no throw, no visuals', () =>
    {
        const doc = new BoardDocument()
        new GraphBoardProjector().Project({ Nodes: [], Edges: [] }, doc)
        expect(() => new GraphLayout().Apply(doc)).not.toThrow()
        expect(doc.GetNodeVisual('anything')).toBeUndefined()
    })
})
