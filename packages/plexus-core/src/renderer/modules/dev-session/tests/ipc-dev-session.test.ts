import { describe, it, expect } from 'vitest'
import { TargetSource } from '../../../../shared/account-api.js'
import { IpcDevSession } from '../ipc-dev-session.js'
import type { IDevSessionBridge } from '../dev-session-bridge.js'

class FakeBridge
{
    public Handler: ((c: unknown) => void) | undefined
    public Removed = 0
    public Opened: unknown
    public Reply: unknown = { Ok: true, Value: 'hello' }

    public ReadText(): Promise<unknown>
    {
        return Promise.resolve(this.Reply)
    }

    public Open(target: unknown): Promise<unknown>
    {
        this.Opened = target
        return Promise.resolve({ Ok: true, Value: undefined })
    }

    public OnChanged(h: (c: unknown) => void): () => void
    {
        this.Handler = h
        return () => { this.Removed++ }
    }

    public AsBridge(): IDevSessionBridge
    {
        return this as unknown as IDevSessionBridge
    }
}

describe('IpcDevSession', () =>
{
    it('unwraps a reply', async () =>
    {
        expect(await new IpcDevSession(new FakeBridge().AsBridge()).ReadText('a')).toBe('hello')
    })

    it('rejects with the failure sentence', async () =>
    {
        const bridge = new FakeBridge()
        bridge.Reply = { Ok: false, Error: { Message: 'gone away' } }
        await expect(new IpcDevSession(bridge.AsBridge()).ReadText('a')).rejects.toThrow('gone away')
    })

    it('Open sends only Name and Source', async () =>
    {
        const bridge = new FakeBridge()
        await new IpcDevSession(bridge.AsBridge()).Open({ Name: 'd', Source: TargetSource.Console, Extra: 1 } as never)
        expect(bridge.Opened).toEqual({ Name: 'd', Source: TargetSource.Console })
    })

    it('OnStorageChanged registers on the bridge and returns its disposer', () =>
    {
        const bridge = new FakeBridge()
        const seen: unknown[] = []
        const off = new IpcDevSession(bridge.AsBridge()).OnStorageChanged(c => seen.push(c))
        bridge.Handler!({ Kind: 'added', Path: 'x', IsDirectory: false })
        expect(seen).toHaveLength(1)
        off()
        expect(bridge.Removed).toBe(1)
    })
})
