import type { StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { DevelopSession } from '../account/develop-session.js'
import type { IRelayConnector } from '../account/relay-connector.js'

// Owns the one held develop session of the app: Open replaces any earlier one, Close drops it. Storage
// changes of the current session fan out to the handlers registered with OnChanged.
export class DevSessionHost
{
    private static readonly NotOpen = 'No development environment is open.'

    private chain: Promise<void> = Promise.resolve()
    private current: DevelopSession | undefined
    private unsubscribe: (() => void) | undefined
    private readonly handlers = new Set<(change: StorageChangedPayload) => void>()

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
        this.current = session
        this.unsubscribe = session.OnStorageChanged(change =>
        {
            for (const handler of this.handlers) handler(change)
        })
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
}
