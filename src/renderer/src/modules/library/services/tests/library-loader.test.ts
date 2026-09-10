import { test, expect } from 'vitest'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { discoverLibraries, loadLibrary } from '../library-loader.js'

function manifest(id: string): string {
    return JSON.stringify({
        id, version: '0.1.0', name: id, metaModel: { id: 'ea', version: '5' },
        classes: [{ id: `${id}.azure`, localId: 'azure', label: 'Azure', concept: 'location', template: `visuals/${id}.azure.mural` }],
        assets: [], docs: [], samples: [],
    })
}

test('a class icon path surfaces on the LoadedClass', async () => {
    const s = new FakeStorage('fake://libraries')
    await s.WriteText('microsoft/0.1.0/library.json', JSON.stringify({
        id: 'microsoft', version: '0.1.0', name: 'microsoft', metaModel: { id: 'ea', version: '5' },
        classes: [{ id: 'microsoft.azure', concept: 'location', icon: 'resources/azure.svg' }],
    }))
    const lib = await loadLibrary(s, 'microsoft', '0.1.0')
    expect(lib.classes[0]!.icon).toBe('resources/azure.svg')
})

test('discovers every published <id>/<version> and loads its classes', async () => {
    const b = new FakeStorage('fake://libraries')
    await b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))
    await b.WriteText('microsoft/0.1.0/visuals/microsoft.azure.mural', 'TextBlock [ Text = $Display ]')
    await b.WriteText('aws/0.1.0/library.json', manifest('aws'))

    const libs = await discoverLibraries(b)
    expect(libs.map((l) => l.id).sort()).toEqual(['aws', 'microsoft'])
    const ms = libs.find((l) => l.id === 'microsoft')!
    expect(ms.classes[0]).toMatchObject({ id: 'microsoft.azure', concept: 'location', templatePath: 'visuals/microsoft.azure.mural' })
    expect(ms.problems).toEqual([])
})

test('a malformed manifest yields one error problem and no classes, not a throw', async () => {
    const b = new FakeStorage('fake://libraries')
    await b.WriteText('broken/0.1.0/library.json', '{ not json')
    const lib = await loadLibrary(b, 'broken', '0.1.0')
    expect(lib.classes).toEqual([])
    expect(lib.problems).toHaveLength(1)
    expect(lib.problems[0]).toMatchObject({ severity: 'error', uri: 'library.json' })
})

test('a class citing a missing template file records a warning but still loads', async () => {
    const b = new FakeStorage('fake://libraries')
    await b.WriteText('microsoft/0.1.0/library.json', manifest('microsoft'))   // template file absent
    const lib = await loadLibrary(b, 'microsoft', '0.1.0')
    expect(lib.classes).toHaveLength(1)
    expect(lib.problems).toEqual([{ severity: 'warning', uri: 'visuals/microsoft.azure.mural', message: expect.stringContaining('missing') }])
})

