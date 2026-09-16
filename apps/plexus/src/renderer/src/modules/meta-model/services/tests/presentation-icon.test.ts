import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { publishPresentation } from '../presentation-publisher.js'
import { loadCompiledPresentation } from '../compiled-presentation.js'

const DOC: TodlDocument = {
    nodes: [
        { id: 'actor', tier: 'Ontology', typeOf: 'concept', attrs: { label: 'Actor' } },
        { id: 'actor@icon', tier: 'Ontology', typeOf: 'icon', attrs: { path: 'resources/actor.svg' } },
    ],
    edges: [{ kind: 'Annotated', via: null, from: 'actor', to: 'actor@icon' }],
} as unknown as TodlDocument

// The colored icon is embedded into the assets artifact at compile (parseSvgIcon over
// the SVG text, via the `include colored` keyword), keyed by its resource key, so it
// resolves standalone with no SVG file present. Guards the icon end to end: publish →
// load → the resource key resolves to a real IconDefinition (the IconKeyConverter then
// draws it in the one default template).
test('the baked colored icon resolves standalone from the assets artifact', async () => {
    const project = new FakeStorage('fake://proj')
    await project.WriteText('resources/actor.svg', '<svg viewBox="0 0 16 16"><path d="M2 2 L14 2 L14 14 Z"/></svg>')
    const backend = new FakeStorage('fake://meta-models')
    expect((await publishPresentation(project, backend, 'x/1.0.0', DOC)).ok).toBe(true)
    expect(await backend.Exists('x/1.0.0/presentation/resources/actor.svg')).toBe(false)   // baked, not a file

    const dict = await loadCompiledPresentation(backend, 'x/1.0.0')
    expect(dict).toBeDefined()
    expect(dict!.CanResolve('mm_icon_actor')).toBe(true)
    expect(dict!.Resolve('mm_icon_actor')).toBeDefined()
})
