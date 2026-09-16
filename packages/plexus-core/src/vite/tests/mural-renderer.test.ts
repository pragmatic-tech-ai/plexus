import { describe, test, expect } from 'vitest'
import { MuralRendererConfig } from '../mural-renderer.js'

describe('MuralRendererConfig', () => {
    test('resolve conditions route mural to dist (no "development")', () => {
        const r = MuralRendererConfig.resolve()
        expect(r.conditions).toEqual(['import', 'module', 'browser', 'default'])
        expect(r.conditions).not.toContain('development')
    })

    test('optimizeDeps excludes mural (bare + subpaths) and fresco', () => {
        const ex = MuralRendererConfig.optimizeDepsExclude()
        expect(ex).toContain('@pragmatic-tech-ai/mural')
        expect(ex).toContain('@pragmatic-tech-ai/mural/runtime')
        expect(ex).toContain('@pragmatic-tech-ai/mural/resources/material')
        expect(ex).toContain('@pragmatic-tech-ai/fresco')
    })
})
