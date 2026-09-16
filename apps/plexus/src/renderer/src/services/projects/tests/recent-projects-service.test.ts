import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { EnvironmentService } from '../../environment/environment-service.js'
import { FileSystemService } from '../../file-system/file-system-service.js'
import { RecentProjectsService, type RecentProject } from '../recent-projects-service.js'

// In-memory FileSystemService covering just the calls RecentProjectsService uses.
function fakeFs(): FileSystemService
{
    const files = new Map<string, string>()
    return {
        Exists: (p: string) => Promise.resolve(files.has(p)),
        ReadText: (p: string) => Promise.resolve(files.get(p) ?? ''),
        WriteText: (p: string, c: string) => { files.set(p, c); return Promise.resolve() },
    } as unknown as FileSystemService
}

function service(): RecentProjectsService
{
    const p = new ServiceProvider()
    p.registerInstance(FileSystemService.Key, fakeFs())
    p.registerInstance(EnvironmentService.Key, { UserDataDirectory: '/userdata' } as unknown as EnvironmentService)
    return new RecentProjectsService(p)
}

const entry = (path: string, openedAt = 1): RecentProject => ({ name: path, path, type: 'architecture', openedAt })

test('List is empty when the file does not exist', async () => {
    expect(await service().List()).toEqual([])
})

test('Add then List returns the entry', async () => {
    const svc = service()
    await svc.Add(entry('/a'))
    expect((await svc.List()).map((e) => e.path)).toEqual(['/a'])
})

test('Add dedupes by path and moves the entry to the front', async () => {
    const svc = service()
    await svc.Add(entry('/a'))
    await svc.Add(entry('/b'))
    await svc.Add(entry('/a'))
    expect((await svc.List()).map((e) => e.path)).toEqual(['/a', '/b'])
})

test('Add caps at MaxEntries, most-recent first', async () => {
    const svc = service()
    for (let i = 0; i < RecentProjectsService.MaxEntries + 5; i++) await svc.Add(entry(`/p${i}`))
    const list = await svc.List()
    expect(list.length).toBe(RecentProjectsService.MaxEntries)
    expect(list[0].path).toBe(`/p${RecentProjectsService.MaxEntries + 4}`)   // newest
})

test('Remove drops the matching entry', async () => {
    const svc = service()
    await svc.Add(entry('/a'))
    await svc.Add(entry('/b'))
    await svc.Remove('/a')
    expect((await svc.List()).map((e) => e.path)).toEqual(['/b'])
})
