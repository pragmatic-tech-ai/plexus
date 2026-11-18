import { describe, expect, it } from 'vitest'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { UploadService, type UploadEntry } from '../upload-service.js'
import { RelayAction, type IRelayConnector, type RelayClient } from '../../account/relay-connector.js'

class FakeClient
{
    public Log: string[] = []
    public Closed = 0

    public constructor(private readonly failOn?: string)
    {
    }

    private Step(name: string): void
    {
        this.Log.push(name)
        if (this.failOn === name) throw new Error('boom ' + name)
    }

    public async CreateSolution(params: { Name: string }): Promise<{ Name: string; Created: boolean }>
    {
        this.Step('create:' + params.Name)
        return { Name: params.Name, Created: true }
    }

    public async StorageWriteText(path: string, content: string): Promise<void>
    {
        this.Step('text:' + path + ':' + content)
    }

    public async StorageWriteBytes(path: string, bytes: Uint8Array): Promise<void>
    {
        this.Step('bytes:' + path + ':' + Array.from(bytes).join(','))
    }

    public async ContributeGraph(params: { graphName: string }): Promise<unknown>
    {
        this.Step('contribute:' + params.graphName)
        return { name: params.graphName, packages: [] }
    }

    public FailClose = false

    public async DisposeAsync(): Promise<void>
    {
        this.Closed++
        if (this.FailClose) throw new Error('close failed')
    }

    public CloseCode(): number | undefined
    {
        return undefined
    }
}

class FakeRelay implements IRelayConnector
{
    public Actions: RelayAction[] = []

    public constructor(private readonly client: FakeClient)
    {
    }

    public async Connect(_target: TargetRef, action: RelayAction): Promise<RelayClient>
    {
        this.Actions.push(action)
        return this.client as unknown as RelayClient
    }
}

const Target = { Source: TargetSource.Console, Name: 'dev' } as TargetRef
const Tree: UploadEntry[] = [
    { Path: 'a.pksln', Text: 'm' },
    { Path: 'p/x.bin', BytesBase64: 'AQID' },
    { Path: 'p/y.todl', Text: 't' },
]
const Contribution = { GraphName: 'g', SolutionId: 's', Packages: [] }

describe('UploadService', () =>
{
    it('creates, writes every entry in order, then contributes, over a develop relay', async () =>
    {
        const client = new FakeClient()
        const relay = new FakeRelay(client)
        await new UploadService(relay).Upload(Target, 'Sol', Tree, Contribution)
        expect(client.Log).toEqual(['create:Sol', 'text:a.pksln:m', 'bytes:p/x.bin:1,2,3', 'text:p/y.todl:t', 'contribute:g'])
        expect(relay.Actions).toEqual([RelayAction.Develop])
        expect(client.Closed).toBe(1)
    })

    it('skips contribute when none is given', async () =>
    {
        const client = new FakeClient()
        await new UploadService(new FakeRelay(client)).Upload(Target, 'Sol', Tree)
        expect(client.Log.some(l => l.startsWith('contribute'))).toBe(false)
    })

    it('rejects on a mid-stream write failure, stops, and still closes', async () =>
    {
        const client = new FakeClient('bytes:p/x.bin:1,2,3')
        await expect(new UploadService(new FakeRelay(client)).Upload(Target, 'Sol', Tree, Contribution)).rejects.toThrow()
        expect(client.Log).toEqual(['create:Sol', 'text:a.pksln:m', 'bytes:p/x.bin:1,2,3'])
        expect(client.Closed).toBe(1)
    })

    it('rejects when ContributeGraph fails after the writes, and still closes', async () =>
    {
        const client = new FakeClient('contribute:g')
        await expect(new UploadService(new FakeRelay(client)).Upload(Target, 'Sol', Tree, Contribution)).rejects.toThrow()
        expect(client.Log).toHaveLength(5)
        expect(client.Closed).toBe(1)
    })

    it('rejects an entry with neither text nor bytes', async () =>
    {
        const client = new FakeClient()
        await expect(new UploadService(new FakeRelay(client)).Upload(Target, 'Sol', [{ Path: 'e' }])).rejects.toThrow('neither')
        expect(client.Log).toEqual([])
        expect(client.Closed).toBe(0)
    })

    it('rejects an entry with both text and bytes without writing it', async () =>
    {
        const client = new FakeClient()
        await expect(new UploadService(new FakeRelay(client)).Upload(Target, 'Sol', [{ Path: 'e', Text: 't', BytesBase64: 'AQID' }])).rejects.toThrow('both')
        expect(client.Log).toEqual([])
        expect(client.Closed).toBe(0)
    })

    it('closes once, and a throwing close does not change the outcome', async () =>
    {
        const ok = new FakeClient()
        ok.FailClose = true
        await expect(new UploadService(new FakeRelay(ok)).Upload(Target, 'Sol', Tree)).resolves.toBeUndefined()
        expect(ok.Closed).toBe(1)
        const failing = new FakeClient('text:a.pksln:m')
        failing.FailClose = true
        await expect(new UploadService(new FakeRelay(failing)).Upload(Target, 'Sol', Tree)).rejects.toThrow()
        expect(failing.Closed).toBe(1)
    })

    it('does not write when CreateSolution fails', async () =>
    {
        const client = new FakeClient('create:Sol')
        await expect(new UploadService(new FakeRelay(client)).Upload(Target, 'Sol', Tree)).rejects.toThrow()
        expect(client.Log).toEqual(['create:Sol'])
    })
})
