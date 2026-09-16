import { test, expect } from 'vitest'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { deriveClasses, scanResources } from '../library-bundle.js'
import { jsonNode } from '../../../../test-support/todl-fixture.js'

// A hand-built model mirroring what the sample `microsoft` taxonomy compiles to
// (verified empirically): Ontology-tier concept/field/taxonomy DEFINITIONS plus
// two Instance-tier CLASS clabjects (attrs.class === true).
const MODEL: TodlDocument = {
    nodes: [
        jsonNode({ id: 'Location',   tier: 'Ontology', metaKind: 'concept',  attrs: {} }),
        jsonNode({ id: 'Technology', tier: 'Ontology', metaKind: 'concept',  attrs: {} }),
        jsonNode({ id: 'Microsoft',  tier: 'Ontology', metaKind: 'taxonomy', attrs: {} }),
        jsonNode({ id: 'Microsoft.Azure',        tier: 'Instance', type: 'Location',   metaKind: 'term', isClass: true, localId: 'Azure',        attrs: { label: 'Azure' } }),
        jsonNode({ id: 'Microsoft.AzureOpenai', tier: 'Instance', type: 'Technology', metaKind: 'term', isClass: true, localId: 'AzureOpenai', attrs: { label: 'Azure OpenAI' } }),
    ],
    edges: [],
}

test('derives only Instance-tier class clabjects, with localId/label/concept', () => {
    const classes = deriveClasses(MODEL)
    expect(classes).toEqual([
        { id: 'Microsoft.Azure',        localId: 'Azure',        label: 'Azure',        concept: 'Location' },
        { id: 'Microsoft.AzureOpenai', localId: 'AzureOpenai', label: 'Azure OpenAI', concept: 'Technology' },
    ])
})

test('ignores Ontology-tier definitions and non-class instances', () => {
    const model: TodlDocument = { nodes: [
        jsonNode({ id: 'x',     tier: 'Ontology', metaKind: 'concept',  attrs: {} }),
        jsonNode({ id: 'lib.i', tier: 'Instance', type: 'x',        localId: 'i', attrs: {} }),   // an instance, not a class
    ], edges: [] }
    expect(deriveClasses(model)).toEqual([])
})

test('derives the icon path from a class node icon annotation', () => {
    const model: TodlDocument = {
        nodes: [
            jsonNode({ id: 'Location', tier: 'Ontology', metaKind: 'concept', attrs: {} }),
            jsonNode({ id: 'Microsoft', tier: 'Ontology', metaKind: 'taxonomy', attrs: {} }),
            jsonNode({ id: 'Microsoft.Azure', tier: 'Instance', type: 'Location', metaKind: 'term', isClass: true, localId: 'Azure', attrs: { label: 'Azure' } }),
            jsonNode({ id: 'Microsoft.Azure@icon', tier: 'Ontology', type: 'icon', attrs: { path: 'resources/azure.svg' } }),
        ],
        edges: [{ kind: 'Annotated', via: null, from: 'Microsoft.Azure', to: 'Microsoft.Azure@icon' }],
    }
    expect(deriveClasses(model)[0]).toEqual({
        id: 'Microsoft.Azure', localId: 'Azure', label: 'Azure', concept: 'Location', icon: 'resources/azure.svg',
    })
})

test('binds resource files to classes by filename and lists bundle folders', async () => {
    const s = new FakeStorage('fake://lib')
    await s.WriteText('visuals/Microsoft.Azure.mural', '<template/>')
    await s.WriteText('thumbnails/Microsoft.Azure.png', 'PNGBYTES')
    await s.WriteText('docs/Microsoft.Azure.md', '# Azure')
    await s.WriteText('docs/README.md', '# Library')
    await s.WriteText('assets/logo.svg', '<svg/>')
    await s.WriteText('samples/demo.todl', 'sample')
    await s.WriteText('visuals/ghost.mural', '<template/>')   // orphan: unknown class

    const scanned = await scanResources(s, ['Microsoft.Azure', 'Microsoft.AzureOpenai'])

    expect(scanned.byClass.get('Microsoft.Azure')).toEqual({
        template: 'visuals/Microsoft.Azure.mural',
        thumbnail: 'thumbnails/Microsoft.Azure.png',
        doc: 'docs/Microsoft.Azure.md',
    })
    expect(scanned.byClass.has('Microsoft.AzureOpenai')).toBe(false)   // no files for it
    expect(scanned.assets).toEqual(['assets/logo.svg'])
    expect(scanned.docs.sort()).toEqual(['docs/Microsoft.Azure.md', 'docs/README.md'])
    expect(scanned.samples).toEqual(['samples/demo.todl'])
    expect(scanned.warnings).toEqual(['visuals/ghost.mural targets unknown class "ghost"'])
})

test('missing resource folders scan cleanly to empty', async () => {
    const scanned = await scanResources(new FakeStorage('fake://empty'), ['a'])
    expect(scanned.byClass.size).toBe(0)
    expect(scanned.assets).toEqual([])
    expect(scanned.warnings).toEqual([])
})
