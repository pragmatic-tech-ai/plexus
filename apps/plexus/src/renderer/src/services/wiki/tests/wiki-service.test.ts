import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { FileSystemService } from '../../file-system/file-system-service.js'
import { WikiLocator } from '../wiki-locator.js'
import { WikiService } from '../wiki-service.js'
import { WikiDocument } from '../wiki-document.js'

function svc(opts: {
    resolve?: { root: string; relPath: string }
    exists?: boolean
    text?: string
}): { wiki: WikiService; opened: unknown[] } {
    const opened: unknown[] = []
    const provider = new ServiceProvider()
    provider.registerInstance(FileSystemService.Key, {
        Exists: () => Promise.resolve(opts.exists ?? true),
        ReadText: () => Promise.resolve(opts.text ?? '# Wiki\n\nBody.'),
    } as unknown as FileSystemService)
    provider.registerInstance(ContentHostService.Key, {
        Open: (d: unknown) => { opened.push(d) },
    } as unknown as ContentHostService)
    provider.registerInstance(WikiLocator.Key, {
        resolveWiki: () => Promise.resolve(opts.resolve),
    } as unknown as WikiLocator)
    return { wiki: new WikiService(provider), opened }
}

test('openWiki opens a WikiDocument whose Id is join(root, relPath)', async () => {
    const { wiki, opened } = svc({ resolve: { root: '/mm', relPath: 'wiki/component.md' } })
    await wiki.openWiki('component')
    expect(opened.length).toBe(1)
    expect(opened[0]).toBeInstanceOf(WikiDocument)
    expect((opened[0] as WikiDocument).Id).toBe('/mm/wiki/component.md')
})

test('re-opening the same page reuses the SAME document (deduped)', async () => {
    const { wiki, opened } = svc({ resolve: { root: '/mm', relPath: 'wiki/component.md' } })
    await wiki.openWiki('component')
    await wiki.openWiki('component')
    expect(opened.length).toBe(2)
    expect(opened[0]).toBe(opened[1])   // same instance re-activated, not a new tab
})

test('openWiki is a no-op with a status when the concept does not resolve', async () => {
    const { wiki, opened } = svc({ resolve: undefined })
    await wiki.openWiki('component')
    expect(opened).toEqual([])
    expect(wiki.Status.length).toBeGreaterThan(0)
})

test('openWiki is a no-op with a status when the file is missing', async () => {
    const { wiki, opened } = svc({ resolve: { root: '/mm', relPath: 'wiki/component.md' }, exists: false })
    await wiki.openWiki('component')
    expect(opened).toEqual([])
    expect(wiki.Status.length).toBeGreaterThan(0)
})

test('hasWiki reflects whether the concept resolves', async () => {
    expect(await svc({ resolve: { root: '/mm', relPath: 'w.md' } }).wiki.hasWiki('component')).toBe(true)
    expect(await svc({ resolve: undefined }).wiki.hasWiki('component')).toBe(false)
})
