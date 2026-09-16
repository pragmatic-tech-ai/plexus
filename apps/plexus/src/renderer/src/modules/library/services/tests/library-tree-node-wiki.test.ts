import { test, expect } from 'vitest'
import { LibraryTreeNode } from '../library-tree-node.js'
import type { TodlPresentationRegistry } from '../../../diagram/services/todl-presentation-registry.js'

const reg = { iconKeyFor: () => undefined } as unknown as TodlPresentationRegistry

test('a class leaf carries Concept and a settable HasWiki', () => {
    const n = LibraryTreeNode.leaf({ display: 'S3', label: 'S3', localId: 's3', termId: 't', concept: 'service' }, reg)
    expect(n.Concept).toBe('service')
    expect(n.HasWiki).toBe(false)
    n.HasWiki = true
    expect(n.HasWiki).toBe(true)
})
