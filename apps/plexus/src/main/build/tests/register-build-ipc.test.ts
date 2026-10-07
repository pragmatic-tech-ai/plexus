import { describe, it, expect } from 'vitest'
import { BuildChannel, BuildProgressKind } from '@pragmatic-tech-ai/plexus-core/shared/build-api.js'
import { ActionStatus, ProjectBuildStatus } from '@pragmatic-tech-ai/todl/build-system-core'
import { IpcBuildProgress } from '../ipc-build-progress.js'
import { BuildIpc } from '../register-build-ipc.js'

class FakeSender
{
    public sent: unknown[] = []
    public channels: string[] = []
    public Destroyed = false

    public isDestroyed(): boolean
    {
        return this.Destroyed
    }

    public send(channel: string, msg: unknown): void
    {
        this.channels.push(channel)
        this.sent.push(msg)
    }
}

describe('IpcBuildProgress', () =>
{
    it('does not send once the WebContents is destroyed', () =>
    {
        const sender = new FakeSender()
        sender.Destroyed = true
        new IpcBuildProgress('R1', sender as never).ProjectStarted('p', ['a'])
        expect(sender.sent).toEqual([])
    })

    it('forwards each callback as a runId-tagged progress event', () =>
    {
        const sender = new FakeSender()
        const p = new IpcBuildProgress('R1', sender as never)
        p.SolutionStarted(['proj'])
        p.ProjectStarted('proj', ['a', 'b'])
        p.ActionStarted('proj', 'a')
        p.ActionFinished('proj', 'a', ActionStatus.Succeeded)
        p.ProjectFinished('proj', ProjectBuildStatus.Built)
        p.Diagnostic('proj', { severity: 'error', message: 'boom' } as never)
        expect(sender.sent).toEqual([
            { runId: 'R1', kind: BuildProgressKind.SolutionStarted, args: [['proj']] },
            { runId: 'R1', kind: BuildProgressKind.ProjectStarted, args: ['proj', ['a', 'b']] },
            { runId: 'R1', kind: BuildProgressKind.ActionStarted, args: ['proj', 'a'] },
            { runId: 'R1', kind: BuildProgressKind.ActionFinished, args: ['proj', 'a', ActionStatus.Succeeded] },
            { runId: 'R1', kind: BuildProgressKind.ProjectFinished, args: ['proj', ProjectBuildStatus.Built] },
            { runId: 'R1', kind: BuildProgressKind.Diagnostic, args: ['proj', { severity: 'error', message: 'boom' }] },
        ])
        expect(sender.channels.every(c => c === BuildChannel.Progress)).toBe(true)
    })
})

describe('BuildIpc.Register', () =>
{
    it('wires req and runId-tagged progress through Run, and delegates Applicable', async () =>
    {
        const handlers = new Map<string, (e: unknown, a: unknown) => unknown>()
        const ipc = { handle: (ch: string, h: (e: unknown, a: unknown) => unknown) => handlers.set(ch, h) }
        let seenReq: unknown
        const provider = {
            Build: async (req: unknown, progress: IpcBuildProgress) =>
            {
                seenReq = req
                progress.ProjectStarted('p', ['a'])
                return { Result: { Ok: true, OutputPath: '/out', Diagnostics: [] } }
            },
            Applicable: (_j: string) => [{ systemId: 'html-bundle', systemName: 'HTML', flavorId: 'html-bundle', flavorName: 'HTML' }],
        }
        BuildIpc.Register(ipc as never, provider as never)

        const sender = new FakeSender()
        const req = { runId: 'R', projectRoot: '/p', systemId: 'html-bundle' }
        const runResult = await handlers.get(BuildChannel.Run)!({ sender }, req)
        expect(runResult).toEqual({ Ok: true, OutputPath: '/out', Diagnostics: [] })
        expect(seenReq).toBe(req)
        expect(sender.channels).toEqual([BuildChannel.Progress])
        expect(sender.sent).toEqual([{ runId: 'R', kind: BuildProgressKind.ProjectStarted, args: ['p', ['a']] }])
        const applicable = await handlers.get(BuildChannel.Applicable)!({}, 'json')
        expect((applicable as unknown[]).length).toBe(1)
    })

    it('maps a failed build with diagnostics and no output path', async () =>
    {
        const handlers = new Map<string, (e: unknown, a: unknown) => unknown>()
        const ipc = { handle: (ch: string, h: (e: unknown, a: unknown) => unknown) => handlers.set(ch, h) }
        const diagnostics = [{ severity: 'error', message: 'boom' }]
        const provider = { Build: async () => ({ Result: { Ok: false, OutputPath: undefined, Diagnostics: diagnostics } }) }
        BuildIpc.Register(ipc as never, provider as never)

        const runResult = await handlers.get(BuildChannel.Run)!({ sender: new FakeSender() }, { runId: 'R2', projectRoot: '/p', systemId: 's' })
        expect(runResult).toEqual({ Ok: false, OutputPath: undefined, Diagnostics: [{ severity: 'error', message: 'boom' }] })
    })
})
