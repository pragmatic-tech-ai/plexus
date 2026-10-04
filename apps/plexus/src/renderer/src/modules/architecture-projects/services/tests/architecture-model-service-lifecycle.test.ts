import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { load, toJSON, SolutionBaseResolver } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FakeSolutionManager } from '../../../../services/solution/tests/fake-solution-manager.js'
import { Project } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project.js'
import { ProjectNode, ProjectNodeKind } from '@pragmatic-tech-ai/todl'
import type { OpenProject } from '@pragmatic-tech-ai/plexus-core/renderer/projects/open-project.js'
import { ArchitectureModelService } from '../architecture-model-service.js'

const MM = `namespace archmm {
  concept Component {}
  viewpoint ComponentView : frames Component
}`

function fakeOpenProject(storage: FakeStorage): OpenProject
{
    const project = new Project('architecture', 'Acme', storage.Root, new ProjectNode('Acme', '', ProjectNodeKind.Folder))
    return { Project: project, Storage: storage } as unknown as OpenProject
}

test('removing an open project drops its cached model', async () => {
    const manager = new FakeSolutionManager()
    const baseDoc = toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)

    const provider = new ServiceProvider()
    provider.registerInstance(SolutionBaseResolver.Key, {
        ResolveBasesFor: async () => ({ bases: [baseDoc], problems: [] }),
    } as unknown as SolutionBaseResolver)
    manager.RegisterOn(provider)

    const storage = new FakeStorage('fake://Acme')
    await storage.WriteText('m.todl', `namespace archmm {\n  model Arch : archmm conforms ComponentView { Component web {} }\n}`)
    const op = fakeOpenProject(storage)
    const member = manager.AddResolved(op.Project, storage)

    const service = new ArchitectureModelService(provider)
    await service.modelFor(op)
    expect(service.peek(op.Project.RootPath)).toBeDefined()

    manager.Remove(member)                            // fires the Members listener
    expect(service.peek(op.Project.RootPath)).toBeUndefined()
})
