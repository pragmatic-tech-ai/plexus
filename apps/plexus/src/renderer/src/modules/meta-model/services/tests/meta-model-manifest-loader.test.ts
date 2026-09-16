import { describe, it, expect } from 'vitest'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { loadMetaModelManifest } from '../meta-model-manifest-loader.js'

describe('loadMetaModelManifest', () => {
  it('round-trips a written manifest', async () => {
    const backend = new FakeStorage('fake://meta-models')
    const file = { id: 'ea', version: '0.1.0', name: 'EA', annotations: { author: { name: 'Acme' } } }
    await backend.WriteText('ea/0.1.0/manifest.json', JSON.stringify(file))

    const loaded = await loadMetaModelManifest(backend, 'ea', '0.1.0')
    expect(loaded.id).toBe('ea')
    expect(loaded.version).toBe('0.1.0')
    expect(loaded.name).toBe('EA')
    expect(loaded.annotations).toEqual({ author: { name: 'Acme' } })
    expect(loaded.problems).toEqual([])
  })

  it('returns a safe default with an error problem on malformed JSON', async () => {
    const backend = new FakeStorage('fake://meta-models')
    await backend.WriteText('ea/0.1.0/manifest.json', '{ not json')

    const loaded = await loadMetaModelManifest(backend, 'ea', '0.1.0')
    expect(loaded.name).toBe('ea')            // safe default = id
    expect(loaded.annotations).toEqual({})
    expect(loaded.problems.length).toBe(1)
    expect(loaded.problems[0]!.severity).toBe('error')
  })

  it('returns a safe default when the manifest file is missing', async () => {
    const backend = new FakeStorage('fake://meta-models')
    const loaded = await loadMetaModelManifest(backend, 'ea', '0.1.0')
    expect(loaded.name).toBe('ea')
    expect(loaded.annotations).toEqual({})
    expect(loaded.problems.length).toBe(1)
  })
})
