import type { BuildStateChangedPayload, PublishDiagnosticsParams, SolutionGraphChangePayload, StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { DevelopSession } from '../account/develop-session.js'
import type { IRelayConnector } from '../account/relay-connector.js'

// Owns the one held develop session of the app: Open replaces any earlier one, Close drops it. Storage
// changes of the current session fan out to the handlers registered with OnChanged; its graph, build-state
// and diagnostics pushes fan out to those registered with OnGraphChanged / OnBuildStateChanged / OnDiagnostics.
export class DevSessionHost
{
    private static readonly NotOpen = 'No development environment is open.'

    private chain: Promise<void> = Promise.resolve()
    private current: DevelopSession | undefined
    private unsubscribe: (() => void) | undefined
    private readonly handlers = new Set<(change: StorageChangedPayload) => void>()
    private readonly graphHandlers = new Set<(change: SolutionGraphChangePayload) => void>()
    private readonly buildHandlers = new Set<(payload: BuildStateChangedPayload) => void>()
    private readonly diagnosticHandlers = new Set<(params: PublishDiagnosticsParams) => void>()

    public constructor(private readonly connector: IRelayConnector)
    {
    }

    // Open and Close run one at a time, in call order, so overlapping calls can never orphan a
    // connection or its subscription (a Close during an Open waits for it, then closes it).
    public Open(target: TargetRef): Promise<void>
    {
        return this.Serialize(() => this.OpenNow(target))
    }

    public Close(): Promise<void>
    {
        return this.Serialize(() => this.CloseNow())
    }

    private Serialize(work: () => Promise<void>): Promise<void>
    {
        const run = this.chain.then(work)
        this.chain = run.catch(() => undefined)
        return run
    }

    private async OpenNow(target: TargetRef): Promise<void>
    {
        await this.CloseNow()
        const session = await DevelopSession.Connect(this.connector, target)
        // Subscribe before committing: a subscription that throws must not leave the ones already made
        // live or the session half-wired, so they are disposed (and the connection closed) and it rethrows.
        const offs: Array<() => void> = []
        try
        {
            offs.push(session.OnStorageChanged(change =>
            {
                for (const handler of this.handlers) handler(change)
            }))
            offs.push(session.OnGraphChanged(change =>
            {
                for (const handler of this.graphHandlers) handler(change)
            }))
            offs.push(session.OnBuildStateChanged(payload =>
            {
                for (const handler of this.buildHandlers) handler(payload)
            }))
            offs.push(session.OnDiagnostics(params =>
            {
                for (const handler of this.diagnosticHandlers) handler(params)
            }))
        }
        catch (e)
        {
            for (const off of offs) off()
            await session.Dispose()
            throw e
        }
        this.current = session
        this.unsubscribe = () =>
        {
            for (const off of offs) off()
        }
    }

    private async CloseNow(): Promise<void>
    {
        const session = this.current
        this.current = undefined
        this.unsubscribe?.()
        this.unsubscribe = undefined
        await session?.Dispose()
    }

    public get Session(): DevelopSession
    {
        if (this.current === undefined) throw new Error(DevSessionHost.NotOpen)
        return this.current
    }

    public OnChanged(handler: (change: StorageChangedPayload) => void): () => void
    {
        this.handlers.add(handler)
        return () => { this.handlers.delete(handler) }
    }

    public OnGraphChanged(handler: (change: SolutionGraphChangePayload) => void): () => void
    {
        this.graphHandlers.add(handler)
        return () => { this.graphHandlers.delete(handler) }
    }

    public OnBuildStateChanged(handler: (payload: BuildStateChangedPayload) => void): () => void
    {
        this.buildHandlers.add(handler)
        return () => { this.buildHandlers.delete(handler) }
    }

    public OnDiagnostics(handler: (params: PublishDiagnosticsParams) => void): () => void
    {
        this.diagnosticHandlers.add(handler)
        return () => { this.diagnosticHandlers.delete(handler) }
    }
}
