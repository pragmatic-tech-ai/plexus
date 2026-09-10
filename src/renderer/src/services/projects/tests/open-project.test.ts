import { test, expect } from 'vitest'
import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'

import { Project, ProjectNode } from '../project.js'
import { OpenProject } from '../open-project.js'
import type { IProjectFactory } from '../project-factory.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

const fakeFactory = { formats: [] } as unknown as IProjectFactory
const fakeStorage = { Root: 'C:/proj' } as unknown as IStorage

function project(): Project
{
    return new Project('meta-model', 'Acme', 'C:/proj', new ProjectNode('proj', '', 'folder'))
}

test('exposes Name/Root/Folder from the project and the given factory/storage', () => {
    const p = project()
    const op = new OpenProject(p, fakeFactory, fakeStorage)
    expect(op.Name).toBe('Acme')
    expect(op.Root).toBe(p.Root)
    expect(op.Folder).toBe('C:/proj')
    expect(op.Factory).toBe(fakeFactory)
    expect(op.Storage).toBe(fakeStorage)
})

test('command DPs are settable and gettable', () => {
    const op = new OpenProject(project(), fakeFactory, fakeStorage)
    expect(op.NewFolderCommand).toBeUndefined()
    const cmd = new RelayCommand(() => {})
    op.NewFolderCommand = cmd
    op.PublishCommand = cmd
    op.CloseCommand = cmd
    expect(op.NewFolderCommand).toBe(cmd)
    expect(op.PublishCommand).toBe(cmd)
    expect(op.CloseCommand).toBe(cmd)
})

function node(name: string, path: string, kind: 'folder' | 'todl' | 'file', children: ProjectNode[] = []): ProjectNode
{
    const n = new ProjectNode(name, path, kind)
    for (const c of children) n.Children.Add(c)
    return n
}

test('Adopt reconciles the Root in place: keeps the Root instance and reflects added nodes', () => {
    const srcFolder = node('src', 'src', 'folder', [node('a.todl', 'src/a.todl', 'todl')])
    const root = node('proj', '', 'folder', [srcFolder])
    const op = new OpenProject(new Project('architecture', 'Acme', 'C:/proj', root), fakeFactory, fakeStorage)

    // A fresh scan: src gained b.todl, and a new top-level readme appeared.
    const freshSrc = node('src', 'src', 'folder', [node('a.todl', 'src/a.todl', 'todl'), node('b.todl', 'src/b.todl', 'todl')])
    const freshRoot = node('proj', '', 'folder', [freshSrc, node('readme.md', 'readme.md', 'file')])
    op.Adopt(new Project('architecture', 'Acme', 'C:/proj', freshRoot))

    // Root instance is NOT swapped — the TreeView observes its Children collection.
    expect(op.Root).toBe(root)
    expect(op.Root.Children.ToArray().map((c) => c.Path)).toEqual(['src', 'readme.md'])
    // The matched src folder keeps its instance (expansion preserved) and gains b.todl.
    expect(op.Root.Children.ToArray()[0]).toBe(srcFolder)
    expect(srcFolder.Children.ToArray().map((c) => c.Path)).toEqual(['src/a.todl', 'src/b.todl'])
})

test('Adopt inserts a new node at its sorted position (not just appended)', () => {
    const a = node('a.todl', 'a.todl', 'todl')
    const c = node('c.todl', 'c.todl', 'todl')
    const root = node('proj', '', 'folder', [a, c])
    const op = new OpenProject(new Project('architecture', 'Acme', 'C:/proj', root), fakeFactory, fakeStorage)

    // b sorts between a and c.
    const freshRoot = node('proj', '', 'folder', [node('a.todl', 'a.todl', 'todl'), node('b.todl', 'b.todl', 'todl'), node('c.todl', 'c.todl', 'todl')])
    op.Adopt(new Project('architecture', 'Acme', 'C:/proj', freshRoot))

    expect(op.Root.Children.ToArray().map((c) => c.Path)).toEqual(['a.todl', 'b.todl', 'c.todl'])
    expect(op.Root.Children.ToArray()[0]).toBe(a)   // survivors keep their instances
    expect(op.Root.Children.ToArray()[2]).toBe(c)
})

test('Adopt drops nodes no longer present on disk', () => {
    const root = node('proj', '', 'folder', [node('old.todl', 'old.todl', 'todl'), node('keep.todl', 'keep.todl', 'todl')])
    const op = new OpenProject(new Project('architecture', 'Acme', 'C:/proj', root), fakeFactory, fakeStorage)

    const freshRoot = node('proj', '', 'folder', [node('keep.todl', 'keep.todl', 'todl')])
    op.Adopt(new Project('architecture', 'Acme', 'C:/proj', freshRoot))

    expect(op.Root.Children.ToArray().map((c) => c.Path)).toEqual(['keep.todl'])
})
