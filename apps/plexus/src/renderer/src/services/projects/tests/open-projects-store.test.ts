import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { EnvironmentService } from '../../environment/environment-service.js'
import { FileSystemService } from '../../file-system/file-system-service.js'
import { OpenProjectsStore } from '../open-projects-store.js'

// A minimal in-memory FileSystemService (only the three methods the store uses).
function fakeFs(): FileSystemService
{
    const files = new Map<string, string>()
    return {
        Exists: (p: string) => Promise.resolve(files.has(p)),
        ReadText: (p: string) => Promise.resolve(files.get(p) ?? ''),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
    } as unknown as FileSystemService
}

function store(fs = fakeFs()): OpenProjectsStore
{
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, fs)
    provider.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/data' } as unknown as EnvironmentService)
    return new OpenProjectsStore(provider)
}

test('List returns [] when nothing has been stored', async () => {
    expect(await store().List()).toEqual([])
})

test('Add appends and dedupes by exact folder', async () => {
    const s = store()
    await s.Add('/a')
    await s.Add('/b')
    await s.Add('/a')   // duplicate — ignored
    expect(await s.List()).toEqual(['/a', '/b'])
})

test('Remove drops a folder', async () => {
    const s = store()
    await s.Add('/a')
    await s.Add('/b')
    await s.Remove('/a')
    expect(await s.List()).toEqual(['/b'])
})

test('Add notifies subscribers with the updated folder list', async () => {
    const s = store()
    const seen: string[][] = []
    s.Subscribe((f) => seen.push([...f]))
    await s.Add('/a')
    await s.Add('/b')
    expect(seen).toEqual([['/a'], ['/a', '/b']])
})

test('a duplicate Add does not notify (the set did not change)', async () => {
    const s = store()
    await s.Add('/a')
    const seen: string[][] = []
    s.Subscribe((f) => seen.push([...f]))
    await s.Add('/a')   // already present
    expect(seen).toEqual([])
})

test('Remove notifies; Current reflects the mirror; unsubscribe stops delivery', async () => {
    const s = store()
    await s.Add('/a'); await s.Add('/b')
    const seen: string[][] = []
    const off = s.Subscribe((f) => seen.push([...f]))
    await s.Remove('/a')
    expect(s.Current()).toEqual(['/b'])
    off()
    await s.Remove('/b')
    expect(seen).toEqual([['/b']])   // only the pre-unsubscribe change delivered
})
