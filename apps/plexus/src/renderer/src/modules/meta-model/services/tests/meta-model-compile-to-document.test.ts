import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { MetaModelProjectFactory } from '../meta-model-project-factory.js'

async function project(text: string): Promise<FakeStorage>
{
    const s = new FakeStorage('C:/mm')
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify({ type: 'meta-model', id: 'ea', modelVersion: '0.1.0' }))
    await s.WriteText('concepts.todl', text)
    return s
}

test('compileToDocument returns a document with the compiled nodes and no problems', async () => {
    const factory = new MetaModelProjectFactory(new ServiceProvider())
    const storage = await project('namespace d { concept location { label : string; } }')
    const { doc, problems } = await factory.compileToDocument(storage, [], new ServiceProvider())
    expect(problems).toEqual([])
    expect(doc.nodes.some((n) => n.id === 'location')).toBe(true)
})

test('compileToDocument reports compile errors as problems', async () => {
    const factory = new MetaModelProjectFactory(new ServiceProvider())
    // `ghost` is an undefined supertype → a TODL error.
    const storage = await project('namespace d { concept location : ghost { label : string; } }')
    const { problems } = await factory.compileToDocument(storage, [], new ServiceProvider())
    expect(problems.length).toBeGreaterThan(0)
})
