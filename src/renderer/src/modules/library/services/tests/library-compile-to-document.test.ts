import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { check, toJSON } from '@pragmatic-tech-ai/todl'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PROJECT_MANIFEST_FILENAME } from '../../../../services/projects/project-factory.js'
import { LibraryProjectFactory } from '../library-project-factory.js'

// The base meta-model defines `category`; the library extends it.
const META = 'namespace ea { concept category { label : string; } }'

async function libraryProject(text: string): Promise<FakeStorage>
{
    const s = new FakeStorage('C:/lib')
    await s.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(
        { type: 'library', id: 'acme', libVersion: '0.1.0', metaModel: { id: 'ea', version: '0.1.0' } }))
    await s.WriteText('terms.todl', text)
    return s
}

// A library source that extends a base concept — resolves only when the base is present.
const LIB = 'namespace acme { import ea; concept special : category { label : string; } }'

test('compileToDocument compiles the library sources against the given base', async () => {
    const factory = new LibraryProjectFactory(new ServiceProvider())
    const base = toJSON(check([{ uri: 'ea.todl', text: META }]).model)
    const storage = await libraryProject(LIB)
    const { doc, problems } = await factory.compileToDocument(storage, [base], new ServiceProvider())
    expect(problems).toEqual([])
    expect(doc.nodes.some((n) => n.id === 'special')).toBe(true)
})

test('compileToDocument reports errors when the base is absent (extends is unresolved)', async () => {
    const factory = new LibraryProjectFactory(new ServiceProvider())
    const storage = await libraryProject(LIB)
    const { problems } = await factory.compileToDocument(storage, [], new ServiceProvider())
    expect(problems.length).toBeGreaterThan(0)
})
