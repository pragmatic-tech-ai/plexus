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

// A bridge answering every request with an Ok envelope that echoes the call, and recording subscriptions.
class RecordingBridge
{
    public Calls: Array<[string, unknown[]]> = []
    public Handlers = new Map<string, (p: unknown) => void>()
    public Removed: string[] = []

    public constructor()
    {
        for (const [name] of BridgeSamples.Requests) (this as any)[name] = (...args: unknown[]) => this.Record(name, args)
        ;(this as any).SelectAuthoring = (...args: unknown[]) => this.Record('SelectAuthoring', args)
        for (const name of ['OnGraphChanged', 'OnBuildStateChanged', 'OnDiagnostics'])
        {
            ;(this as any)[name] = (handler: (p: unknown) => void) =>
            {
                this.Handlers.set(name, handler)
                return () => { this.Removed.push(name) }
            }
        }
    }

    private Record(name: string, args: unknown[]): Promise<unknown>
    {
        this.Calls.push([name, args])
        return Promise.resolve({ Ok: true, Value: `ret:${name}` })
    }

    public AsBridge(): IDevSessionBridge
    {
        return this as unknown as IDevSessionBridge
    }
}

class BridgeSamples
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

describe('IpcDevSession language / model / solution surface', () =>
{
    it.each(BridgeSamples.Requests)('%s forwards to the bridge and unwraps the reply', async (name, args) =>
    {
        const bridge = new RecordingBridge()
        const result = await (new IpcDevSession(bridge.AsBridge()) as any)[name](...args)
        expect(bridge.Calls).toEqual([[name, args]])
        expect(result).toBe(`ret:${name}`)
    })

    it('SelectAuthoring forwards the solution id', async () =>
    {
        const bridge = new RecordingBridge()
        await new IpcDevSession(bridge.AsBridge()).SelectAuthoring('s1')
        expect(bridge.Calls).toEqual([['SelectAuthoring', ['s1']]])
    })

    it('rejects with the failure sentence of an error reply', async () =>
    {
        const bridge = new RecordingBridge() as any
        bridge.HoverAt = () => Promise.resolve({ Ok: false, Error: { Message: 'no server' } })
        await expect(new IpcDevSession(bridge.AsBridge()).HoverAt('u', { line: 0, character: 0 })).rejects.toThrow('no server')
    })

    it.each(['OnGraphChanged', 'OnBuildStateChanged', 'OnDiagnostics'])('%s registers on the bridge and returns its disposer', (name) =>
    {
        const bridge = new RecordingBridge()
        const seen: unknown[] = []
        const off = (new IpcDevSession(bridge.AsBridge()) as any)[name]((p: unknown) => seen.push(p))
        bridge.Handlers.get(name)!({ p: 1 })
        expect(seen).toEqual([{ p: 1 }])
        off()
        expect(bridge.Removed).toEqual([name])
    })
})
