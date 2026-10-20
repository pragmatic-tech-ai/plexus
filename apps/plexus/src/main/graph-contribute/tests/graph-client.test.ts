import { describe, expect, it, vi } from 'vitest'
import { GraphContributeClientAdapter } from '../graph-client'
import type { GraphContributeParamsDto, GraphDetailDto } from '@pragmatic-tech-ai/pragmatic-protocol'

describe('GraphContributeClientAdapter', () =>
{
    it('forwards ContributeGraph to the underlying client and returns its result', async () =>
    {
        const detail = { id: 'g1' } as unknown as GraphDetailDto
        const fake = { ContributeGraph: vi.fn().mockResolvedValue(detail), DisposeAsync: vi.fn().mockResolvedValue(undefined) }
        const adapter = new GraphContributeClientAdapter(fake)
        const params = { graphId: 'g1' } as unknown as GraphContributeParamsDto
        const result = await adapter.ContributeGraph(params)
        expect(fake.ContributeGraph).toHaveBeenCalledWith(params)
        expect(result).toBe(detail)
    })

    it('Close disposes the underlying client once', async () =>
    {
        const fake = { ContributeGraph: vi.fn(), DisposeAsync: vi.fn().mockResolvedValue(undefined) }
        const adapter = new GraphContributeClientAdapter(fake)
        await adapter.Close()
        expect(fake.DisposeAsync).toHaveBeenCalledTimes(1)
    })
})
