import { describe, expect, it } from 'vitest'
import { HostKind, ShellCompositionRoot } from '@pragmatic-tech-ai/mural/runtime'
import { Observable } from '@pragmatic-tech-ai/todl-runtime'
import { Solution, SolutionLanguageService, SolutionManagerService } from '@pragmatic-tech-ai/todl'
import type { BuildStateChangedPayload, PublishDiagnosticsParams, SolutionGraphChangePayload, StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import { OpenFromEnvironmentFlow, type IOpenFromEnvManager } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/open-from-environment-flow.js'
import { SolutionOriginRegistry } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/solution-origin-registry.js'
import { SolutionOriginKind, SolutionOrigins } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/solution-origin.js'
import { TargetPickOutcome, type ITargetPicker, type TargetPick } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/target-dialog.js'
import { OriginSelectedSolutionServices } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-seams/origin-selected-solution-services.js'
import { IntegratedSolutionServices } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-seams/integrated-solution-services.js'
import { RemoteSolutionServices } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-seams/remote/remote-solution-services.js'
import { RemoteLanguageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-seams/remote/remote-language-service.js'
import { IpcDevSession } from '@pragmatic-tech-ai/plexus-core/renderer/modules/dev-session/ipc-dev-session.js'
import type { IDevSessionBridge } from '@pragmatic-tech-ai/plexus-core/renderer/modules/dev-session/dev-session-bridge.js'
import { DevStorageSessionKeys } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/dev-storage-session-key.js'
import { DevEnvironmentLocation } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/dev-environment-location.js'
import { RemoteFileStorage } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/remote-file-storage.js'
import { StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/index.js'
import { TargetSource, type TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'

// Drives the open-from-environment round trip with real OpenFromEnvironmentFlow, IpcDevSession,
// RemoteFileStorage, SolutionOriginRegistry/SolutionOrigins, OriginSelectedSolutionServices and
// RemoteSolutionServices/RemoteLanguageService. Two stand-ins: FakeEnvBridge plays the Electron preload
// bridge AND the environment's dev host in one (it answers the RelayReply envelopes the main process
// would relay, keeps the environment's source in memory, records each storage write, and pushes
// GraphChanged after it "recomposes"); FakeManager plays the engine's SolutionManagerService (opening
// a solution rooted in the remote storage). Electron and the socket are not booted.

class Fixture
{
    public static readonly EnvName = 'dev'
    public static readonly SolutionName = 'orders'
    public static readonly ManifestPath = 'orders.pksln'
    public static readonly ManifestText = 'manifest'
    public static readonly MemberPath = 'app/model.todl'
    public static readonly OriginalText = 'entity A;'
    public static readonly EditedText = 'entity A; entity B;'
    public static readonly OpenLog = 'open:'
    public static readonly CloseLog = 'close'
    public static readonly SelectLog = 'select:'
    public static readonly MissingPrefix = 'missing '
    public static readonly ActiveSolutionProperty = 'ActiveSolution'
    public static readonly HostName = 'origin-selected-integration'
    public static readonly RecomposedMember = 'app'
    public static readonly RecomposedFile = 'app/model.todl'
    public static readonly Location = DevEnvironmentLocation.Build(Fixture.EnvName, Fixture.SolutionName)
    public static readonly Ref: TargetRef = { Name: Fixture.EnvName, Source: TargetSource.Platform }
}

class FakeEnvBridge
{
    public readonly Log: string[] = []
    public readonly Writes: Array<{ Path: string; Content: string }> = []
    public readonly Files = new Map<string, string>([[Fixture.ManifestPath, Fixture.ManifestText], [Fixture.MemberPath, Fixture.OriginalText]])
    public Authoring: string | undefined
    private readonly graph: Array<(c: SolutionGraphChangePayload) => void> = []

    public Open(target: TargetRef): Promise<unknown> { this.Log.push(Fixture.OpenLog + target.Name); return FakeEnvBridge.Ok(undefined) }
    public Close(): Promise<unknown> { this.Log.push(Fixture.CloseLog); return FakeEnvBridge.Ok(undefined) }

    public SelectAuthoring(id: string): Promise<unknown>
    {
        this.Log.push(Fixture.SelectLog + id)
        this.Authoring = id
        return FakeEnvBridge.Ok({ solutionId: id })
    }

    public ReadText(path: string): Promise<unknown>
    {
        const text = this.Files.get(path)
        return Promise.resolve(text === undefined ? { Ok: false, Error: { Message: Fixture.MissingPrefix + path } } : { Ok: true, Value: text })
    }

    public WriteText(path: string, content: string): Promise<unknown>
    {
        this.Writes.push({ Path: path, Content: content })
        this.Files.set(path, content)
        this.Recompose()
        return FakeEnvBridge.Ok(undefined)
    }

    public ActiveSolution(): Promise<unknown> { return FakeEnvBridge.Ok(null) }

    public OnGraphChanged(handler: (c: SolutionGraphChangePayload) => void): () => void
    {
        this.graph.push(handler)
        return () => { this.graph.splice(this.graph.indexOf(handler), 1) }
    }

    public OnBuildStateChanged(_h: (p: BuildStateChangedPayload) => void): () => void { return () => undefined }
    public OnDiagnostics(_h: (p: PublishDiagnosticsParams) => void): () => void { return () => undefined }
    public OnChanged(_h: (c: StorageChangedPayload) => void): () => void { return () => undefined }

    // The server recomposed the shared graph: every subscribed client is pushed the change.
    public Recompose(): void
    {
        for (const handler of [...this.graph]) handler({ memberIds: [Fixture.RecomposedMember], fileIds: [Fixture.RecomposedFile] })
    }

    public get Subscribers(): number { return this.graph.length }

    public AsBridge(): IDevSessionBridge { return this as unknown as IDevSessionBridge }

    private static Ok(value: unknown): Promise<unknown> { return Promise.resolve({ Ok: true, Value: value }) }
}

class FakeManager extends Observable implements IOpenFromEnvManager
{
    public Manifest: string | undefined
    private active: Solution | undefined

    public constructor(private readonly session: IpcDevSession)
    {
        super()
    }

    public get ActiveSolution(): Solution | undefined { return this.active }

    public async OpenSolution(location: string): Promise<void>
    {
        const root = DevEnvironmentLocation.RootOf(location)
        const storage = new RemoteFileStorage(this.session, root)
        this.Manifest = await storage.ReadText(Fixture.ManifestPath)
        const next = new Solution(root, storage)
        const old = this.active
        this.active = next
        this.RaisePropertyChanged(Fixture.ActiveSolutionProperty, old, next)
    }

    public async CloseSolution(): Promise<void>
    {
        const old = this.active
        this.active = undefined
        this.RaisePropertyChanged(Fixture.ActiveSolutionProperty, old, undefined)
    }
}

class ChosenPicker implements ITargetPicker
{
    public Show(): Promise<TargetPick>
    {
        return Promise.resolve({ Outcome: TargetPickOutcome.Chosen, Choice: { Environment: Fixture.EnvName, Source: TargetSource.Platform, SolutionName: Fixture.SolutionName } } as TargetPick)
    }

    public RequestSignIn(): Promise<boolean> { return Promise.resolve(false) }
}

class Rig
{
    public readonly Server = new FakeEnvBridge()
    public readonly Session = new IpcDevSession(this.Server.AsBridge())
    public readonly Manager = new FakeManager(this.Session)
    public readonly Registry = new SolutionOriginRegistry()
    public readonly Provider = new ShellCompositionRoot(new HostKind(Fixture.HostName)).Provider
    public readonly Services: OriginSelectedSolutionServices
    public readonly Flow: OpenFromEnvironmentFlow
    public readonly LocalLanguage = {}

    public constructor()
    {

        this.Provider.registerInstance(SolutionManagerService.Key, this.Manager as unknown as SolutionManagerService)
        this.Provider.registerInstance(SolutionLanguageService.Key, this.LocalLanguage as unknown as SolutionLanguageService)
        // Intentionally inert: this path never touches the local StorageService (Remote storage comes from the session).
        this.Provider.registerInstance(StorageService.Key, {} as unknown as StorageService)
        this.Provider.registerInstance(DevStorageSessionKeys.Session, this.Session)
        this.Provider.registerInstance(SolutionOriginRegistry.Key, this.Registry)
        this.Services = new OriginSelectedSolutionServices(this.Provider)
        this.Flow = new OpenFromEnvironmentFlow(() => new ChosenPicker(), this.Session, this.Manager, this.Registry, undefined)
    }
}

describe('open from dev environment integration (flow -> IpcDevSession -> fake environment)', () =>
{
    it('opens the picked solution through the held session: bind, select authoring, read over remote storage', async () =>
    {
        const rig = new Rig()
        expect(rig.Services.Current).toBeInstanceOf(IntegratedSolutionServices)
        await rig.Flow.Run()
        expect(rig.Server.Log).toEqual([Fixture.OpenLog + Fixture.EnvName, Fixture.SelectLog + Fixture.SolutionName])
        expect(rig.Manager.Manifest).toBe(Fixture.ManifestText)
        expect(rig.Manager.ActiveSolution!.Storage).toBeInstanceOf(RemoteFileStorage)
        rig.Flow.dispose()
    })

    it('labels the opened solution as DevEnvironment', async () =>
    {
        const rig = new Rig()
        await rig.Flow.Run()
        const origin = SolutionOrigins.Of(rig.Manager.ActiveSolution!, rig.Registry)
        expect(origin.Kind).toBe(SolutionOriginKind.DevEnvironment)
        expect(origin).toMatchObject({ EnvironmentName: Fixture.EnvName, SolutionName: Fixture.SolutionName, EnvironmentRef: Fixture.Ref })
        expect(SolutionOrigins.ActiveLabel(rig.Manager as never, rig.Registry)).toBe(SolutionOrigins.Label(origin))
        rig.Flow.dispose()
    })

    it('resolves SolutionServices.Key to RemoteSolutionServices with the remote language service (not the in-proc one)', async () =>
    {
        const rig = new Rig()
        await rig.Flow.Run()
        expect(rig.Services.Current).toBeInstanceOf(RemoteSolutionServices)
        expect(rig.Services.Language).toBeInstanceOf(RemoteLanguageService)
        expect(rig.Services.Language).not.toBe(rig.LocalLanguage)
        rig.Flow.dispose()
    })

    it('writes an edited .todl through the remote storage and reads it back', async () =>
    {
        const rig = new Rig()
        await rig.Flow.Run()
        const storage = rig.Manager.ActiveSolution!.Storage!
        expect(await storage.ReadText(Fixture.MemberPath)).toBe(Fixture.OriginalText)
        await storage.WriteText(Fixture.MemberPath, Fixture.EditedText)
        expect(rig.Server.Writes).toEqual([{ Path: Fixture.MemberPath, Content: Fixture.EditedText }])
        expect(rig.Server.Files.get(Fixture.MemberPath)).toBe(Fixture.EditedText)
        expect(await storage.ReadText(Fixture.MemberPath)).toBe(Fixture.EditedText)
        rig.Flow.dispose()
    })

    it('delivers the server GraphChanged push to RemoteLanguageService after a recompose', async () =>
    {
        const rig = new Rig()
        await rig.Flow.Run()
        const language = rig.Services.Language as RemoteLanguageService
        const seen: SolutionGraphChangePayload[] = []
        language.GraphChanged.subscribe(change => seen.push(change as SolutionGraphChangePayload))
        expect(language.GraphRevision).toBe(0)
        // A save on the shared environment recomposes it; so does an explicit server-side recompose.
        await rig.Manager.ActiveSolution!.Storage!.WriteText(Fixture.MemberPath, Fixture.EditedText)
        rig.Server.Recompose()
        expect(seen).toHaveLength(2)
        expect(seen[0]).toEqual({ memberIds: [Fixture.RecomposedMember], fileIds: [Fixture.RecomposedFile] })
        expect(language.GraphRevision).toBe(2)
        rig.Flow.dispose()
    })

    it('stops listening to pushes once the dev solution is closed', async () =>
    {
        const rig = new Rig()
        await rig.Flow.Run()
        expect(rig.Services.Current).toBeInstanceOf(RemoteSolutionServices)
        expect(rig.Server.Subscribers).toBe(1)
        await rig.Manager.CloseSolution()
        expect(rig.Services.Current).toBeInstanceOf(IntegratedSolutionServices)
        expect(rig.Server.Subscribers).toBe(0)
        rig.Flow.dispose()
    })
})
