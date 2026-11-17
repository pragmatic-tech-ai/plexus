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

    public send(_channel: string, ...args: unknown[]): void
    {
        if (this.throws) throw new Error('window gone')
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
