import type { StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { TargetRef } from '@pragmatic-tech-ai/plexus-core/shared/account-api.js'
import { DevelopSession } from '../account/develop-session.js'
import type { IRelayConnector } from '../account/relay-connector.js'

// Owns the one held develop session of the app: Open replaces any earlier one, Close drops it. Storage
// changes of the current session fan out to the handlers registered with OnChanged.
export class DevSessionHost
{
    private static readonly NotOpen = 'No development environment is open.'

    private current: DevelopSession | undefined
    private unsubscribe: (() => void) | undefined
    private readonly handlers = new Set<(change: StorageChangedPayload) => void>()

    public constructor(private readonly connector: IRelayConnector)
    {
    }

    public async Open(target: TargetRef): Promise<void>
    {
        await this.Close()
        const session = await DevelopSession.Connect(this.connector, target)
        this.current = session
        this.unsubscribe = session.OnStorageChanged(change =>
        {
            for (const handler of this.handlers) handler(change)
        })
    }

    public async Close(): Promise<void>
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
