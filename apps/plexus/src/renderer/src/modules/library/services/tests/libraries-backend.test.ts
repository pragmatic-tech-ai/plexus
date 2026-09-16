import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { ensureLibrariesBackend, LIBRARIES_BACKEND_ID } from '../libraries-backend.js'

function providerWith(): ServiceProvider
{
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, {} as unknown as FileSystemService)
    provider.registerInstance(
        EnvironmentService.Key,
        { UserDataDirectory: '/data', PathSeparator: '/' } as unknown as EnvironmentService,
    )
    provider.registerInstance(StorageProviderRegistry.Key, new StorageProviderRegistry(provider))
    return provider
}

test('registers the libraries backend once and roots it under userData', () => {
    const provider = providerWith()
    const registry = provider.getRequired(StorageProviderRegistry.Key)

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
