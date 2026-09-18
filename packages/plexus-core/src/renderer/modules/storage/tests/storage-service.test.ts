import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { StorageService } from '../storage-service.js'
import { FileSystemService } from '../file-system-service.js'
import { LocalFileStorage } from '../local-file-storage.js'

// A StorageService with a fake FileSystemService registered, so the built-in
// 'local' provider (LocalFileStorage over the native seam) resolves in a headless
// test. LocalFileStorage's ctor only stores root + fs, so an empty stand-in fs is
// enough to exercise the registry mechanics.
function serviceWithFakeFs(): StorageService
{
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, {} as unknown as FileSystemService)
    return new StorageService(provider)
}

test('the built-in local provider is registered by the ctor', () => {
    expect(serviceWithFakeFs().Has(StorageService.DefaultBackendId)).toBe(true)
})

test('Create(local, folder) builds a LocalFileStorage over FileSystemService', () => {
    expect(serviceWithFakeFs().Create(StorageService.DefaultBackendId, '/root/p')).toBeInstanceOf(LocalFileStorage)
})

test('CreateStorage uses the default (local) provider', () => {
    expect(serviceWithFakeFs().CreateStorage('/root/p')).toBeInstanceOf(LocalFileStorage)
})

test('an unknown backend id throws', () => {
    expect(() => serviceWithFakeFs().Create('cloud', 'x')).toThrow('Unknown storage backend "cloud".')
})

test('a custom provider can be registered and resolved', () => {
    const service = serviceWithFakeFs()
    const fake = new FakeStorage('mem://x')
    service.Register('memory', () => fake)
    expect(service.Has('memory')).toBe(true)
    expect(service.Create('memory', 'ignored')).toBe(fake)
})

test('the service constructs without FileSystemService (host-agnostic until local is used)', () => {
    // No FileSystemService registered: constructing + registering 'local' is fine;
    // the native bridge is only demanded when 'local' storage is actually built.
    const service = new StorageService(new ServiceProvider())
    expect(service.Has(StorageService.DefaultBackendId)).toBe(true)
    expect(() => service.Create(StorageService.DefaultBackendId, '/root/p')).toThrow()
})
