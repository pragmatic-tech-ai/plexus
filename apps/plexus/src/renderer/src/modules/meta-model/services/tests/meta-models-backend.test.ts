import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { StorageProviderRegistry } from '../../../../services/storage/storage-provider-registry.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { ensureMetaModelsBackend, META_MODELS_BACKEND_ID } from '../meta-models-backend.js'

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

test('registers the meta-models backend once and roots it under userData', () => {
    const provider = providerWith()
    const registry = provider.getRequired(StorageProviderRegistry.Key)

    let registrations = 0
    const realRegister = registry.Register.bind(registry)
    registry.Register = ((id: string, f) => { registrations++; return realRegister(id, f) }) as typeof registry.Register

    const a = ensureMetaModelsBackend(provider)
    const b = ensureMetaModelsBackend(provider)

    expect(registrations).toBe(1)                       // idempotent
    expect(registry.Has(META_MODELS_BACKEND_ID)).toBe(true)
    expect(a.Root).toBe('/data/meta-models')
    expect(b.Root).toBe(a.Root)
})
