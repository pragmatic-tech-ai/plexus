import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { PROJECT_MANIFEST_FILENAME, isPublishable, isVersioned } from '../../../../services/projects/project-factory.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ArchitectureProjectFactory } from '../architecture-project-factory.js'

function factory(): ArchitectureProjectFactory { return new ArchitectureProjectFactory(new ServiceProvider()) }

test('architecture is not versioned', () => {
    expect(isVersioned(factory())).toBe(false)
})

test('createProject writes an architecture manifest with meta-model + libraries bindings', async () => {
    const storage = new FakeStorage('fake://Acme')
    const project = await factory().createProject(storage, 'Acme Arch', {
        metaModel: { id: 'ea', version: '5' },
        libraries: [{ id: 'microsoft', version: '0.1.0' }, { id: 'aws', version: '2' }],
    })
    expect(project.Type).toBe('architecture')
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(manifest.type).toBe('architecture')
    expect(manifest.name).toBe('Acme Arch')
    expect(manifest.metaModel).toEqual({ id: 'ea', version: '5' })
    expect(manifest.libraries).toEqual([{ id: 'microsoft', version: '0.1.0' }, { id: 'aws', version: '2' }])
})

test('createProject now writes the shared TODL scaffold + an architecture CLAUDE.md', async () => {
    const storage = new FakeStorage('fake://Acme')
    await factory().createProject(storage, 'Acme Arch')
    expect(await storage.Exists('.claude/todl-manual.md')).toBe(true)
    expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)
    expect(await storage.Exists('CLAUDE.md')).toBe(true)
    expect(await storage.ReadText('CLAUDE.md')).toMatch(/architecture/i)
})

test('createProject with no bindings omits both binding fields', async () => {
    const storage = new FakeStorage('fake://Bare')
    await factory().createProject(storage, 'Bare')
    const manifest = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect('metaModel' in manifest).toBe(false)
    expect('libraries' in manifest).toBe(false)
})

test('requiresMetaModel + offersLibraries are true; the factory is not publishable', () => {
    const f = factory()
    expect(f.requiresMetaModel).toBe(true)
    expect(f.offersLibraries).toBe(true)
    expect(isPublishable(f)).toBe(false)
})

test('openProject tags .todl files as openable todl nodes; the manifest is hidden', async () => {
    const storage = new FakeStorage('fake://Acme')
    await factory().createProject(storage, 'Acme')
    await storage.WriteText('model.todl', 'namespace a { concept x { label : string; } }')
    await storage.WriteText('notes.md', '# notes')

    const project = await factory().openProject(storage)
    const kinds = new Map(project.Root.Children.ToArray().map((c) => [c.Name, c.Kind]))
    expect(kinds.get('model.todl')).toBe('todl')
    expect(kinds.get('notes.md')).toBe('file')
    expect([...kinds.keys()]).not.toContain(PROJECT_MANIFEST_FILENAME)
})

test('architecture factory lists Diagram first, then TODL Definition', () => {
    const f = factory()
    expect(f.formats.map((x) => x.extension)).toEqual(['.diagram', '.todl'])
    expect(f.formats[0]).toEqual({ extension: '.diagram', kind: 'diagram', displayName: 'Diagram' })
    expect(f.formats[1]).toEqual({ extension: '.todl', kind: 'todl', displayName: 'TODL Definition' })
})

test('openProject marks a .diagram as a diagram node and a .todl as a todl node', async () => {
    const storage = new FakeStorage('fake://City')
    await factory().createProject(storage, 'City')
    await storage.WriteText('city.diagram', '{}')
    await storage.WriteText('city.todl', 'namespace city\n{\n}\n')

    const project = await factory().openProject(storage)
    const kinds = new Map(project.Root.Children.ToArray().map((n) => [n.Name, n.Kind]))
    expect(kinds.get('city.diagram')).toBe('diagram')
    expect(kinds.get('city.todl')).toBe('todl')
})
