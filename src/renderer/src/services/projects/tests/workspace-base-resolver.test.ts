import { test, expect } from 'vitest'
import { ServiceProvider, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'
import { check, toJSON, type TodlDocument } from '@pragmatic-tech-ai/todl'

import { StorageProviderRegistry } from '../../storage/storage-provider-registry.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { META_MODELS_BACKEND_ID } from '../../../modules/meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../modules/library/services/libraries-backend.js'
import { ProjectExplorerService } from '../../../modules/project-explorer/services/project-explorer-service.js'
import { TodlLanguageClient } from '../../todl/todl-language-client.js'
import { WikiOriginKind } from '../wiki-origin.js'
import { PROJECT_MANIFEST_FILENAME, ProducerKind, type IProjectFactory, type IProducerProjectFactory } from '../project-factory.js'
import { Project, ProjectNode } from '../project.js'
import { OpenProject } from '../open-project.js'
import { WorkspaceBaseResolver } from '../workspace-base-resolver.js'

// A producer factory whose compileToDocument returns a canned document built
// from the given TODL text, so the test controls the "live" output.
function producer(kind: ProducerKind, text: string): IProjectFactory & IProducerProjectFactory
{
    return {
        formats: [],
        producerKind: kind,
        compileToDocument: async () => ({
            doc: toJSON(check([{ uri: 'p.todl', text }]).model),
            problems: [],
        }),
    } as unknown as IProjectFactory & IProducerProjectFactory
}

async function openProject(
    kind: string, id: string, version: string, factory: IProjectFactory,
    bindings?: { metaModel?: { id: string; version: string }; libraries?: { id: string; version: string }[] },
): Promise<OpenProject>
{
    const storage = new FakeStorage(`C:/${id}`)
    const verKey = kind === 'meta-model' ? 'modelVersion' : 'libVersion'
    await storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(
        { type: kind, id, [verKey]: version, ...bindings }))
    return new OpenProject(new Project(kind, id, `C:/${id}`, new ProjectNode(id, '', 'folder')), factory, storage)
}

// A provider with published backends + a fake explorer holding the given projects.
function env(open: OpenProject[]): { provider: ServiceProvider; meta: FakeStorage; libs: FakeStorage }
{
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const meta = new FakeStorage('fake://meta-models')
    const libs = new FakeStorage('fake://libraries')
    registry.Register(META_MODELS_BACKEND_ID, () => meta)
    registry.Register(LIBRARIES_BACKEND_ID, () => libs)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    const collection = new ObservableCollection<OpenProject>()
    for (const op of open) collection.Add(op)
    provider.registerInstance(ProjectExplorerService.Key, { OpenProjects: collection } as unknown as ProjectExplorerService)
    return { provider, meta, libs }
}

const hasNode = (bases: TodlDocument[], id: string): boolean => bases.some((b) => b.nodes.some((n) => n.id === id))

test('prefers an open producer\'s live document over the published artifact', async () => {
    const mm = await openProject('meta-model', 'ea', '0.1.0',
        producer(ProducerKind.MetaModel, 'namespace ea { concept LiveConcept { label : string; } }'))
    const { provider, meta } = env([mm])
    // Published copy has a DIFFERENT node, so we can tell which was used.
    await meta.WriteText('ea/0.1.0/model.json', JSON.stringify(toJSON(check([{ uri: 'x.todl', text: 'namespace ea { concept PublishedConcept { label : string; } }' }]).model)))

    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', metaModel: { id: 'ea', version: '0.1.0' } }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases, problems, originOf } = await resolver.ResolveForStorage(consumer)
    expect(hasNode(bases, 'LiveConcept')).toBe(true)
    expect(hasNode(bases, 'PublishedConcept')).toBe(false)
    expect(problems).toEqual([])
    // Provenance: a live open producer's concepts are open-source.
    expect(originOf.get('LiveConcept')?.kind).toBe(WikiOriginKind.OpenProject)
})

test('falls back to the published artifact when the producer is not open', async () => {
    const { provider, meta } = env([])
    await meta.WriteText('ea/0.1.0/model.json', JSON.stringify(toJSON(check([{ uri: 'x.todl', text: 'namespace ea { concept PublishedConcept { label : string; } }' }]).model)))
    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', metaModel: { id: 'ea', version: '0.1.0' } }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases, originOf } = await resolver.ResolveForStorage(consumer)
    expect(hasNode(bases, 'PublishedConcept')).toBe(true)
    // Provenance: a published concept is tagged with its package coordinates.
    expect(originOf.get('PublishedConcept')).toEqual({
        kind: WikiOriginKind.Package, backend: ProducerKind.MetaModel, id: 'ea', version: '0.1.0',
    })
})

test('an id match on a different version uses local and notes it in problems', async () => {
    const mm = await openProject('meta-model', 'ea', '0.2.0',
        producer(ProducerKind.MetaModel, 'namespace ea { concept LiveConcept { label : string; } }'))
    const { provider } = env([mm])
    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', metaModel: { id: 'ea', version: '0.1.0' } }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases, problems } = await resolver.ResolveForStorage(consumer)
    expect(hasNode(bases, 'LiveConcept')).toBe(true)
    expect(problems.some((p) => p.includes('0.1.0') && p.includes('0.2.0'))).toBe(true)
})

test('resolves recursively: architecture -> library -> meta-model, all local, meta-model first', async () => {
    const mm = await openProject('meta-model', 'ea', '0.1.0',
        producer(ProducerKind.MetaModel, 'namespace ea { concept MmNode { label : string; } }'))
    const lib = await openProject('library', 'acme', '0.1.0',
        producer(ProducerKind.Library, 'namespace acme { concept LibNode { label : string; } }'),
        { metaModel: { id: 'ea', version: '0.1.0' } })
    const { provider } = env([mm, lib])
    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(
        { type: 'architecture', metaModel: { id: 'ea', version: '0.1.0' }, libraries: [{ id: 'acme', version: '0.1.0' }] }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases, problems } = await resolver.ResolveForStorage(consumer)
    expect(hasNode(bases, 'MmNode')).toBe(true)
    expect(hasNode(bases, 'LibNode')).toBe(true)
    // The library also binds the meta-model the architecture binds (a diamond),
    // which must resolve cleanly — no false "cyclic local reference".
    expect(problems).toEqual([])
    // meta-model first (stable order the language server expects)
    const mmIdx = bases.findIndex((b) => b.nodes.some((n) => n.id === 'MmNode'))
    const libIdx = bases.findIndex((b) => b.nodes.some((n) => n.id === 'LibNode'))
    expect(mmIdx).toBeLessThan(libIdx)
})

test('diamond: architecture -> meta-model + two libraries that each bind it resolves without a false cycle', async () => {
    // Mirrors the real corpus: test_architecture binds tech-architecture plus the
    // microsoft and aws libraries, both of which are authored against
    // tech-architecture. Two sibling branches reach the same meta-model.
    const mm = await openProject('meta-model', 'tech', '0.1.0',
        producer(ProducerKind.MetaModel, 'namespace tech { concept MmNode { label : string; } }'))
    const libA = await openProject('library', 'microsoft', '0.1.0',
        producer(ProducerKind.Library, 'namespace microsoft { concept ANode { label : string; } }'),
        { metaModel: { id: 'tech', version: '0.1.0' } })
    const libB = await openProject('library', 'aws', '0.1.0',
        producer(ProducerKind.Library, 'namespace aws { concept BNode { label : string; } }'),
        { metaModel: { id: 'tech', version: '0.1.0' } })
    const { provider } = env([mm, libA, libB])
    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({
        type: 'architecture', metaModel: { id: 'tech', version: '0.1.0' },
        libraries: [{ id: 'microsoft', version: '0.1.0' }, { id: 'aws', version: '0.1.0' }],
    }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases, problems } = await resolver.ResolveForStorage(consumer)
    expect(problems.some((p) => p.includes('cyclic'))).toBe(false)
    expect(problems).toEqual([])
    expect(hasNode(bases, 'MmNode')).toBe(true)
    expect(hasNode(bases, 'ANode')).toBe(true)
    expect(hasNode(bases, 'BNode')).toBe(true)
})

test('a producer editing its own source does not resolve against itself', async () => {
    // A library that (pathologically) lists itself as a library binding.
    const lib = await openProject('library', 'acme', '0.1.0',
        producer(ProducerKind.Library, 'namespace acme { concept LibNode { label : string; } }'),
        { libraries: [{ id: 'acme', version: '0.1.0' }] })
    const { provider, libs } = env([lib])
    await libs.WriteText('acme/0.1.0/model.json', JSON.stringify(toJSON(check([{ uri: 'x.todl', text: 'namespace acme { concept PublishedLib { label : string; } }' }]).model)))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases } = await resolver.ResolveForStorage(lib.Storage)
    // Self-excluded → its self-binding falls back to published.
    expect(hasNode(bases, 'PublishedLib')).toBe(true)
})

test('a local producer with compile errors surfaces problems and still returns its document', async () => {
    const failing = {
        formats: [], producerKind: ProducerKind.MetaModel,
        compileToDocument: async () => ({ doc: toJSON(check([{ uri: 'p.todl', text: 'namespace ea { concept partial { label : string; } }' }]).model), problems: ['boom'] }),
    } as unknown as IProjectFactory & IProducerProjectFactory
    const mm = await openProject('meta-model', 'ea', '0.1.0', failing)
    const { provider } = env([mm])
    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'architecture', metaModel: { id: 'ea', version: '0.1.0' } }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases, problems } = await resolver.ResolveForStorage(consumer)
    expect(hasNode(bases, 'partial')).toBe(true)
    expect(problems.some((p) => p.includes('boom'))).toBe(true)
})

test('RefreshDependentsOfIds refreshes a changed producer\'s transitive dependents', async () => {
    // ea (meta-model) <- acme (library, binds ea) <- arch (binds ea + acme)
    const mm = await openProject('meta-model', 'ea', '0.1.0',
        producer(ProducerKind.MetaModel, 'namespace ea { concept c { label : string; } }'))
    const lib = await openProject('library', 'acme', '0.1.0',
        producer(ProducerKind.Library, 'namespace acme { concept l { label : string; } }'),
        { metaModel: { id: 'ea', version: '0.1.0' } })
    const arch = await openProject('architecture', 'sys', '0.1.0', { formats: [] } as unknown as IProjectFactory,
        { metaModel: { id: 'ea', version: '0.1.0' }, libraries: [{ id: 'acme', version: '0.1.0' }] })
    const { provider } = env([mm, lib, arch])

    const refreshed: IStorage[] = []
    provider.registerInstance(TodlLanguageClient.Key, {
        RefreshBases: async (s: IStorage) => { refreshed.push(s) },
    } as unknown as TodlLanguageClient)

    const resolver = new WorkspaceBaseResolver(provider)
    // Changing the meta-model must refresh both the library and the architecture.
    await resolver.RefreshDependentsOfIds(['ea'])
    expect(refreshed).toContain(lib.Storage)
    expect(refreshed).toContain(arch.Storage)
    // The meta-model itself is not a dependent of its own change.
    expect(refreshed).not.toContain(mm.Storage)
})

test('producedIdOf reports a producer\'s id and undefined for a consumer', async () => {
    const mm = await openProject('meta-model', 'ea', '0.1.0',
        producer(ProducerKind.MetaModel, 'namespace ea { concept c { label : string; } }'))
    const arch = await openProject('architecture', 'sys', '0.1.0', { formats: [] } as unknown as IProjectFactory,
        { metaModel: { id: 'ea', version: '0.1.0' } })
    const { provider } = env([mm, arch])
    const resolver = new WorkspaceBaseResolver(provider)
    // Force snapshot construction (producedIdOf reads the current snapshot).
    await resolver.ResolveForStorage(arch.Storage)
    expect(resolver.producedIdOf(mm.Storage)).toBe('ea')
    expect(resolver.producedIdOf(arch.Storage)).toBeUndefined()
})

// An own-only model.json with recorded base deps.
const ownDoc = (nodes: string[], dependencies?: unknown[]) =>
    JSON.stringify({
        nodes: nodes.map((id) => ({ id, tier: 'Type', typeOf: 'element', attrs: {} })),
        edges: [],
        ...(dependencies ? { dependencies } : {}),
    })

test('published fallback walks a package\'s recorded dependencies transitively', async () => {
    const { provider, meta, libs } = env([])
    // A published library that records a dependency on a published meta-model.
    await libs.WriteText('lib/0.1.0/model.json',
        ownDoc(['Button'], [{ kind: 'meta-model', id: 'ea', version: '1.0.0' }]))
    await meta.WriteText('ea/1.0.0/model.json', ownDoc(['widget']))

    // The consumer binds ONLY the library — its meta-model must be pulled in via
    // the library's recorded dependency.
    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(
        { type: 'architecture', libraries: [{ id: 'lib', version: '0.1.0' }] }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases, problems } = await resolver.ResolveForStorage(consumer)
    expect(problems).toEqual([])
    expect(hasNode(bases, 'Button')).toBe(true)
    expect(hasNode(bases, 'widget')).toBe(true)
})

test('referencedPublishedRefs collects the manifest bases as id@version keys', async () => {
    const { provider, meta, libs } = env([])
    await meta.WriteText('ea/1.0.0/model.json', ownDoc(['widget']))
    await libs.WriteText('acme/0.1.0/model.json', ownDoc(['Button']))

    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(
        { type: 'architecture', metaModel: { id: 'ea', version: '1.0.0' }, libraries: [{ id: 'acme', version: '0.1.0' }] }))

    const resolver = new WorkspaceBaseResolver(provider)
    const refs = await resolver.referencedPublishedRefs(consumer)
    expect([...refs].sort()).toEqual(['acme@0.1.0', 'ea@1.0.0'])
})

test('referencedPublishedRefs walks a package\'s recorded dependencies transitively', async () => {
    const { provider, meta, libs } = env([])
    // The consumer binds ONLY the library, which records a dependency on a meta-model.
    await libs.WriteText('lib/0.1.0/model.json',
        ownDoc(['Button'], [{ kind: 'meta-model', id: 'ea', version: '1.0.0' }]))
    await meta.WriteText('ea/1.0.0/model.json', ownDoc(['widget']))

    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(
        { type: 'architecture', libraries: [{ id: 'lib', version: '0.1.0' }] }))

    const resolver = new WorkspaceBaseResolver(provider)
    const refs = await resolver.referencedPublishedRefs(consumer)
    // The meta-model is pulled in via the library's recorded dependency.
    expect([...refs].sort()).toEqual(['ea@1.0.0', 'lib@0.1.0'])
})

test('referencedPublishedRefs still records an unpublished base by its own key', async () => {
    const { provider } = env([])   // no published artifacts
    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(
        { type: 'architecture', libraries: [{ id: 'missing', version: '9.9.9' }] }))

    const resolver = new WorkspaceBaseResolver(provider)
    const refs = await resolver.referencedPublishedRefs(consumer)
    // Best-effort: the direct ref is recorded even though its model.json is absent.
    expect([...refs]).toEqual(['missing@9.9.9'])
})

test('published transitive walk resolves a shared meta-model only once (diamond)', async () => {
    const { provider, meta, libs } = env([])
    await meta.WriteText('ea/1.0.0/model.json', ownDoc(['widget']))
    await libs.WriteText('a/0.1.0/model.json', ownDoc(['A'], [{ kind: 'meta-model', id: 'ea', version: '1.0.0' }]))
    await libs.WriteText('b/0.1.0/model.json', ownDoc(['B'], [{ kind: 'meta-model', id: 'ea', version: '1.0.0' }]))

    const consumer = new FakeStorage('C:/arch')
    await consumer.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(
        { type: 'architecture', libraries: [{ id: 'a', version: '0.1.0' }, { id: 'b', version: '0.1.0' }] }))

    const resolver = new WorkspaceBaseResolver(provider)
    const { bases, problems } = await resolver.ResolveForStorage(consumer)
    expect(problems).toEqual([])
    expect(bases.filter((base) => base.nodes.some((n) => n.id === 'widget')).length).toBe(1)
})
