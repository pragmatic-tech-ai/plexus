import type { StorageEntry } from '@pragmatic-tech-ai/todl-runtime'
import type { ActiveSolutionSummary, BuildStateChangedPayload, PublishDiagnosticsParams, SolutionGraphChangePayload, StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import type { IDevStorageSession } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/remote-file-storage.js'
import type { DevSessionRequests, IDevSessionPushes } from '@pragmatic-tech-ai/plexus-core/renderer/modules/dev-session/dev-session-surface.js'
import { RelayAction, type IRelayConnector, type RelayClient } from './relay-connector.js'

// Bounds how many requests run at once; the excess waits in arrival order and starts as earlier
// requests finish (whether they resolve or reject).
export class RequestSerializer
{
    private active = 0
    private readonly queue: Array<() => void> = []

    public constructor(private readonly limit: number)
    {
    }

    public async Run<T>(work: () => Promise<T>): Promise<T>
    {
        if (this.active >= this.limit) await new Promise<void>(resolve => this.queue.push(resolve))
        else this.active++
        try
        {
            return await work()
        }
        finally
        {
            const next = this.queue.shift()
            if (next === undefined) this.active--
            else next()
        }
    }
}

// The held develop session: one relay connection kept open for a dev environment, driving its source
// storage. Every storage request goes through a serializer that stays below the relay pipe's pending cap.
// Language / model / solution requests bypass it and run concurrently; DidChange is handed to the relay
// in call order without waiting on any answer.
export class DevelopSession implements IDevStorageSession, DevSessionRequests, IDevSessionPushes
{
    // COUPLED to the server: 31 = RelayPipe.MaxPending (32) - 1, from the pragmatic-server control-plane
    // relay pipe, which refuses beyond MaxPending in flight. No shared constant is exported yet, so this
    // number must be kept in step with that cap by hand.
    public static readonly MaxInFlight = 31

    private readonly serializer = new RequestSerializer(DevelopSession.MaxInFlight)
    private disposed: Promise<void> | undefined

    public constructor(private readonly client: RelayClient)
    {
    }

    public static async Connect(connector: IRelayConnector, target: TargetRef): Promise<DevelopSession>
    {
        return new DevelopSession(await connector.Connect(target, RelayAction.Develop))
    }

    public ReadText(path: string): Promise<string>
    {
        return this.serializer.Run(() => this.client.StorageReadText(path))
    }

    public ReadBytes(path: string): Promise<Uint8Array>
    {
        return this.serializer.Run(() => this.client.StorageReadBytes(path))
    }

    public WriteText(path: string, content: string): Promise<void>
    {
        return this.serializer.Run(() => this.client.StorageWriteText(path, content))
    }

    public WriteBytes(path: string, bytes: Uint8Array): Promise<void>
    {
        return this.serializer.Run(() => this.client.StorageWriteBytes(path, bytes))
    }

    public Exists(path: string): Promise<boolean>
    {
        return this.serializer.Run(() => this.client.StorageExists(path))
    }

    public Delete(path: string): Promise<void>
    {
        return this.serializer.Run(() => this.client.StorageDelete(path))
    }

    public CreateDirectory(path: string): Promise<void>
    {
        return this.serializer.Run(() => this.client.StorageCreateDirectory(path))
    }

    public Rename(from: string, to: string): Promise<void>
    {
        return this.serializer.Run(() => this.client.StorageRename(from, to))
    }

    public List(path: string): Promise<readonly StorageEntry[]>
    {
        return this.serializer.Run(() => this.client.StorageList(path))
    }

    // A subscription, not a request: it bypasses the serializer.
    public OnStorageChanged(handler: (change: StorageChangedPayload) => void): () => void
    {
        const subscription = this.client.OnStorageChanged(handler)
        return () => subscription.dispose()
    }

    public OnGraphChanged(handler: (change: SolutionGraphChangePayload) => void): () => void
    {
        const subscription = this.client.OnGraphChanged(handler)
        return () => subscription.dispose()
    }

    public OnBuildStateChanged(handler: (payload: BuildStateChangedPayload) => void): () => void
    {
        const subscription = this.client.OnBuildStateChanged(handler)
        return () => subscription.dispose()
    }

    public OnDiagnostics(handler: (params: PublishDiagnosticsParams) => void): () => void
    {
        const subscription = this.client.OnDiagnostics(handler)
        return () => subscription.dispose()
    }

    public SelectAuthoring(solutionId: string): Promise<ActiveSolutionSummary>
    {
        return this.client.SelectAuthoring({ SolutionId: solutionId })
    }

    public ListSolutions(...args: Parameters<DevSessionRequests['ListSolutions']>): ReturnType<DevSessionRequests['ListSolutions']>
    {
        return this.client.ListSolutions(...args)
    }

    public ActiveSolution(...args: Parameters<DevSessionRequests['ActiveSolution']>): ReturnType<DevSessionRequests['ActiveSolution']>
    {
        return this.client.ActiveSolution(...args)
    }

    public CompletionsAt(...args: Parameters<DevSessionRequests['CompletionsAt']>): ReturnType<DevSessionRequests['CompletionsAt']>
    {
        return this.client.CompletionsAt(...args)
    }

    public HoverAt(...args: Parameters<DevSessionRequests['HoverAt']>): ReturnType<DevSessionRequests['HoverAt']>
    {
        return this.client.HoverAt(...args)
    }

    public DefinitionAt(...args: Parameters<DevSessionRequests['DefinitionAt']>): ReturnType<DevSessionRequests['DefinitionAt']>
    {
        return this.client.DefinitionAt(...args)
    }

    public ReferencesAt(...args: Parameters<DevSessionRequests['ReferencesAt']>): ReturnType<DevSessionRequests['ReferencesAt']>
    {
        return this.client.ReferencesAt(...args)
    }

    public PrepareRename(...args: Parameters<DevSessionRequests['PrepareRename']>): ReturnType<DevSessionRequests['PrepareRename']>
    {
        return this.client.PrepareRename(...args)
    }

    public RenameEdits(...args: Parameters<DevSessionRequests['RenameEdits']>): ReturnType<DevSessionRequests['RenameEdits']>
    {
        return this.client.RenameEdits(...args)
    }

    public DocumentSymbols(...args: Parameters<DevSessionRequests['DocumentSymbols']>): ReturnType<DevSessionRequests['DocumentSymbols']>
    {
        return this.client.DocumentSymbols(...args)
    }

    public FoldingRanges(...args: Parameters<DevSessionRequests['FoldingRanges']>): ReturnType<DevSessionRequests['FoldingRanges']>
    {
        return this.client.FoldingRanges(...args)
    }

    public WorkspaceSymbols(...args: Parameters<DevSessionRequests['WorkspaceSymbols']>): ReturnType<DevSessionRequests['WorkspaceSymbols']>
    {
        return this.client.WorkspaceSymbols(...args)
    }

    public SemanticTokens(...args: Parameters<DevSessionRequests['SemanticTokens']>): ReturnType<DevSessionRequests['SemanticTokens']>
    {
        return this.client.SemanticTokens(...args)
    }

    public SignatureHelpAt(...args: Parameters<DevSessionRequests['SignatureHelpAt']>): ReturnType<DevSessionRequests['SignatureHelpAt']>
    {
        return this.client.SignatureHelpAt(...args)
    }

    public CodeActions(...args: Parameters<DevSessionRequests['CodeActions']>): ReturnType<DevSessionRequests['CodeActions']>
    {
        return this.client.CodeActions(...args)
    }

    public FormatDocument(...args: Parameters<DevSessionRequests['FormatDocument']>): ReturnType<DevSessionRequests['FormatDocument']>
    {
        return this.client.FormatDocument(...args)
    }

    public DiagnosticsFor(...args: Parameters<DevSessionRequests['DiagnosticsFor']>): ReturnType<DevSessionRequests['DiagnosticsFor']>
    {
        return this.client.DiagnosticsFor(...args)
    }

    public ModelView(...args: Parameters<DevSessionRequests['ModelView']>): ReturnType<DevSessionRequests['ModelView']>
    {
        return this.client.ModelView(...args)
    }

    public Resources(...args: Parameters<DevSessionRequests['Resources']>): ReturnType<DevSessionRequests['Resources']>
    {
        return this.client.Resources(...args)
    }

    public async DidChange(uri: string, text: string): Promise<void>
    {
        this.client.DidChange(uri, text)
    }

    // Closes the connection once; later calls return the same close. Requests still queued are not
    // drained or rejected here: they dispatch to the closed client when their turn comes and reject there.
    public Dispose(): Promise<void>
    {
        this.disposed ??= this.client.DisposeAsync()
        return this.disposed
    }
}
