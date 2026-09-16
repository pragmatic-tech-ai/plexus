import { describe, it, expect } from 'vitest'
import { toolboxContextsOf } from '../toolbox-contexts.js'

describe('toolboxContextsOf', () => {
    it('reads a document\'s ToolboxContexts, empty set when absent', () => {
        expect([...toolboxContextsOf({ ToolboxContexts: new Set(['x@1.0.0', 'model:p']) })].sort())
            .toEqual(['model:p', 'x@1.0.0'])
        expect(toolboxContextsOf({}).size).toBe(0)
        expect(toolboxContextsOf(undefined).size).toBe(0)
    })
})
