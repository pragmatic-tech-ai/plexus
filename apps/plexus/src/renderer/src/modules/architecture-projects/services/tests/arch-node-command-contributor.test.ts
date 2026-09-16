import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ProjectExplorerService } from '../../../project-explorer/services/project-explorer-service.js'
import { ArchDiagramBindingService } from '../arch-diagram-binding-service.js'
import { DiagramViewpointsEditor } from '../diagram-viewpoints-editor.js'
import { ArchNodeCommandContributor } from '../arch-node-command-contributor.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import type { OpenProject } from '../../../../services/projects/open-project.js'

function op(type = 'architecture'): OpenProject {
    return { Project: new Project(type, 'Acme', 'fake://Acme', new ProjectNode('Acme', '', 'folder')) } as unknown as OpenProject
}
// The arch factory tags .diagram files with Kind 'diagram' and .todl with 'todl'
// (not 'file'), so tests must mirror that or they validate a fiction.
const diagramNode = (path: string) => new ProjectNode(path, path, 'diagram')
const flush = () => new Promise((r) => setTimeout(r, 0))

test('contributes "Edit Viewpoints…" for a .diagram node in an architecture project', () => {
    const action = new ArchNodeCommandContributor(new ServiceProvider()).contribute(op(), diagramNode('d.diagram'))
    expect(action?.label).toBe('Edit Viewpoints…')
})

test('does not contribute for a non-architecture project', () => {
    expect(new ArchNodeCommandContributor(new ServiceProvider()).contribute(op('diagram'), diagramNode('d.diagram'))).toBeUndefined()
})

test('does not contribute for a non-.diagram file', () => {
    expect(new ArchNodeCommandContributor(new ServiceProvider()).contribute(op(), new ProjectNode('notes.todl', 'notes.todl', 'todl'))).toBeUndefined()
})

test('does not contribute for a folder node', () => {
    expect(new ArchNodeCommandContributor(new ServiceProvider()).contribute(op(), new ProjectNode('sub', 'sub', 'folder'))).toBeUndefined()
})

test('running the action opens the diagram, binds it, then runs the editor', async () => {
    const calls: string[] = []
    const doc = {}
    const provider = new ServiceProvider()
    provider.registerInstance(ProjectExplorerService.Key, { OpenPath: async () => { calls.push('open'); return doc } } as unknown as ProjectExplorerService)
    provider.registerInstance(ArchDiagramBindingService.Key, { ensureBound: async () => { calls.push('bind') } } as unknown as ArchDiagramBindingService)
    provider.registerInstance(DiagramViewpointsEditor.Key, { edit: async () => { calls.push('edit') } } as unknown as DiagramViewpointsEditor)

    const action = new ArchNodeCommandContributor(provider).contribute(op(), diagramNode('d.diagram'))!
    action.command.Execute(undefined)
    await flush()
    expect(calls).toEqual(['open', 'bind', 'edit'])
})
