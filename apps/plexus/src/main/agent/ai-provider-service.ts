// The provider registry: holds AI providers by id and names the active one. v1
// registers only ClaudeCliProvider; this is the single insertion point for an
// API-key/SDK provider later.
import type { IAiProvider } from './ai-provider.js'

export class AiProviderService
{
    private readonly providers = new Map<string, IAiProvider>()
    private activeId: string | undefined = undefined

    public register(provider: IAiProvider): void
    {
        this.providers.set(provider.Id, provider)
        if (this.activeId === undefined) this.activeId = provider.Id
    }

    public setActive(id: string): void
    {
        if (!this.providers.has(id)) throw new Error(`AiProviderService: no provider registered with id "${id}"`)
        this.activeId = id
    }

    public active(): IAiProvider
    {
        const provider = this.activeId !== undefined ? this.providers.get(this.activeId) : undefined
        if (provider === undefined) throw new Error('AiProviderService: no active provider registered')
        return provider
    }
}
