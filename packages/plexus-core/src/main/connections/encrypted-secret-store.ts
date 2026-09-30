/**
 * `EncryptedSecretStore` — the engine's `ISecretStore`, backed by `ConnectionTokenStore`
 * (per-connection tokens encrypted at rest, keyed by connection id). An async adapter over
 * the synchronous token store; the token never crosses the IPC bridge.
 *
 * Promoted from apps/devUI into plexus-core.
 */
import { type ISecretStore } from '@pragmatic-tech-ai/todl/package-manager'
import type { ConnectionTokenStore } from './connection-token-store.js'

export class EncryptedSecretStore implements ISecretStore
{
    constructor(private readonly tokens: ConnectionTokenStore)
    {
    }

    public async Get(key: string): Promise<string | undefined>
    {
        const token = this.tokens.GetToken(key)
        return token.length > 0 ? token : undefined
    }

    public async Set(key: string, secret: string): Promise<void>
    {
        this.tokens.SetToken(key, secret)
    }

    public async Delete(key: string): Promise<void>
    {
        this.tokens.Clear(key)
    }
}
