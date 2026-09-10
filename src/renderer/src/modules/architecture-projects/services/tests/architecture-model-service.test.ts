import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { load, toJSON, compilePackage, type TodlDocument } from '@pragmatic-tech-ai/todl'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { WorkspaceBaseResolver } from '../../../../services/projects/workspace-base-resolver.js'
import { Project, ProjectNode } from '../../../../services/projects/project.js'
import type { OpenProject } from '../../../../services/projects/open-project.js'
import { ArchitectureModelService } from '../architecture-model-service.js'

const MM = `namespace archmm {
  concept Component {}
  concept Node {}
  viewpoint ComponentView : frames Component
  viewpoint DeploymentView : frames Node, Component
}`

// A fake OpenProject: only .Project + .Storage are read by the service.
function fakeOpenProject(storage: FakeStorage): OpenProject {
    const project = new Project('architecture', 'Acme', storage.Root, new ProjectNode('Acme', '', 'folder'))
    return { Project: project, Storage: storage } as unknown as OpenProject
}

// A provider whose WorkspaceBaseResolver returns the meta-model as the base doc.
function providerWithBase(baseDoc: TodlDocument): ServiceProvider {
    return providerWithBases([baseDoc])
}

// A provider returning several bases — the shape ResolveForStorage yields for a
// published meta-model + libraries (each an OWN-ONLY document).
function providerWithBases(bases: TodlDocument[]): ServiceProvider {
    const provider = new ServiceProvider()
    provider.registerInstance(WorkspaceBaseResolver.Key, {
        ResolveForStorage: async () => ({ bases, problems: [] }),
    } as unknown as WorkspaceBaseResolver)
    return provider
}

// Two OWN-ONLY published bases (prelude + base ids stripped, deps recorded): a
// meta-model whose concept dangles to the prelude `Element`, and a library whose
// taxonomy dangles to the meta-model concept. Neither is a self-contained graph
// on its own — they only cohere when merged together with the prelude.
function ownOnlyBases(): TodlDocument[] {
    const META = `namespace mm { concept Component {} viewpoint CV : frames Component }`
    const LIB = `namespace lib { import mm; taxonomy T : represents Component { Component widget {} } }`
    const meta = compilePackage([], [{ uri: 'mm.todl', text: META }], { id: 'mm', version: '1' })
    const metaOwn = meta.package!.document
    const lib = compilePackage([metaOwn], [{ uri: 'lib.todl', text: LIB }], { id: 'lib', version: '1' })
    return [metaOwn, lib.package!.document]
}

async function ownOnlySeededStorage(): Promise<FakeStorage> {
    const storage = new FakeStorage('fake://Acme')
    await storage.WriteText('model.todl', `namespace arch {\n  import mm; import lib;\n  model M : mm conforms CV { Component web {} }\n}`)
    return storage
}

async function seededStorage(): Promise<FakeStorage> {
    const storage = new FakeStorage('fake://Acme')
    await storage.WriteText('model-a.todl', `namespace archmm {\n  model Arch : archmm conforms ComponentView { Component web {} }\n}`)
    await storage.WriteText('model-b.todl', `namespace archmm {\n  model Arch : archmm conforms DeploymentView { Node host {} }\n}`)
    return storage
}

function baseDoc(): TodlDocument {
    return toJSON(load([{ uri: 'archmm.todl', text: MM }]).model)
}

test('modelFor composes bases + all .todl files into one ArchModel', async () => {
    const service = new ArchitectureModelService(providerWithBase(baseDoc()))
    const model = await service.modelFor(fakeOpenProject(await seededStorage()))
    expect(model.namespace).toBe('archmm')
    expect(model.entities().map((e) => e.id).sort()).toEqual(['host', 'web'])
    expect(model.viewpoints().map((v) => v.id).sort()).toEqual(['ComponentView', 'DeploymentView'])
})

test('modelFor composes OWN-ONLY published bases (dangling cross-refs) without throwing', async () => {
    // Regression: own-only bases were each wrapped in their own Repository, which
    // threw ("edge target ... does not exist") because a fragment's edges point at
    // ids that live in a sibling base or the prelude. The service must merge them
    // (prelude + all bases) into one closed graph before composing.
    const service = new ArchitectureModelService(providerWithBases(ownOnlyBases()))
    const model = await service.modelFor(fakeOpenProject(await ownOnlySeededStorage()))
    expect(model.namespace).toBe('arch')
    expect(model.entities().map((e) => e.id)).toContain('web')
})

test('modelFor is idempotent — a second call returns the cached instance', async () => {
    const service = new ArchitectureModelService(providerWithBase(baseDoc()))
    const op = fakeOpenProject(await seededStorage())
    const first = await service.modelFor(op)
    const second = await service.modelFor(op)
    expect(second).toBe(first)
})

test('peek returns the cached model; close drops it', async () => {
    const service = new ArchitectureModelService(providerWithBase(baseDoc()))
    const op = fakeOpenProject(await seededStorage())
    await service.modelFor(op)
    expect(service.peek(op.Project.RootPath)).toBeDefined()
    service.close(op.Project.RootPath)
    expect(service.peek(op.Project.RootPath)).toBeUndefined()
})

test('namespace derives from the first .todl file', async () => {
    const service = new ArchitectureModelService(providerWithBase(baseDoc()))
    const model = await service.modelFor(fakeOpenProject(await seededStorage()))
    expect(model.namespace).toBe('archmm')
})
