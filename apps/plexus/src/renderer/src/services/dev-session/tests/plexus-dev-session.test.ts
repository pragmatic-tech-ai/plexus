import { afterEach, describe, expect, it } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { IpcDevSession } from '@pragmatic-tech-ai/plexus-core/renderer/modules/dev-session'
import type { IRemoteLanguageSession } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-seams/remote/remote-language-service.js'
import type { IDevStorageSession } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/remote-file-storage.js'
import { DevStorageSessionKeys } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/dev-storage-session-key.js'
import PlexusDevSession from '../plexus-dev-session.js'

class Globals
{
    public static Set(api: unknown): void
    {
        (globalThis as unknown as { api?: unknown }).api = api
    }
}

describe('PlexusDevSession', () =>
{
    afterEach(() => Globals.Set(undefined))

    it('is filed under DevStorageSessionKeys.Session', () =>
    {
        expect(PlexusDevSession.Key).toBe(DevStorageSessionKeys.Session)
    })

    it('resolves as the IpcDevSession and satisfies both seams', () =>
    {
        Globals.Set({ devSession: {} })
        const provider = new ServiceProvider()
        provider.register(PlexusDevSession.Key, () => new PlexusDevSession())
        const session = provider.getRequired(DevStorageSessionKeys.Session)
        const asLanguage: IRemoteLanguageSession = session
        const asStorage: IDevStorageSession = session
        expect(asLanguage).toBe(asStorage)
        expect(session).toBeInstanceOf(IpcDevSession)
    })

    it('fails clearly without the preload bridge', () =>
    {
        expect(() => new PlexusDevSession()).toThrow(/window\.api\.devSession is unavailable/)
    })
})
