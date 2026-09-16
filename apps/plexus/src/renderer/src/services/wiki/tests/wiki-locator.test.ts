import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { ModelDraft } from '@pragmatic-tech-ai/todl'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'
import { WikiLocator, wikiPathOf } from '../wiki-locator.js'

// A fake OpenProject: its Storage yields one .todl source (its own model text).
// collectTodlSources walks with storage.List(dir) → [{Name, IsDirectory}] and
// reads with storage.ReadText(path); the fake models exactly those two calls.
function fakeProject(root: string, name: string, todl: string): unknown {
    const storage = {
        List: () => Promise.resolve([{ Name: 'model.todl', IsDirectory: false }]),
        ReadText: () => Promise.resolve(todl),
    }
    return { Project: { RootPath: root, Name: name }, Storage: storage }
}

function locatorWith(...projects: unknown[]): WikiLocator {
    const explorer = { OpenProjects: new ObservableCollection(projects) } as unknown as ProjectExplorerService
    const provider = new ServiceProvider()
    provider.registerInstance(ProjectExplorerService.Key, explorer)
    return new WikiLocator(provider)
}

const MM = `namespace mm { concept service { annotate wiki { path = "wiki/service.md"; } } }`
const ARCH = `namespace app { import mm; model M conforms mm.Model { service s1 {} } }`

test('resolves a concept declared in an open meta-model project', async () => {
    const loc = locatorWith(fakeProject('/mm', 'mm', MM), fakeProject('/app', 'app', ARCH))
    expect(await loc.resolveWiki('service')).toEqual({ root: '/mm', relPath: 'wiki/service.md' })
})

test('returns undefined when no open project declares the concept', async () => {
    const loc = locatorWith(fakeProject('/app', 'app', ARCH))
    expect(await loc.resolveWiki('service')).toBeUndefined()
})

test('returns undefined for a concept without a wiki annotation', async () => {
    const bare = `namespace mm { concept widget {} }`
    const loc = locatorWith(fakeProject('/mm', 'mm', bare))
    expect(await loc.resolveWiki('widget')).toBeUndefined()
})

// ── wikiPathOf: the cheap, loaded-model resolution (no source recompile) ──

function repoFrom(todl: string, namespace: string) {
    return ModelDraft.fromSources([], [{ uri: 'm.todl', text: todl }], { namespace }).model
}

test('wikiPathOf reads the declared path off a loaded repo', () => {
    const repo = repoFrom(MM, 'mm')
    expect(wikiPathOf(repo, 'service')).toBe('wiki/service.md')
})

test('wikiPathOf is undefined for a concept with no wiki annotation', () => {
    const repo = repoFrom(`namespace mm { concept widget {} }`, 'mm')
    expect(wikiPathOf(repo, 'widget')).toBeUndefined()
})

test('wikiPathOf is undefined for an unknown concept or empty id', () => {
    const repo = repoFrom(MM, 'mm')
    expect(wikiPathOf(repo, 'nope')).toBeUndefined()
    expect(wikiPathOf(repo, '')).toBeUndefined()
})
