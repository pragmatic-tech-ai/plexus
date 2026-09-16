import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { PROJECT_MANIFEST_FILENAME, type ProjectFileFormat, type ProjectManifestEnvelope } from '../project-factory.js'
import type { BaseBindings } from '../base-binding.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { TodlProjectFactory, isTodlProject, type ScaffoldFile } from '../todl-project-factory.js'

// A minimal concrete factory: one extra scaffold file, a manifest that carries
// an unrelated field to prove saveProject preserves it, and two formats so the
// kind-mapping is exercised (.todl → 'todl', .diagram → 'diagram').
class FakeFactory extends TodlProjectFactory
{
    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.diagram', kind: 'diagram', displayName: 'Diagram' },
        { extension: '.todl', kind: 'todl', displayName: 'TODL Definition' },
    ]
    protected buildManifest(name: string, _bindings?: BaseBindings): ProjectManifestEnvelope
    {
        return { type: 'fake', name, version: 1, keep: 'me' } as ProjectManifestEnvelope & { keep: string }
    }
    protected scaffoldContributions(): readonly ScaffoldFile[]
    {
        return [{ path: 'CLAUDE.md', content: 'FAKE ROOT' }]
    }
}

function factory(): FakeFactory { return new FakeFactory(new ServiceProvider()) }

test('createProject writes base scaffold ∪ subclass contribution', async () => {
    const storage = new FakeStorage('fake://P')
    await factory().createProject(storage, 'P')
    expect(await storage.Exists('.claude/todl-manual.md')).toBe(true)
    expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)
    expect(await storage.ReadText('CLAUDE.md')).toBe('FAKE ROOT')
    // base assets are the real docs, not placeholders
    expect(await storage.ReadText('.claude/todl-manual.md')).toMatch(/namespace/)
    expect(await storage.ReadText('.claude/todl-rules.md')).toMatch(/golden rules/i)
})

test('ensureScaffold is write-once (never clobbers an author edit)', async () => {
    const storage = new FakeStorage()
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'fake', name: 'P', version: 1 }))
    await storage.WriteText('.claude/todl-manual.md', 'MY EDIT')
    await factory().openProject(storage)
    expect(await storage.ReadText('.claude/todl-manual.md')).toBe('MY EDIT')       // preserved
    expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)               // missing one filled
})

test('populate maps node kind from formats; unmatched → file; manifest hidden', async () => {
    const storage = new FakeStorage()
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'fake', name: 'P', version: 1 }))
    await storage.WriteText('defs/core.todl', 'namespace d {}')
    await storage.WriteText('view.diagram', '{}')
    await storage.WriteText('notes.md', 'hi')
    const project = await factory().openProject(storage)
    const top = new Map(project.Root.Children.ToArray().map((n) => [n.Name, n.Kind]))
    expect(top.get('view.diagram')).toBe('diagram')
    expect(top.get('notes.md')).toBe('file')
    expect([...top.keys()]).not.toContain(PROJECT_MANIFEST_FILENAME)
    const defs = project.Root.Children.ToArray().find((n) => n.Name === 'defs')!
    expect(defs.Kind).toBe('folder')
    expect(defs.Children.ToArray()[0].Kind).toBe('todl')
    expect(defs.Children.ToArray()[0].Path).toBe('defs/core.todl')
})

test('saveProject renames and preserves unrelated manifest fields', async () => {
    const storage = new FakeStorage()
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'fake', name: 'Old', version: 1, keep: 'me' }))
    // A project object whose Name is 'Renamed', produced by a normal create
    // (Project.Name is read-only, so build it through the factory rather than a setter).
    const renamed = await factory().createProject(new FakeStorage('fake://Renamed'), 'Renamed')
    await factory().saveProject(renamed, storage)
    const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME))
    expect(m.name).toBe('Renamed')
    expect(m.keep).toBe('me')       // untouched
})

test('updateScaffold refreshes .claude docs, preserves CLAUDE.md, self-heals missing', async () => {
    const storage = new FakeStorage('fake://P')
    const f = factory()
    await f.createProject(storage, 'P')                       // full scaffold + CLAUDE.md = 'FAKE ROOT'
    await storage.WriteText('.claude/todl-manual.md', 'HACKED')   // stale edit to a managed doc
    await storage.WriteText('CLAUDE.md', 'MY NOTES')              // author edit to the root
    await storage.Delete('.claude/todl-rules.md')                // a missing managed doc

    const written = await f.updateScaffold(storage)

    expect(await storage.ReadText('.claude/todl-manual.md')).toMatch(/namespace/)   // refreshed, not 'HACKED'
    expect(await storage.ReadText('CLAUDE.md')).toBe('MY NOTES')                    // preserved
    expect(await storage.Exists('.claude/todl-rules.md')).toBe(true)               // self-healed
    expect(written).toContain('.claude/todl-manual.md')
    expect(written).toContain('.claude/todl-rules.md')
    expect(written).not.toContain('CLAUDE.md')
})

test('isTodlProject is true for a TodlProjectFactory subclass, false for a plain factory', () => {
    expect(isTodlProject(factory())).toBe(true)
    expect(isTodlProject({ formats: [] } as unknown as import('../project-factory.js').IProjectFactory)).toBe(false)
})
