import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { FileSystemService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { EnvironmentService } from '@pragmatic-tech-ai/plexus-core/renderer/environment/environment-service.js'
import { ensureLibrariesBackend, LIBRARIES_BACKEND_ID } from '../libraries-backend.js'

function providerWith(): ServiceProvider
{
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, {} as unknown as FileSystemService)
    provider.registerInstance(
        EnvironmentService.Key,
        { UserDataDirectory: '/data', PathSeparator: '/' } as unknown as EnvironmentService,
    )
    provider.registerInstance(StorageService.Key, new StorageService(provider))
    return provider
}

test('registers the libraries backend once and roots it under userData', () => {
    const provider = providerWith()
    const registry = provider.getRequired(StorageService.Key)

    let registrations = 0
    const realRegister = registry.Register.bind(registry)
    registry.Register = ((id: string, f) => { registrations++; return realRegister(id, f) }) as typeof registry.Register

    const a = ensureLibrariesBackend(provider)
    const b = ensureLibrariesBackend(provider)

    expect(registrations).toBe(1)                       // idempotent
    expect(registry.Has(LIBRARIES_BACKEND_ID)).toBe(true)
    expect(a.Root).toBe('/data/libraries')
    expect(b.Root).toBe(a.Root)
})
