import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { load, toJSON } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { WorkspaceBaseResolver } from '../../../../services/projects/workspace-base-resolver.js'
import { ProjectExplorerService } from '../../../project-explorer/services/project-explorer-service.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import type { OpenProject } from '../../../../services/projects/open-project.js'
import { ArchitectureModelService } from '../architecture-model-service.js'

const MM = `namespace archmm {
  concept Component {}
  viewpoint ComponentView : frames Component
}`

function fakeOpenProject(storage: FakeStorage): OpenProject {
    const project = new Project('architecture', 'Acme', storage.Root, new ProjectNode('Acme', '', 'folder'))
    return { Project: project, Storage: storage } as unknown as OpenProject
}

test('removing an open project drops its cached model', async () => {
    const open = new ObservableCollection<OpenProject>()
    const explorer = { OpenProjects: open } as unknown as ProjectExplorerService
    const baseDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)

    const provider = new ServiceProvider()
    provider.registerInstance(WorkspaceBaseResolver.Key, {
        ResolveForStorage: async () => ({ bases: [baseDoc], problems: [] }),
    } as unknown as WorkspaceBaseResolver)
    provider.registerInstance(ProjectExplorerService.Key, explorer)

    const storage = new FakeStorage('fake://Acme')
    await storage.WriteText('m.todl', `namespace archmm {\n  model Arch : archmm conforms ComponentView { Component web {} }\n}`)
    const op = fakeOpenProject(storage)
    open.Add(op)

    const service = new ArchitectureModelService(provider)
    await service.modelFor(op)
    expect(service.peek(op.Project.RootPath)).toBeDefined()

    open.Remove(op)                                   // fires the collection listener
    expect(service.peek(op.Project.RootPath)).toBeUndefined()
})
