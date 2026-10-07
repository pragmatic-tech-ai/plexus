import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MainBuildProvider } from '../main-build-provider.js'

class TempDirs
{
    private readonly dirs: string[] = []

    public Create(prefix: string): string
    {
        const d = mkdtempSync(join(tmpdir(), prefix))
        this.dirs.push(d)
        return d
    }

    public Dispose(): void
    {
        for (const d of this.dirs.splice(0)) rmSync(d, { recursive: true, force: true })
    }
}

class Manifests
{
    public static readonly Architecture = JSON.stringify({ type: 'architecture', name: 'demo', version: 1 })
    public static readonly ProjectFile = 'project.plexus'
    public static readonly Library = JSON.stringify({ type: 'library', name: 'lib', version: 1 })
}

describe('MainBuildProvider', () =>
{
    const temp = new TempDirs()
    const userData = (): string => temp.Create('plexus-mbp-')
    afterEach(() => temp.Dispose())

    it('composes the node registry: html-bundle applies to an architecture project', () =>
    {
        const provider = new MainBuildProvider(userData())
        const rows = provider.Applicable(Manifests.Architecture)
        expect(rows.some((r) => r.systemId === 'html-bundle')).toBe(true)
    })

    it('does not offer html-bundle for a library project', () =>
    {
        const provider = new MainBuildProvider(userData())
        const rows = provider.Applicable(Manifests.Library)
        expect(rows.some((r) => r.systemId === 'html-bundle')).toBe(false)
    })

    it('returns [] for an unparseable manifest rather than throwing', () =>
    {
        const provider = new MainBuildProvider(userData())
        expect(provider.Applicable('not json')).toEqual([])
    })

    it('Build returns a result (does not throw) for a trivial project dir', async () =>
    {
        const proj = userData()
        writeFileSync(join(proj, Manifests.ProjectFile), Manifests.Library)
        const provider = new MainBuildProvider(userData())
        const libRows = provider.Applicable(Manifests.Library)
        const systemId = libRows.length > 0 ? libRows[0].systemId : 'npm-package'
        const out = await provider.Build({ projectRoot: proj, systemId, options: { OutputRootOverride: join(proj, 'build') } })
        expect(out).toBeDefined()
        expect(typeof out.Result.Ok).toBe('boolean')
    })
})
