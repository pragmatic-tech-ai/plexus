import { describe, it, expect, vi } from 'vitest'
import { CanonicalTypeScriptOptions } from '@pragmatic-tech-ai/todl/build-system-core'
import { TypeScriptLanguageHost } from '../typescript-language-host.js'

const fake = vi.hoisted(() =>
{
    const state = {
        compilerOptions: [] as unknown[],
        eagerSync: [] as unknown[],
        extraLibs: [] as Array<[string, string]>,
        throwOnPath: 'bad.d.ts',
    }
    return state
})

// monaco-editor needs `window` at import time and cannot load headlessly, so it is
// mocked with the real TypeScript numeric enum values; Monaco 0.55's
// ModuleResolutionKind has no Bundler member.
vi.mock('monaco-editor', () => ({
    typescript: {
        typescriptDefaults: {
            setCompilerOptions: (o: unknown) => { fake.compilerOptions.push(o) },
            setEagerModelSync: (f: unknown) => { fake.eagerSync.push(f) },
            addExtraLib: (content: string, path: string) =>
            {
                fake.extraLibs.push([content, path])
                if (path === fake.throwOnPath) throw new Error('boom')
            },
        },
        ScriptTarget: { ES5: 0, ES2015: 2, ES2020: 7, ESNext: 99 },
        ModuleKind: { CommonJS: 1, ESNext: 99 },
        ModuleResolutionKind: { Classic: 1, NodeJs: 2 },
        JsxEmit: { None: 0, Preserve: 1, React: 2 },
    },
}))

vi.mock('../framework-typings.generated.js', () => ({
    FrameworkTypings: [
        { FilePath: 'bad.d.ts', Content: 'declare const a: 1' },
        { FilePath: 'good.d.ts', Content: 'declare const b: 2' },
    ],
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
        expect(opts.lib).toEqual(['lib.es2020.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'])
    })

    it('uses the enum lookup, not the fallbacks, for distinct inputs', () =>
    {
        const opts = TypeScriptLanguageHost.MonacoOptions({
            ...CanonicalTypeScriptOptions, Target: 'ES5', Module: 'CommonJS', Jsx: 'React',
        })
        expect(opts.target).toBe(0)
        expect(opts.module).toBe(1)
        expect(opts.jsx).toBe(2)
    })
})

describe('TypeScriptLanguageHost.Configure', () =>
{
    it('applies options, loads each typing (swallowing a failure), and is idempotent', () =>
    {
        expect(() => TypeScriptLanguageHost.Configure()).not.toThrow()

        expect(fake.compilerOptions).toHaveLength(1)
        const opts = fake.compilerOptions[0] as Record<string, unknown>
        expect(opts.target).toBe(7)
        expect(opts.strict).toBe(true)
        expect(opts.noEmit).toBe(true)
        expect(fake.eagerSync).toEqual([true])
        expect(fake.extraLibs).toEqual([
            ['declare const a: 1', 'bad.d.ts'],
            ['declare const b: 2', 'good.d.ts'],
        ])

        TypeScriptLanguageHost.Configure()
        expect(fake.compilerOptions).toHaveLength(1)
        expect(fake.eagerSync).toHaveLength(1)
        expect(fake.extraLibs).toHaveLength(2)
    })
})
