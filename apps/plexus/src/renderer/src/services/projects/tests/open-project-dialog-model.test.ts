import { test, expect } from 'vitest'

import type { FileSystemService } from '../../file-system/file-system-service.js'
import { OpenProjectDialogModel, type OpenProjectResult } from '../open-project-dialog-model.js'
import type { RecentProject } from '../recent-projects-service.js'

const flush = () => new Promise((r) => setTimeout(r, 0))

function stubFs(folder: string | null): FileSystemService
{
    return { OpenFolder: () => Promise.resolve(folder) } as unknown as FileSystemService
}

const recents: RecentProject[] = [
    { name: 'Acme', path: '/work/acme', type: 'architecture', openedAt: 2 },
    { name: 'Billing', path: '/models/billing', type: 'architecture', openedAt: 1 },
]

function build(rs: RecentProject[], fs: FileSystemService)
{
    let result: OpenProjectResult | undefined | 'uncalled' = 'uncalled'
    const vm = new OpenProjectDialogModel(rs, fs, (r) => { result = r })
    return { vm, closed: () => result }
}

test('lists recents and has no empty label', () => {
    const { vm } = build(recents, stubFs(null))
    expect(vm.Recents.ToArray().map((r) => r.Name)).toEqual(['Acme', 'Billing'])
    expect(vm.EmptyLabel).toBe('')
})

test('shows an empty label when there are no recents', () => {
    const { vm } = build([], stubFs(null))
    expect(vm.EmptyLabel).toBe('No recent projects.')
})

test('opening a recent closes with its path', () => {
    const { vm, closed } = build(recents, stubFs(null))
    vm.Recents.ToArray()[1].OpenCommand!.Execute(undefined)
    expect(closed()).toEqual({ location: '/models/billing' })
})

test('Browse closes with the picked folder', async () => {
    const { vm, closed } = build(recents, stubFs('/new/place'))
    vm.BrowseCommand.Execute(undefined)
    await flush()
    expect(closed()).toEqual({ location: '/new/place' })
})

test('Browse cancelled leaves the dialog open', async () => {
    const { vm, closed } = build(recents, stubFs(null))
    vm.BrowseCommand.Execute(undefined)
    await flush()
    expect(closed()).toBe('uncalled')
})

test('cancel closes with undefined', () => {
    const { vm, closed } = build(recents, stubFs(null))
    vm.CancelCommand.Execute(undefined)
    expect(closed()).toBeUndefined()
})
