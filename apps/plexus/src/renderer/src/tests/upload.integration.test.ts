import { afterEach, describe, expect, it } from 'vitest'
import { Solution } from '@pragmatic-tech-ai/todl'
import { UploadToEnvironmentContributor } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/upload-to-environment-contributor.js'
import { TargetPickOutcome, type ITargetPicker, type TargetPick } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/target-dialog.js'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { UploadChannel, type UploadEntry } from '../../../shared/upload-api.js'
import { UploadIpc } from '../../../main/upload/upload-ipc.js'
import { UploadService } from '../../../main/upload/upload-service.js'
import { DevelopSession } from '../../../main/account/develop-session.js'
import { RelayAction, type IRelayConnector, type RelayClient } from '../../../main/account/relay-connector.js'
import IpcUploadContributor from '../services/upload/ipc-upload-contributor.js'

// Drives the renderer upload command end to end over a MOCKED relay client (no socket). The Electron
// IPC boundary is stood in for by IpcBridge: it registers the real UploadIpc on a fake ipcMain and
// exposes window.api.upload as a direct call into the registered handler (as the preload would),
// so the real IpcUploadContributor, UploadIpc argument checks, RelayWire envelope, UploadService and
// DevelopSession serializer all run. Only Electron itself is not booted.

class FakeRelayClient
{
    public static readonly Boom = 'boom '

    public readonly Log: string[] = []
    public InFlight = 0
    public PeakInFlight = 0
    public Closed = 0

    public constructor(private readonly failOn?: string)
    {
    }

    private async Step(name: string): Promise<void>
    {
        this.Log.push(name)
        this.InFlight++
        this.PeakInFlight = Math.max(this.PeakInFlight, this.InFlight)
        try
        {
            await new Promise<void>(resolve => setTimeout(resolve, 0))
            if (this.failOn === name) throw new Error(FakeRelayClient.Boom + name)
        }
        finally
        {
            this.InFlight--
        }
    }

    public async CreateSolution(params: { Name: string }): Promise<{ Name: string; Created: boolean }>
    {
        await this.Step('create:' + params.Name)
        return { Name: params.Name, Created: true }
    }

    public async StorageWriteText(path: string, _content: string): Promise<void>
    {
        await this.Step('text:' + path)
    }

    public async StorageWriteBytes(path: string, _bytes: Uint8Array): Promise<void>
    {
        await this.Step('bytes:' + path)
    }

    public async ContributeGraph(params: { graphName: string }): Promise<unknown>
    {
        await this.Step('contribute:' + params.graphName)
        return { name: params.graphName, packages: [] }
    }

    public async DisposeAsync(): Promise<void>
    {
        this.Closed++
    }

    public CloseCode(): number | undefined
    {
        return undefined
    }
}

class FakeRelay implements IRelayConnector
{
    public Actions: RelayAction[] = []

    public constructor(private readonly client: FakeRelayClient)
    {
    }

    public async Connect(_target: TargetRef, action: RelayAction): Promise<RelayClient>
    {
        this.Actions.push(action)
        return this.client as unknown as RelayClient
    }
}

class IpcBridge
{
    public static Install(service: UploadService): void
    {
        const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
        const ipc = { handle: (channel: string, fn: (e: unknown, ...a: unknown[]) => Promise<unknown>) => { handlers.set(channel, (...a) => fn({}, ...a)) } }
        UploadIpc.Register(ipc as never, service);
        (globalThis as unknown as { api: unknown }).api = { upload: { Upload: (...args: unknown[]) => handlers.get(UploadChannel.Upload)!(...args) } }
    }

    public static Remove(): void
    {
        delete (globalThis as unknown as { api?: unknown }).api
    }
}

class Fixture
{
    public static readonly SolutionName = 'S'
    public static readonly EnvName = 'dev'
    public static readonly GraphName = 'main'
    // RelayConnector.Call maps a non-account write failure to this sentence before it crosses IPC.
    public static readonly WriteFailedSentence = 'The environment dev could not handle this request. It may need an update.'
    public static readonly Tree: UploadEntry[] = [
        { Path: 'S.pksln', Text: 'm' },
        { Path: 'p/x.bin', BytesBase64: 'AQID' },
        { Path: 'p/y.todl', Text: 't' },
    ]
    public static readonly Packages = [{ id: 'p', version: '1.0.0', modelJson: '{}' }]

    public Task: Promise<number> | undefined
    public Title: string | undefined

    public static async Settle(ms = 20): Promise<void>
    {
        await new Promise<void>(resolve => setTimeout(resolve, ms))
    }

    public Run(tree: UploadEntry[], client: FakeRelayClient): FakeRelay
    {
        const relay = new FakeRelay(client)
        IpcBridge.Install(new UploadService(relay))
        const work: any = { run: (title: string, fn: (ctx: unknown) => Promise<number>) =>
        {
            this.Title = title
            this.Task = fn({})
            return { handle: {}, done: this.Task }
        } }
        const choice = { Environment: Fixture.EnvName, Source: TargetSource.Console, GraphName: Fixture.GraphName }
        const picker: ITargetPicker = {
            Show: (): Promise<TargetPick> => Promise.resolve({ Outcome: TargetPickOutcome.Chosen, Choice: choice } as TargetPick),
            RequestSignIn: (): Promise<boolean> => Promise.resolve(false),
        }
        const enumerator = { Enumerate: () => Promise.resolve(tree) }
        const builder = { Build: () => Promise.resolve(Fixture.Packages) }
        const contributor = new UploadToEnvironmentContributor(new Solution(Fixture.SolutionName), enumerator as never, builder as never, work, new IpcUploadContributor(), undefined, picker)
        contributor.Resolve(UploadToEnvironmentContributor.UploadCommandId, {} as never)!.Execute()
        return relay
    }
}

describe('upload command integration (renderer -> IPC stand-in -> UploadService -> mocked relay)', () =>
{
    afterEach(() => IpcBridge.Remove())

    it('creates the solution, writes every entry in order, then contributes', async () =>
    {
        const client = new FakeRelayClient()
        const fixture = new Fixture()
        const relay = fixture.Run(Fixture.Tree, client)
        await Fixture.Settle()
        await expect(fixture.Task).resolves.toBe(Fixture.Tree.length)
        expect(client.Log).toEqual(['create:S', 'text:S.pksln', 'bytes:p/x.bin', 'text:p/y.todl', 'contribute:main'])
        expect(relay.Actions).toEqual([RelayAction.Develop])
        expect(client.Closed).toBe(1)
        expect(fixture.Title).toBe('Uploading S to dev')
    })

    it('fails the upload (no false success) when a mid-stream write rejects, and stops', async () =>
    {
        const client = new FakeRelayClient('bytes:p/x.bin')
        const fixture = new Fixture()
        fixture.Run(Fixture.Tree, client)
        await Fixture.Settle()
        await expect(fixture.Task).rejects.toThrow(Fixture.WriteFailedSentence)
        expect(client.Log).toEqual(['create:S', 'text:S.pksln', 'bytes:p/x.bin'])
        expect(client.Log.some(l => l.startsWith('contribute'))).toBe(false)
        expect(client.Closed).toBe(1)
    })

    it('never has more than MaxInFlight writes in flight across a large tree', async () =>
    {
        const big: UploadEntry[] = Array.from({ length: 100 }, (_, i) => ({ Path: 'f' + i, Text: 'x' }))
        const client = new FakeRelayClient()
        const fixture = new Fixture()
        fixture.Run(big, client)
        await Fixture.Settle(400)
        await expect(fixture.Task).resolves.toBe(big.length)
        expect(client.Log).toHaveLength(big.length + 2)
        expect(client.Log[0]).toBe('create:S')
        expect(client.Log[client.Log.length - 1]).toBe('contribute:main')
        expect(client.PeakInFlight).toBeLessThanOrEqual(DevelopSession.MaxInFlight)
    })
})
