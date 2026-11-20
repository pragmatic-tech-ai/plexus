import { describe, it, expect } from 'vitest'
// @ts-expect-error - plain .mjs script without type declarations
import { FrameworkTypingsCollector } from '../build-framework-typings.mjs'
import { FrameworkTypings } from '../../src/renderer/src/modules/typescript/framework-typings.generated'

/** The committed typings snapshot: every framework package its .d.ts files import must be in it too. */
class Snapshot
{
    private static readonly ScopedImport = /(?:from\s+|import\s*\(\s*)["'](@pragmatic-tech-ai\/[a-z0-9-]+)/g
    private static readonly ManifestPath = /^file:\/\/\/node_modules\/(@pragmatic-tech-ai\/[a-z0-9-]+)\/package\.json$/
    private static readonly DtsSuffix = '.d.ts'

    public static Bundled(): Set<string>
    {
        return new Set(FrameworkTypings.map(e => Snapshot.ManifestPath.exec(e.FilePath)?.[1]).filter((p): p is string => p !== undefined))
    }

    public static Imported(): Set<string>
    {
        const imported = new Set<string>()
        for (const entry of FrameworkTypings.filter(e => e.FilePath.endsWith(Snapshot.DtsSuffix)))
        {
            for (const match of entry.Content.matchAll(Snapshot.ScopedImport))
            {
                imported.add(match[1])
            }
        }
        return imported
    }
}

describe('framework typings snapshot', () =>
{
    it('bundles every @pragmatic-tech-ai package the bundled typings import', () =>
    {
        const bundled = Snapshot.Bundled()
        expect([...Snapshot.Imported()].filter(p => !bundled.has(p)).sort()).toEqual([])
    })

    it('collects the graph engine TODL types against', () =>
    {
        expect(FrameworkTypingsCollector.Packages).toContain('@pragmatic-tech-ai/pragmatic-graph')
        expect(Snapshot.Bundled().has('@pragmatic-tech-ai/pragmatic-graph')).toBe(true)
    })
})
