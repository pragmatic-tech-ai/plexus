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
// so the real IpcUploadContributor, UploadIpc argument checks, UploadService and DevelopSession
// serializer all run (the RelayWire envelope is exercised implicitly: the failure sentence the
// renderer sees only survives IPC through it). Only Electron itself is not booted.

class FakeRelayClient
{
    public static readonly Boom = 'boom '
    public static readonly CreatePrefix = 'create:'
    public static readonly TextPrefix = 'text:'
    public static readonly BytesPrefix = 'bytes:'
    public static readonly ContributePrefix = 'contribute:'

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
        await this.Step(FakeRelayClient.CreatePrefix + params.Name)
        return { Name: params.Name, Created: true }
    }

    public async StorageWriteText(path: string, _content: string): Promise<void>
    {
        await this.Step(FakeRelayClient.TextPrefix + path)
    }

    public async StorageWriteBytes(path: string, _bytes: Uint8Array): Promise<void>
    {
        await this.Step(FakeRelayClient.BytesPrefix + path)
    }

    public async ContributeGraph(params: { graphName: string }): Promise<unknown>
    {
        await this.Step(FakeRelayClient.ContributePrefix + params.graphName)
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
    public static readonly Title = 'Uploading S to dev'
    public static readonly FirstPath = 'S.pksln'
    public static readonly BinPath = 'p/x.bin'
    public static readonly LastPath = 'p/y.todl'
    // RelayConnector.Call maps a non-account write failure to this sentence before it crosses IPC.
    public static readonly WriteFailedSentence = 'The environment dev could not handle this request. It may need an update.'
    public static readonly Tree: UploadEntry[] = [
        { Path: Fixture.FirstPath, Text: 'm' },
        { Path: Fixture.BinPath, BytesBase64: 'AQID' },
        { Path: Fixture.LastPath, Text: 't' },
    ]
    public static readonly Packages = [{ id: 'p', version: '1.0.0', modelJson: '{}' }]

    public Title: string | undefined
    private readonly started: Promise<Promise<number>>
    private signalStarted: (task: Promise<number>) => void = () => undefined

    public constructor()
    {
        this.started = new Promise<Promise<number>>(resolve => { this.signalStarted = resolve })
    }

    // Resolves or rejects with the background task's own outcome; no timing assumptions.
    public Outcome(): Promise<number>
    {
        return this.started.then(task => task)
    }

    public Run(tree: UploadEntry[], client: FakeRelayClient): FakeRelay
    {
        const relay = new FakeRelay(client)
        IpcBridge.Install(new UploadService(relay))
        const work = { run: (title: string, fn: (ctx: unknown) => Promise<number>) =>
        {
            this.Title = title
            const task = fn({})
            this.signalStarted(task)
            return { handle: {}, done: task }
        } }
        const choice = { Environment: Fixture.EnvName, Source: TargetSource.Console, GraphName: Fixture.GraphName }
        const picker: ITargetPicker = {
            Show: (): Promise<TargetPick> => Promise.resolve({ Outcome: TargetPickOutcome.Chosen, Choice: choice } as TargetPick),
            RequestSignIn: (): Promise<boolean> => Promise.resolve(false),
        }
        const enumerator = { Enumerate: () => Promise.resolve(tree) }
        const builder = { Build: () => Promise.resolve(Fixture.Packages) }
        const contributor = new UploadToEnvironmentContributor(new Solution(Fixture.SolutionName), enumerator as never, builder as never, work as never, new IpcUploadContributor(), undefined, picker)
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
        await expect(fixture.Outcome()).resolves.toBe(Fixture.Tree.length)
        expect(client.Log).toEqual([
            FakeRelayClient.CreatePrefix + Fixture.SolutionName,
            FakeRelayClient.TextPrefix + Fixture.FirstPath,
            FakeRelayClient.BytesPrefix + Fixture.BinPath,
            FakeRelayClient.TextPrefix + Fixture.LastPath,
            FakeRelayClient.ContributePrefix + Fixture.GraphName,
        ])
        expect(relay.Actions).toEqual([RelayAction.Develop])
        expect(client.Closed).toBe(1)
        expect(fixture.Title).toBe(Fixture.Title)
    })

    it('fails the upload (no false success) when a mid-stream write rejects, and stops', async () =>
    {
        const failing = FakeRelayClient.BytesPrefix + Fixture.BinPath
        const client = new FakeRelayClient(failing)
        const fixture = new Fixture()
        fixture.Run(Fixture.Tree, client)
        await expect(fixture.Outcome()).rejects.toThrow(Fixture.WriteFailedSentence)
        expect(client.Log).toEqual([FakeRelayClient.CreatePrefix + Fixture.SolutionName, FakeRelayClient.TextPrefix + Fixture.FirstPath, failing])
        expect(client.Log.some(l => l.startsWith(FakeRelayClient.ContributePrefix))).toBe(false)
        expect(client.Closed).toBe(1)
    })

    // A no-overflow guard only: UploadService writes sequentially, so the real peak is 1. The serializer's
    // cap itself is proven by the DevelopSession test below.
    it('never exceeds MaxInFlight across a large tree (sequential writes, so the peak is 1)', async () =>
    {
        const big: UploadEntry[] = Array.from({ length: 100 }, (_, i) => ({ Path: 'f' + i, Text: 'x' }))
        const client = new FakeRelayClient()
        const fixture = new Fixture()
        fixture.Run(big, client)
        await expect(fixture.Outcome()).resolves.toBe(big.length)
        expect(client.Log).toHaveLength(big.length + 2)
        expect(client.Log[0]).toBe(FakeRelayClient.CreatePrefix + Fixture.SolutionName)
        expect(client.Log[client.Log.length - 1]).toBe(FakeRelayClient.ContributePrefix + Fixture.GraphName)
        expect(client.PeakInFlight).toBeGreaterThanOrEqual(1)
        expect(client.PeakInFlight).toBeLessThanOrEqual(DevelopSession.MaxInFlight)
    })
})

describe('DevelopSession serializer', () =>
{
    it('caps concurrent writes at exactly MaxInFlight when more callers arrive at once', async () =>
    {
        const client = new FakeRelayClient()
        const session = new DevelopSession(client as unknown as RelayClient)
        const callers = DevelopSession.MaxInFlight * 3
        await Promise.all(Array.from({ length: callers }, (_, i) => session.WriteText('c' + i, 'x')))
        expect(client.Log).toHaveLength(callers)
        expect(client.PeakInFlight).toBe(DevelopSession.MaxInFlight)
    })
})
