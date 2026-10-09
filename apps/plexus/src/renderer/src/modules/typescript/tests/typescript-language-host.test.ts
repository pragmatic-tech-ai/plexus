import { describe, it, expect, vi } from 'vitest'
import { CanonicalTypeScriptOptions } from '@pragmatic-tech-ai/todl/build-system-core'
import { TypeScriptLanguageHost } from '../typescript-language-host.js'

// monaco-editor needs `window` at import time and cannot load headlessly, so the
// enums are mocked with the real TypeScript numeric values; Monaco 0.55's ModuleResolutionKind has no Bundler member.
vi.mock('monaco-editor', () => ({
    typescript: {
        typescriptDefaults: {},
        ScriptTarget: { ES5: 1, ES2015: 2, ES2020: 7, ESNext: 99 },
        ModuleKind: { CommonJS: 1, ESNext: 99 },
        ModuleResolutionKind: { Classic: 1, NodeJs: 2 },
        JsxEmit: { None: 0, Preserve: 1, React: 2 },
    },
}))

describe('TypeScriptLanguageHost.MonacoOptions', () =>
{
    it('maps the canonical strings to Monaco enum values', () =>
    {
        const opts = TypeScriptLanguageHost.MonacoOptions(CanonicalTypeScriptOptions)
        expect(opts.target).toBe(7)
        expect(opts.module).toBe(99)
        expect(opts.moduleResolution).toBe(100)
        expect(opts.jsx).toBe(1)
        expect(opts.strict).toBe(true)
        expect(opts.noEmit).toBe(true)
        expect(opts.allowNonTsExtensions).toBe(true)
        expect(opts.lib).toEqual(CanonicalTypeScriptOptions.Lib.map((l) => l.toLowerCase()))
    })
})
