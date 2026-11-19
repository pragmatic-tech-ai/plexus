import { describe, it, expect } from 'vitest'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { CypherNodeCellDto, CypherQueryPageDto, PageParams } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { EnvironmentContents, EnvironmentCypherParams, IEnvironmentsApi } from '../../../../../../shared/environment-contents-api.js'
import { GraphCypherSource } from '../graph-cypher-source.js'

// A fake env Cypher seam that returns a scripted sequence of pages, so GraphCypherSource is
// tested without a real relay. `MATCH (n) RETURN n` -> each row is [{ $node: CypherNodeCellDto }].
class FakeEnvironmentsApi implements IEnvironmentsApi
{
    public constructor(private readonly pages: CypherQueryPageDto[]) {}
    public cypherCalls = 0

    public Contents(_target: TargetRef): Promise<EnvironmentContents>
    {
        return Promise.resolve({ Applications: [], Graphs: [] })
    }

    public Cypher(_target: TargetRef, _cypher: string, _params?: EnvironmentCypherParams, page?: PageParams): Promise<CypherQueryPageDto>
    {
        // Page 0 for the first (cursorless) call, then follow nextCursor by index.
        const index = page?.cursor === undefined ? 0 : Number(page.cursor)
        this.cypherCalls += 1
        return Promise.resolve(this.pages[index] ?? { items: [], columns: ['n'], truncated: false })
    }
}

function node(id: string, concept: string, label: string, refs: { [k: string]: string[] } = {}): CypherNodeCellDto[]
{
    return [{ $node: { id, concept, label, fields: {}, refs } } as unknown as CypherNodeCellDto]
}

const Target: TargetRef = { Name: 'env', Source: TargetSource.Console }

describe('GraphCypherSource.LoadGraph', () =>
{
    it('maps paged node cells into GraphData nodes and their refs into edges', async () =>
    {
        const pages: CypherQueryPageDto[] = [
            { items: [node('a', 'actor', 'Alice', { knows: ['b'] })], columns: ['n'], truncated: false, nextCursor: '1' },
            { items: [node('b', 'actor', 'Bob')], columns: ['n'], truncated: false },
        ]
        const api = new FakeEnvironmentsApi(pages)
        const source = new GraphCypherSource(api)

        const data = await source.LoadGraph(Target)

        expect(data.Nodes.map(n => n.Id).sort()).toEqual(['a', 'b'])
        expect(data.Nodes.find(n => n.Id === 'a')).toMatchObject({ Concept: 'actor', Label: 'Alice' })
        expect(data.Edges).toEqual([{ From: 'a', Type: 'knows', To: 'b' }])
        expect(api.cypherCalls).toBe(2) // followed nextCursor across both pages
    })

    it('returns empty GraphData for an empty graph', async () =>
    {
        const source = new GraphCypherSource(new FakeEnvironmentsApi([{ items: [], columns: ['n'], truncated: false }]))
        const data = await source.LoadGraph(Target)
        expect(data.Nodes).toEqual([])
        expect(data.Edges).toEqual([])
    })
})
