import { describe, it, expect } from 'vitest'
// @ts-expect-error - plain .mjs script without type declarations
import { FrameworkTypingsCollector } from '../build-framework-typings.mjs'

class FakeFs
{
    public constructor(private readonly files: Record<string, string>) { }

    public exists(path: string): boolean
    {
        const prefix = path.endsWith('/') ? path : `${path}/`
        return path in this.files || Object.keys(this.files).some(k => k.startsWith(prefix))
    }

    public readText(path: string): string
    {
        return this.files[path]
    }

    public walk(dir: string): string[]
    {
        return Object.keys(this.files).filter(k => k.startsWith(`${dir}/`))
    }
}

describe('FrameworkTypingsCollector', () =>
{
    const Root = '/nm'
    const Pkg = '@scope/pkg'

    it('emits package.json and every .d.ts at file:///node_modules paths', () =>
    {
        const fs = new FakeFs({
            [`${Root}/${Pkg}/package.json`]: '{"name":"@scope/pkg"}',
            [`${Root}/${Pkg}/dist/index.d.ts`]: 'export * from "./sub/x.js";',
            [`${Root}/${Pkg}/dist/sub/x.d.ts`]: 'export declare const x: number;',
            [`${Root}/${Pkg}/dist/index.js`]: 'ignored',
        })
        const entries = new FrameworkTypingsCollector(fs, Root).Collect([Pkg, '@scope/missing'])
        const paths = entries.map((e: { FilePath: string }) => e.FilePath).sort()
        expect(paths).toEqual([
            'file:///node_modules/@scope/pkg/dist/index.d.ts',
            'file:///node_modules/@scope/pkg/dist/sub/x.d.ts',
            'file:///node_modules/@scope/pkg/package.json',
        ])
        const x = entries.find((e: { FilePath: string }) => e.FilePath.endsWith('/sub/x.d.ts'))
        expect(x.Content).toBe('export declare const x: number;')
    })

    it('skips a package without a package.json', () =>
    {
        const fs = new FakeFs({ [`${Root}/${Pkg}/dist/index.d.ts`]: 'x' })
        expect(new FrameworkTypingsCollector(fs, Root).Collect([Pkg])).toEqual([])
    })
})
