import { test, expect } from 'vitest'

import { MetaModelNodeKind } from '../meta-model-tree-node.js'
import { iconKeyForNodeKind } from '../meta-model-node-icon.js'

test('each node kind maps to a registered plexus-icons resource key', () => {
    expect(iconKeyForNodeKind(MetaModelNodeKind.Model)).toBe('MetaModels')
    expect(iconKeyForNodeKind(MetaModelNodeKind.Version)).toBe('Todl')
    expect(iconKeyForNodeKind(MetaModelNodeKind.Group)).toBe('Folder')
    expect(iconKeyForNodeKind(MetaModelNodeKind.Entity)).toBe('File')
})
