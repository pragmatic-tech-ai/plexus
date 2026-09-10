import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { FileSystemService } from '../../file-system/file-system-service.js'
import { LocalFileStorage } from '../local-file-storage.js'
import { StorageProviderRegistry } from '../storage-provider-registry.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

// Build a provider carrying a stub FileSystemService (the local backend factory
// resolves it lazily, only when Create('local', …) runs).
function provider(): ServiceProvider
{
    const p = new ServiceProvider()
    p.registerInstance(FileSystemService.Key, {} as unknown as FileSystemService)
    return p
}

test("the 'local' backend is registered out of the box", () => {
    const reg = new StorageProviderRegistry(provider())
    expect(reg.Has(StorageProviderRegistry.DefaultBackendId)).toBe(true)
})

test("Create('local', folder) builds a LocalFileStorage rooted there", () => {
    const reg = new StorageProviderRegistry(provider())
    const storage = reg.Create('local', '/root/proj')
    expect(storage).toBeInstanceOf(LocalFileStorage)
    expect(storage.Root).toBe('/root/proj')
})

test('an unknown backend id throws', () => {
    const reg = new StorageProviderRegistry(provider())
    expect(() => reg.Create('cloud', 'x')).toThrow('Unknown storage backend "cloud".')
})

test('a custom backend can be registered and resolved', () => {
    const reg = new StorageProviderRegistry(provider())
    const fake = new FakeStorage('mem://x')
    reg.Register('memory', () => fake)
    expect(reg.Has('memory')).toBe(true)
    expect(reg.Create('memory', 'ignored')).toBe(fake)
})
