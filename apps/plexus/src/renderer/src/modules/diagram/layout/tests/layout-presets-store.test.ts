import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { PipelineConfiguration } from '@pragmatic-tech-ai/fresco'

import { EnvironmentService } from '../../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../../services/file-system/file-system-service.js'
import { LayoutPresetsStore } from '../layout-presets-store.js'

// An in-memory FileSystemService covering only the methods the store uses.
// Keys are absolute file paths; ListDirectory returns the immediate children
// of a directory path.
function fakeFs(): { fs: FileSystemService; files: Map<string, string> } {
    const files = new Map<string, string>()
    const fs = {
        CreateDirectory: (_p: string) => Promise.resolve(),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
        ReadText: (p: string) => files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error('ENOENT')),
        Delete: (p: string) => { files.delete(p); return Promise.resolve() },
        ListDirectory: (dir: string) => {
            const prefix = dir.endsWith('/') ? dir : dir + '/'
            const entries = [...files.keys()]
                .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
                .map((k) => ({ Name: k.slice(prefix.length), IsDirectory: false }))
            return Promise.resolve(entries)
        },
    } as unknown as FileSystemService
    return { fs, files }
}

function storeWith(fs: FileSystemService): LayoutPresetsStore {
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, fs)
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    return new LayoutPresetsStore(provider)
}

const cfg = (name: string): PipelineConfiguration => ({ name, transforms: [], layout: {} })

test('save then get round-trips a preset; names lists the stem', async () => {
    const s = storeWith(fakeFs().fs)
    const stem = await s.save('Wide', cfg('Wide'))
    expect(stem).toBe('Wide')
    expect(await s.names()).toEqual(['Wide'])
    expect(await s.get('Wide')).toEqual(cfg('Wide'))
})

test('names returns the stems sorted', async () => {
    const s = storeWith(fakeFs().fs)
    await s.save('beta', cfg('beta'))
    await s.save('alpha', cfg('alpha'))
    expect(await s.names()).toEqual(['alpha', 'beta'])
})

test('names is [] when the presets folder has never been written', async () => {
    // ListDirectory of a never-created folder rejects; the store swallows it.
    const rejecting = { ListDirectory: () => Promise.reject(new Error('ENOENT')) } as unknown as FileSystemService
    expect(await storeWith(rejecting).names()).toEqual([])
})

test('get returns undefined for a missing preset', async () => {
    const s = storeWith(fakeFs().fs)
    expect(await s.get('nope')).toBeUndefined()
})

test('save sanitizes an unsafe name; the stem round-trips as the display name', async () => {
    const { fs, files } = fakeFs()
    const s = new LayoutPresetsStore((() => {
        const p = new ServiceProvider()
        p.registerInstance(FileSystemService.Key, fs)
        p.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
        return p
    })())
    const stem = await s.save('a/b c', cfg('x'))
    expect(stem).toBe('a-b-c')
    expect([...files.keys()]).toEqual(['/data/layout-presets/a-b-c.json'])
    expect(await s.names()).toEqual(['a-b-c'])
    expect(await s.get('a-b-c')).toEqual(cfg('x'))
})

test('delete removes a preset and tolerates a second delete', async () => {
    const s = storeWith(fakeFs().fs)
    await s.save('gone', cfg('gone'))
    await s.delete('gone')
    expect(await s.names()).toEqual([])
    await s.delete('gone')   // absent now — must not throw
})
