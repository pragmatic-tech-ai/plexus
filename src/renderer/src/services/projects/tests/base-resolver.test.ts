import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { check, toJSON } from '@pragmatic-tech-ai/todl'

import { StorageProviderRegistry } from '../../storage/storage-provider-registry.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { META_MODELS_BACKEND_ID } from '../../../modules/meta-model/services/meta-models-backend.js'
import { LIBRARIES_BACKEND_ID } from '../../../modules/library/services/libraries-backend.js'
import { resolveBases } from '../base-resolver.js'

const CONCEPTS = 'namespace d { concept model { label : string; } concept location { label : string; } }'

// A provider whose meta-models + libraries backends resolve to inspectable
// FakeStorages (pre-registered so the ensure* Has-check finds them).
function env(): { provider: ServiceProvider; meta: FakeStorage; libs: FakeStorage }
{
    const provider = new ServiceProvider()
    const registry = new StorageProviderRegistry(provider)
    const meta = new FakeStorage('fake://meta-models')
    const libs = new FakeStorage('fake://libraries')
    registry.Register(META_MODELS_BACKEND_ID, () => meta)
    registry.Register(LIBRARIES_BACKEND_ID, () => libs)
    provider.registerInstance(StorageProviderRegistry.Key, registry)
    return { provider, meta, libs }
}

test('resolveBases reads a bound meta-model model.json', async () => {
    const { provider, meta } = env()
    await meta.WriteText('ea/5/model.json', JSON.stringify(toJSON(check([{ uri: 'c.todl', text: CONCEPTS }]).model)))
    const { bases, problems } = await resolveBases(provider, { metaModel: { id: 'ea', version: '5' } })
    expect(problems).toEqual([])
    expect(bases.length).toBe(1)
    expect(bases[0]!.nodes.some((n) => n.id === 'location')).toBe(true)
})

test('a missing base is reported in problems, not thrown', async () => {
    const { provider } = env()
    const { bases, problems } = await resolveBases(provider, { metaModel: { id: 'ghost', version: '1' } })
    expect(bases).toEqual([])
    expect(problems.length).toBe(1)
    expect(problems[0]).toMatch(/ghost/)
})

test('no bindings resolves to empty', async () => {
    const { provider } = env()
    const { bases, problems } = await resolveBases(provider, {})
    expect(bases).toEqual([])
    expect(problems).toEqual([])
})

// A minimal own-only model.json: some node ids + an optional recorded deps list.
const docJson = (nodes: string[], dependencies?: unknown[]) =>
    JSON.stringify({
        nodes: nodes.map((id) => ({ id, tier: 'Type', typeOf: 'element', attrs: {} })),
        edges: [],
        ...(dependencies ? { dependencies } : {}),
    })

test('walks a library dependency transitively to its meta-model', async () => {
    const { provider, meta, libs } = env()
    await meta.WriteText('meta/1.0.0/model.json', docJson(['widget']))
    await libs.WriteText('lib/0.1.0/model.json',
        docJson(['Button'], [{ kind: 'meta-model', id: 'meta', version: '1.0.0' }]))

    const { bases, problems } = await resolveBases(provider, { libraries: [{ id: 'lib', version: '0.1.0' }] })
    expect(problems).toEqual([])
    const ids = bases.flatMap((b) => b.nodes.map((n) => n.id))
    expect(ids).toContain('Button')
    expect(ids).toContain('widget')
})

test('resolves a shared meta-model only once (diamond)', async () => {
    const { provider, meta, libs } = env()
    await meta.WriteText('meta/1.0.0/model.json', docJson(['widget']))
    await libs.WriteText('a/0.1.0/model.json', docJson(['A'], [{ kind: 'meta-model', id: 'meta', version: '1.0.0' }]))
    await libs.WriteText('b/0.1.0/model.json', docJson(['B'], [{ kind: 'meta-model', id: 'meta', version: '1.0.0' }]))

    const { bases, problems } = await resolveBases(provider, {
        metaModel: { id: 'meta', version: '1.0.0' },
        libraries: [{ id: 'a', version: '0.1.0' }, { id: 'b', version: '0.1.0' }],
    })
    expect(problems).toEqual([])
    expect(bases.filter((b) => b.nodes.some((n) => n.id === 'widget')).length).toBe(1)
})

test('a missing transitive dependency is reported in problems', async () => {
    const { provider, libs } = env()
    await libs.WriteText('lib/0.1.0/model.json',
        docJson(['Button'], [{ kind: 'meta-model', id: 'meta', version: '9.9.9' }]))
    const { problems } = await resolveBases(provider, { libraries: [{ id: 'lib', version: '0.1.0' }] })
    expect(problems.some((p) => p.includes('meta') && p.includes('9.9.9'))).toBe(true)
})

test('is cycle-safe when packages reference each other', async () => {
    const { provider, libs } = env()
    await libs.WriteText('a/1.0.0/model.json', docJson(['A'], [{ kind: 'library', id: 'b', version: '1.0.0' }]))
    await libs.WriteText('b/1.0.0/model.json', docJson(['B'], [{ kind: 'library', id: 'a', version: '1.0.0' }]))
    const { bases, problems } = await resolveBases(provider, { libraries: [{ id: 'a', version: '1.0.0' }] })
    expect(problems).toEqual([])
    expect(bases.flatMap((b) => b.nodes.map((n) => n.id)).sort()).toEqual(['A', 'B'])
})
