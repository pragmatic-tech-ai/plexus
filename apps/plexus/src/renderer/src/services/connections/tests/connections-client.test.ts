import { describe, it, expect, afterEach } from 'vitest'
import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { ConnectionInspection } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/connections-client.js'
import { ConnectionsClient } from '../connections-client.js'

describe('ConnectionsClient.Inspect', () =>
{
    afterEach(() =>
    {
        delete (globalThis as unknown as { api?: unknown }).api
    })

    it('passes the id through to the preload bridge and returns its result unchanged', async () =>
    {
        const inspection: ConnectionInspection = {
            ok: true, message: 'HTTP 200', identity: 'octocat',
            scopes: ['read:packages'], scopesSupported: true,
            packages: ['p1', 'p2'], packagesSupported: true,
        }
        const seen: string[] = []
        ;(globalThis as unknown as { api: unknown }).api = {
            connections: {
                Inspect: async (id: string) =>
                {
                    seen.push(id)
                    return inspection
                },
            },
        }
        const provider = { get: () => undefined } as unknown as IServiceProvider
        const result = await new ConnectionsClient(provider).Inspect('conn-1')
        expect(seen).toEqual(['conn-1'])
        expect(result).toBe(inspection)
    })
})
