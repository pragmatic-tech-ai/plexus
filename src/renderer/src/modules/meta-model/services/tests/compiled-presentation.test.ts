import { describe, it, expect } from 'vitest'
import { ResourceDictionary } from '@pragmatic-tech-ai/mural/runtime'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import { publishPresentation } from '../presentation-publisher.js'
import { loadCompiledPresentation } from '../compiled-presentation.js'

const SVG = '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>'

const DOC: TodlDocument = {
    nodes: [
        { id: 'application', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Application' } },
        { id: 'application@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/app.svg' } },
    ],
    edges: [{ kind: 'Annotated', via: null, from: 'application', to: 'application@icon' }],
} as unknown as TodlDocument

// Bake a compiled presentation artifact into a FakeStorage via the real publisher
// so the artifact format is always in sync.
async function bakePresentation(): Promise<FakeStorage> {
    const project = new FakeStorage('fake://proj')
    await project.WriteText('resources/app.svg', SVG)
    const backend = new FakeStorage('fake://backend')
    const res = await publishPresentation(project, backend, 'ea/1.0.0', DOC)
    expect(res.ok).toBe(true)
    return backend
}

describe('loadCompiledPresentation', () => {
    it('returns a ResourceDictionary that CanResolve the baked icon resource key', async () => {
        const storage = await bakePresentation()
        const dict = await loadCompiledPresentation(storage, 'ea/1.0.0')
        expect(dict).toBeInstanceOf(ResourceDictionary)
        expect(dict!.CanResolve('mm_icon_app')).toBe(true)
    })

    it('returns undefined when the compiled artifact is missing', async () => {
        const storage = new FakeStorage('fake://empty')
        const result = await loadCompiledPresentation(storage, 'ea/1.0.0')
        expect(result).toBeUndefined()
    })
})
