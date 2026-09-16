import { test, expect } from 'vitest'
import { MetaModelTreeNode } from '../meta-model-tree-node.js'

test('an entity node carries its Concept and a settable HasWiki', () => {
    const n = MetaModelTreeNode.entity('Service', { modelId: 'm', version: '1', id: 'service' }, () => {}, 'service')
    expect(n.Concept).toBe('service')
    expect(n.HasWiki).toBe(false)
    n.HasWiki = true
    expect(n.HasWiki).toBe(true)
})
