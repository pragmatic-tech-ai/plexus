import { describe, test, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { MuralRendererConfig } from '../mural-renderer.js'

describe('MuralRendererConfig', () => {
    test('resolve conditions route mural to dist (no "development")', () => {
        const r = MuralRendererConfig.resolve()
        expect(r.conditions).toEqual(['import', 'module', 'browser', 'default'])
        expect(r.conditions).not.toContain('development')
    })

    test('aliases redirect the opentype and node:module shims to shipped files', () => {
        const alias = MuralRendererConfig.resolve().alias
        const finds = alias.map((a) => a.find.source)
        expect(finds).toContain('^opentype\\.js$')
        expect(finds).toContain('^node:module$')
        // The shim replacement paths must point at files that actually exist.
        for (const a of alias) expect(existsSync(a.replacement), a.replacement).toBe(true)
    })

    test('optimizeDeps excludes mural and fresco', () => {
        const ex = MuralRendererConfig.optimizeDepsExclude()
        expect(ex).toContain('@pragmatic-tech-ai/mural')
        expect(ex).toContain('@pragmatic-tech-ai/fresco')
    })
})
