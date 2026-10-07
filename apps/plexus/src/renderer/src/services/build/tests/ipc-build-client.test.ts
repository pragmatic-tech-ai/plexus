import { describe, it, expect, beforeEach } from 'vitest'
import { IpcBuildClient } from '../ipc-build-client.js'

class ApiHarness
{
    private cb: ((e: unknown) => void) | undefined
    public readonly runs: unknown[] = []

    public Install(): void
    {
        ;(globalThis as any).api = { build: {
            Run: async (req: unknown) => { this.runs.push(req); return { Ok: true, OutputPath: '/o', Diagnostics: [] } },
            Applicable: async (_j: string) => [],
            OnProgress: (fn: (e: unknown) => void) => { this.cb = fn; return () => { this.cb = undefined } },
        } }
    }

    public Emit(e: unknown): void
    {
        this.cb?.(e)
    }
}

describe('IpcBuildClient', () =>
{
    beforeEach(() => { delete (globalThis as any).api })

    it('routes progress events to the reporter registered for that runId only', () =>
    {
        const h = new ApiHarness(); h.Install()
        const client = new IpcBuildClient()
        const a: string[] = []; const b: string[] = []
        client.OnProgress('R1', { ActionStarted: (_p: string, act: string) => a.push(act) } as never)
        client.OnProgress('R2', { ActionStarted: (_p: string, act: string) => b.push(act) } as never)
        h.Emit({ runId: 'R1', kind: 'action-started', args: ['p', 'compile'] })
        expect(a).toEqual(['compile']); expect(b).toEqual([])
    })

    it('stops routing after dispose', () =>
    {
        const h = new ApiHarness(); h.Install()
        const client = new IpcBuildClient()
        const seen: string[] = []
        const sub = client.OnProgress('R1', { ActionStarted: (_p: string, act: string) => seen.push(act) } as never)
        sub.dispose()
        h.Emit({ runId: 'R1', kind: 'action-started', args: ['p', 'compile'] })
        expect(seen).toEqual([])
    })

    it('delegates Build to the bridge Run', async () =>
    {
        const h = new ApiHarness(); h.Install()
        const client = new IpcBuildClient()
        const req = { runId: 'R1', projectRoot: '/p', systemId: 's' }
        const res = await client.Build(req)
        expect(res.Ok).toBe(true)
        expect(h.runs).toEqual([req])
    })

    it('throws when the preload bridge is absent', () =>
    {
        expect(() => new IpcBuildClient()).toThrow()
    })
})
