import { describe, it, expect } from 'vitest'
import type { IpcMain } from 'electron'
import { TargetSource } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { DevSessionChannel } from '../../../shared/dev-session-api.js'
import { DevSessionIpc, type IDevSessionChangeSink } from '../dev-session-ipc.js'
import type { DevSessionHost } from '../dev-session-host.js'

type Handler = (event: unknown, ...args: unknown[]) => Promise<any>

class FakeIpc
{
    public readonly Handlers = new Map<string, Handler>()

    public handle(channel: string, handler: Handler): void
    {
        this.Handlers.set(channel, handler)
    }

    public Invoke(channel: string, ...args: unknown[]): Promise<any>
    {
        return this.Handlers.get(channel)!({}, ...args)
    }

    public AsIpc(): IpcMain
    {
        return this as unknown as IpcMain
    }
}

class FakeSession
{
    public Calls: string[] = []

    public async ReadText(path: string): Promise<string>
    {
        this.Calls.push(path)
        return 'text'
    }

    public async WriteBytes(path: string): Promise<void>
    {
        this.Calls.push(path)
    }

    public async Rename(from: string, to: string): Promise<void>
    {
        this.Calls.push(from + to)
    }
}

class FakeHost
{
    public readonly PushHandlers = new Map<string, (p: unknown) => void>()

    public static readonly NotOpen = 'No development environment is open.'
    public Opened = 0
    public Handler: ((change: unknown) => void) | undefined
    public readonly Fake = new FakeSession()

    public constructor(private readonly isOpen: boolean)
    {
    }

    public get Session(): FakeSession
    {
        if (!this.isOpen) throw new Error(FakeHost.NotOpen)
        return this.Fake
    }

    public async Open(): Promise<void>
    {
        this.Opened++
    }

    public async Close(): Promise<void>
    {
    }

    public OnChanged(handler: (change: unknown) => void): () => void
    {
        this.Handler = handler
        return () => { this.Handler = undefined }
    }

    public OnGraphChanged(handler: (p: unknown) => void): () => void
    {
        this.PushHandlers.set('OnGraphChanged', handler)
        return () => { this.PushHandlers.delete('OnGraphChanged') }
    }

    public OnBuildStateChanged(handler: (p: unknown) => void): () => void
    {
        this.PushHandlers.set('OnBuildStateChanged', handler)
        return () => { this.PushHandlers.delete('OnBuildStateChanged') }
    }

    public OnDiagnostics(handler: (p: unknown) => void): () => void
    {
        this.PushHandlers.set('OnDiagnostics', handler)
        return () => { this.PushHandlers.delete('OnDiagnostics') }
    }

    public AsHost(): DevSessionHost
    {
        return this as unknown as DevSessionHost
    }
}

class FakeSink implements IDevSessionChangeSink
{
    public Sent: unknown[] = []

    public constructor(private readonly destroyed = false, private readonly throws = false)
    {
    }

    public Channels: string[] = []

    public send(channel: string, ...args: unknown[]): void
    {
        if (this.throws) throw new Error('window gone')
        this.Channels.push(channel)
        this.Sent.push(args[0])
    }

    public isDestroyed(): boolean
    {
        return this.destroyed
    }
}

class Rig
{
    public readonly Ipc = new FakeIpc()
    public readonly Host: FakeHost

    public constructor(isOpen: boolean, sinks: IDevSessionChangeSink[] = [])
    {
        this.Host = new FakeHost(isOpen)
        DevSessionIpc.Register(this.Ipc.AsIpc(), this.Host.AsHost(), () => sinks)
    }
}

describe('DevSessionIpc.Register', () =>
{
    const malformed = 'The development session request was malformed.'

    it('rejects a malformed Target without opening', async () =>
    {
        const rig = new Rig(true)
        for (const bad of [undefined, null, 'x', { Name: '  ', Source: TargetSource.Console }, { Name: 'a', Source: 'nope' }])
        {
            const reply = await rig.Ipc.Invoke(DevSessionChannel.Open, bad)
            expect(reply).toEqual({ Ok: false, Error: { Message: malformed } })
        }
        expect(rig.Host.Opened).toBe(0)
    })

    it('opens for a valid Target', async () =>
    {
        const rig = new Rig(true)
        const reply = await rig.Ipc.Invoke(DevSessionChannel.Open, { Name: 'dev', Source: TargetSource.Platform })
        expect(reply.Ok).toBe(true)
        expect(rig.Host.Opened).toBe(1)
    })

    it('rejects a non-string Text argument before touching the session', async () =>
    {
        const rig = new Rig(true)
        expect(await rig.Ipc.Invoke(DevSessionChannel.ReadText, 42)).toEqual({ Ok: false, Error: { Message: malformed } })
        expect(await rig.Ipc.Invoke(DevSessionChannel.Rename, 'a', 7)).toEqual({ Ok: false, Error: { Message: malformed } })
        expect(rig.Host.Fake.Calls).toEqual([])
    })

    it('rejects non-Uint8Array Bytes and accepts a Uint8Array', async () =>
    {
        const rig = new Rig(true)
        expect(await rig.Ipc.Invoke(DevSessionChannel.WriteBytes, 'p', 'not bytes')).toEqual({ Ok: false, Error: { Message: malformed } })
        expect(await rig.Ipc.Invoke(DevSessionChannel.WriteBytes, 'p', [1, 2])).toEqual({ Ok: false, Error: { Message: malformed } })
        expect((await rig.Ipc.Invoke(DevSessionChannel.WriteBytes, 'p', new Uint8Array([1]))).Ok).toBe(true)
    })

    it('answers the not-open sentence when no session is open', async () =>
    {
        const rig = new Rig(false)
        expect(await rig.Ipc.Invoke(DevSessionChannel.ReadText, 'p')).toEqual({ Ok: false, Error: { Message: FakeHost.NotOpen } })
    })

    it('forwards a change to every live renderer even when one fails or is destroyed', async () =>
    {
        const bad = new FakeSink(false, true)
        const dead = new FakeSink(true)
        const good = new FakeSink()
        const rig = new Rig(true, [bad, dead, good])
        const change = { Path: 'x' }
        const original = console.error
        console.error = () => undefined
        try
        {
            rig.Host.Handler!(change)
        }
        finally
        {
            console.error = original
        }
        expect(good.Sent).toEqual([change])
        expect(dead.Sent).toEqual([])
    })

    it('dispose unsubscribes from host changes', () =>
    {
        const ipc = new FakeIpc()
        const host = new FakeHost(true)
        const sub = DevSessionIpc.Register(ipc.AsIpc(), host.AsHost(), () => [])
        sub.dispose()
        expect(host.Handler).toBeUndefined()
    })
})

// Records every language / model / solution call the IPC layer forwards to the held session.
class RecordingSession
{
    public Calls: Array<[string, unknown[]]> = []

    public constructor()
    {
        for (const [name] of IpcSamples.Requests) (this as any)[name] = (...args: unknown[]) => this.Record(name, args)
        ;(this as any).SelectAuthoring = (...args: unknown[]) => this.Record('SelectAuthoring', args)
    }

    private Record(name: string, args: unknown[]): Promise<string>
    {
        this.Calls.push([name, args])
        return Promise.resolve(`ret:${name}`)
    }
}

class IpcSamples
{
    public static readonly Requests: ReadonlyArray<readonly [string, unknown[]]> = [
        ['ListSolutions', []],
        ['ActiveSolution', []],
        ['CompletionsAt', ['u', { line: 1, character: 2 }]],
        ['HoverAt', ['u', { line: 1, character: 2 }]],
        ['DefinitionAt', ['u', { line: 1, character: 2 }]],
        ['ReferencesAt', ['u', { line: 1, character: 2 }, true]],
        ['PrepareRename', ['u', { line: 1, character: 2 }]],
        ['RenameEdits', ['u', { line: 1, character: 2 }, 'n']],
        ['DocumentSymbols', ['u']],
        ['FoldingRanges', ['u']],
        ['WorkspaceSymbols', ['q']],
        ['SemanticTokens', ['u']],
        ['SignatureHelpAt', ['u', { line: 1, character: 2 }]],
        ['CodeActions', ['u', { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, [{ message: 'm' }]]],
        ['FormatDocument', ['u']],
        ['DiagnosticsFor', ['u']],
        ['ModelView', ['member', { Limit: 5 }]],
        ['Resources', ['node']],
        ['DidChange', ['u', 'text']],
    ]
}

describe('DevSessionIpc language / model / solution channels', () =>
{
    it.each(IpcSamples.Requests)('%s forwards across the seam to the held session', async (name, args) =>
    {
        const rig = new Rig(true)
        const session = new RecordingSession()
        ;(rig.Host as any).Fake = session
        const reply = await rig.Ipc.Invoke((DevSessionChannel as any)[name], ...args)
        expect(reply).toEqual({ Ok: true, Value: `ret:${name}` })
        expect(session.Calls).toEqual([[name, args]])
    })

    it('SelectAuthoring forwards the solution id', async () =>
    {
        const rig = new Rig(true)
        const session = new RecordingSession()
        ;(rig.Host as any).Fake = session
        await rig.Ipc.Invoke(DevSessionChannel.SelectAuthoring, 's1')
        expect(session.Calls).toEqual([['SelectAuthoring', ['s1']]])
    })

    it('ModelView page is optional', async () =>
    {
        const rig = new Rig(true)
        const session = new RecordingSession()
        ;(rig.Host as any).Fake = session
        await rig.Ipc.Invoke(DevSessionChannel.ModelView, 'm')
        expect(session.Calls).toEqual([['ModelView', ['m', undefined]]])
    })

    it('rejects malformed language arguments before touching the session', async () =>
    {
        const rig = new Rig(true)
        const session = new RecordingSession()
        ;(rig.Host as any).Fake = session
        const malformed = { Ok: false, Error: { Message: 'The development session request was malformed.' } }
        expect(await rig.Ipc.Invoke(DevSessionChannel.HoverAt, 'u', 'not a position')).toEqual(malformed)
        expect(await rig.Ipc.Invoke(DevSessionChannel.HoverAt, 7, { line: 0, character: 0 })).toEqual(malformed)
        expect(await rig.Ipc.Invoke(DevSessionChannel.ReferencesAt, 'u', { line: 0, character: 0 }, 'yes')).toEqual(malformed)
        expect(await rig.Ipc.Invoke(DevSessionChannel.CodeActions, 'u', { start: 1 }, 'nope')).toEqual(malformed)
        expect(session.Calls).toEqual([])
    })

    it.each([
        ['OnGraphChanged', DevSessionChannel.GraphChanged],
        ['OnBuildStateChanged', DevSessionChannel.BuildStateChanged],
        ['OnDiagnostics', DevSessionChannel.Diagnostics],
    ])('%s pushes reach every live renderer on their channel', (name, channel) =>
    {
        const dead = new FakeSink(true)
        const good = new FakeSink()
        const rig = new Rig(true, [dead, good])
        rig.Host.PushHandlers.get(name)!({ p: 1 })
        expect(good.Sent).toEqual([{ p: 1 }])
        expect(good.Channels).toEqual([channel])
        expect(dead.Sent).toEqual([])
    })

    it('dispose unsubscribes the push handlers too', () =>
    {
        const ipc = new FakeIpc()
        const host = new FakeHost(true)
        DevSessionIpc.Register(ipc.AsIpc(), host.AsHost(), () => []).dispose()
        expect(host.PushHandlers.size).toBe(0)
    })
})
