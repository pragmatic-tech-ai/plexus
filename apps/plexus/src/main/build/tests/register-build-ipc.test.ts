import { describe, it, expect } from 'vitest'
import { BuildChannel, BuildProgressKind } from '@pragmatic-tech-ai/plexus-core/shared/build-api.js'
import { IpcBuildProgress } from '../ipc-build-progress.js'
import { BuildIpc } from '../register-build-ipc.js'

class FakeSender
{
    public sent: unknown[] = []
    public channels: string[] = []

    public send(channel: string, msg: unknown): void
    {
        this.channels.push(channel)
        this.sent.push(msg)
    }
}

describe('IpcBuildProgress', () =>
{
    it('forwards each callback as a runId-tagged progress event', () =>
    {
        const sender = new FakeSender()
        const p = new IpcBuildProgress('R1', sender as never)
        p.SolutionStarted(['proj'])
        p.ProjectStarted('proj', ['a', 'b'])
        p.ActionStarted('proj', 'a')
        p.ActionFinished('proj', 'a', 'ok' as never)
        p.ProjectFinished('proj', 'ok' as never)
        p.Diagnostic('proj', { severity: 'error', message: 'boom' } as never)
        expect(sender.sent).toEqual([
            { runId: 'R1', kind: BuildProgressKind.SolutionStarted, args: [['proj']] },
            { runId: 'R1', kind: BuildProgressKind.ProjectStarted, args: ['proj', ['a', 'b']] },
            { runId: 'R1', kind: BuildProgressKind.ActionStarted, args: ['proj', 'a'] },
            { runId: 'R1', kind: BuildProgressKind.ActionFinished, args: ['proj', 'a', 'ok'] },
            { runId: 'R1', kind: BuildProgressKind.ProjectFinished, args: ['proj', 'ok'] },
            { runId: 'R1', kind: BuildProgressKind.Diagnostic, args: ['proj', { severity: 'error', message: 'boom' }] },
        ])
        expect(sender.channels.every(c => c === BuildChannel.Progress)).toBe(true)
    })
})

describe('BuildIpc.Register', () =>
{
    it('maps a build to Run and delegates Applicable', async () =>
    {
        const handlers = new Map<string, (e: unknown, a: unknown) => unknown>()
        const ipc = { handle: (ch: string, h: (e: unknown, a: unknown) => unknown) => handlers.set(ch, h) }
        const provider = {
            Build: async () => ({ Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } }),
            Applicable: (_j: string) => [{ systemId: 'html-bundle', systemName: 'HTML', flavorId: 'html-bundle', flavorName: 'HTML' }],
        }
        BuildIpc.Register(ipc as never, provider as never)

        const runResult = await handlers.get(BuildChannel.Run)!({ sender: new FakeSender() }, { runId: 'R', projectRoot: '/p', systemId: 'html-bundle' })
        expect(runResult).toEqual({ Ok: true, OutputPath: '/out', Diagnostics: [] })
        const applicable = await handlers.get(BuildChannel.Applicable)!({}, 'json')
        expect((applicable as unknown[]).length).toBe(1)
    })
})
