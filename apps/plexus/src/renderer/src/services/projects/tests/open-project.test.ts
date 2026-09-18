import { test, expect } from 'vitest'
import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'

import { Project, ProjectNode, ProjectNodeKind } from '@pragmatic-tech-ai/todl'
import { OpenProject } from '@pragmatic-tech-ai/plexus-core/renderer/projects/open-project.js'
import type { IProjectFactory } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project-factory.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// OpenProject holds the todl DATA project and projects a VM tree from it (Root).
// A rescan (Adopt) reconciles that VM tree in place against a fresh data scan:
// the VM Root instance is kept, survivors keep their VM instances, added nodes are
// projected, removed nodes drop. These tests assert that projection contract.

const fakeFactory = { formats: [] } as unknown as IProjectFactory
const fakeStorage = { Root: 'C:/proj' } as unknown as IStorage

function project(): Project
{
    return new Project('meta-model', 'Acme', 'C:/proj', new ProjectNode('proj', '', ProjectNodeKind.Folder))
}

// Build a todl DATA node subtree. `kind` is one of the ProjectNodeKind values;
// cast to keep the callers terse.
function node(name: string, path: string, kind: 'folder' | 'todl' | 'file', children: ProjectNode[] = []): ProjectNode
{
    const n = new ProjectNode(name, path, kind as unknown as ProjectNodeKind)
    for (const c of children) n.Children.Add(c)
    return n
}

test('exposes Name/Root/Folder from the project and the given factory/storage', () => {
    const p = project()
    const op = new OpenProject(p, fakeFactory, fakeStorage)
    expect(op.Name).toBe('Acme')
    // Root is a VM projection of the data root (not the same instance), mirroring it.
    expect(op.Root.Name).toBe(p.Root.Name)
    expect(op.Root.Path).toBe('')
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

test('Adopt reconciles the Root in place: keeps the VM Root + survivors and reflects added nodes', () => {
    const root = node('proj', '', 'folder', [node('src', 'src', 'folder', [node('a.todl', 'src/a.todl', 'todl')])])
    const op = new OpenProject(new Project('architecture', 'Acme', 'C:/proj', root), fakeFactory, fakeStorage)
    const vmRoot = op.Root                        // the projected VM root
    const vmSrc = op.Root.Children.ToArray()[0]!  // the projected src VM folder

    // A fresh scan: src gained b.todl, and a new top-level readme appeared.
    const freshSrc = node('src', 'src', 'folder', [node('a.todl', 'src/a.todl', 'todl'), node('b.todl', 'src/b.todl', 'todl')])
    const freshRoot = node('proj', '', 'folder', [freshSrc, node('readme.md', 'readme.md', 'file')])
    op.Adopt(new Project('architecture', 'Acme', 'C:/proj', freshRoot))

    // VM Root instance is NOT swapped — the TreeView observes its Children collection.
    expect(op.Root).toBe(vmRoot)
    expect(op.Root.Children.ToArray().map((c) => c.Path)).toEqual(['src', 'readme.md'])
    // The matched src VM folder keeps its instance (expansion preserved) and gains b.todl.
    expect(op.Root.Children.ToArray()[0]).toBe(vmSrc)
    expect(vmSrc.Children.ToArray().map((c) => c.Path)).toEqual(['src/a.todl', 'src/b.todl'])
})

test('Adopt inserts a new node at its sorted position (not just appended)', () => {
    const root = node('proj', '', 'folder', [node('a.todl', 'a.todl', 'todl'), node('c.todl', 'c.todl', 'todl')])
    const op = new OpenProject(new Project('architecture', 'Acme', 'C:/proj', root), fakeFactory, fakeStorage)
    const [vmA, vmC] = op.Root.Children.ToArray()

    // b sorts between a and c.
    const freshRoot = node('proj', '', 'folder', [node('a.todl', 'a.todl', 'todl'), node('b.todl', 'b.todl', 'todl'), node('c.todl', 'c.todl', 'todl')])
    op.Adopt(new Project('architecture', 'Acme', 'C:/proj', freshRoot))

    expect(op.Root.Children.ToArray().map((c) => c.Path)).toEqual(['a.todl', 'b.todl', 'c.todl'])
    expect(op.Root.Children.ToArray()[0]).toBe(vmA)   // survivors keep their VM instances
    expect(op.Root.Children.ToArray()[2]).toBe(vmC)
})

test('Adopt drops nodes no longer present on disk', () => {
    const root = node('proj', '', 'folder', [node('old.todl', 'old.todl', 'todl'), node('keep.todl', 'keep.todl', 'todl')])
    const op = new OpenProject(new Project('architecture', 'Acme', 'C:/proj', root), fakeFactory, fakeStorage)

    const freshRoot = node('proj', '', 'folder', [node('keep.todl', 'keep.todl', 'todl')])
    op.Adopt(new Project('architecture', 'Acme', 'C:/proj', freshRoot))

    expect(op.Root.Children.ToArray().map((c) => c.Path)).toEqual(['keep.todl'])
})
