import { test, expect } from 'vitest'
import type { PipelineConfiguration } from '@pragmatic-tech-ai/fresco'
import type { IStorage, StorageEntry } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectLayoutPresetsStore } from '../project-layout-presets-store.js'

function cfg(name: string): PipelineConfiguration {
    return { name, transforms: ['MakeAcyclicTransform'], layout: {} }
}

// An in-memory IStorage: project-relative POSIX paths → file contents. Only the
// methods the store touches are implemented; the rest throw if used.
function memStorage(seed: Record<string, string> = {}): IStorage {
    const files = new Map<string, string>(Object.entries(seed))
    return {
        Root: 'mem',
        ReadText: (p) => files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error('ENOENT')),
        WriteText: (p, c) => { files.set(p, c); return Promise.resolve() },
        Delete: (p) => { files.delete(p); return Promise.resolve() },
        CreateDirectory: () => Promise.resolve(),
        List: (dir) => {
            const prefix = dir.endsWith('/') ? dir : dir + '/'
            const out: StorageEntry[] = [...files.keys()]
                .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
                .map((k) => ({ Name: k.slice(prefix.length), IsDirectory: false }))
            return Promise.resolve(out)
        },
    } as unknown as IStorage
}

test('save then get round-trips a preset under .plexus/layout-presets', async () => {
    const storage = memStorage()
    const store = new ProjectLayoutPresetsStore(storage)
    const stem = await store.save('flow', cfg('flow'))
    expect(stem).toBe('flow')
    expect(await storage.ReadText('.plexus/layout-presets/flow.json')).toContain('"flow"')
    expect(await store.get('flow')).toEqual(cfg('flow'))
})

test('names lists the saved stems, sorted, and ignores non-json', async () => {
    const store = new ProjectLayoutPresetsStore(memStorage({
        '.plexus/layout-presets/b.json': JSON.stringify(cfg('b')),
        '.plexus/layout-presets/a.json': JSON.stringify(cfg('a')),
        '.plexus/layout-presets/readme.txt': 'x',
    }))
    expect(await store.names()).toEqual(['a', 'b'])
})

test('save sanitizes the name into a file-safe stem', async () => {
    const storage = memStorage()
    const stem = await new ProjectLayoutPresetsStore(storage).save('my flow!', cfg('x'))
    expect(stem).toBe('my-flow-')
    expect(await storage.ReadText('.plexus/layout-presets/my-flow-.json')).toBeTruthy()
})

test('delete removes the file; missing names and folders are tolerated', async () => {
    const storage = memStorage({ '.plexus/layout-presets/a.json': JSON.stringify(cfg('a')) })
    const store = new ProjectLayoutPresetsStore(storage)
    await store.delete('a')
    expect(await store.names()).toEqual([])
    await store.delete('missing')   // no throw
})

test('names degrades to [] and get to undefined on a missing folder', async () => {
    const store = new ProjectLayoutPresetsStore(memStorage())
    expect(await store.names()).toEqual([])
    expect(await store.get('nope')).toBeUndefined()
})
