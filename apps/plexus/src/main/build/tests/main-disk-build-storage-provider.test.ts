import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MainDiskBuildStorageProvider } from '../main-disk-build-storage-provider.js'

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

describe('MainDiskBuildStorageProvider', () =>
{
    const temp = new TempDirs()
    const freshUserData = (): string => temp.Create('plexus-main-build-')
    afterEach(() => temp.Dispose())

    it('OpenOutput cleans an existing output dir before writing and roots it at override/<name>', async () =>
    {
        const userData = freshUserData()
        const override = join(userData, 'proj', 'build')
        const provider = new MainDiskBuildStorageProvider(userData)

        const first = await provider.OpenOutput('html-bundle', { OutputRootOverride: override })
        expect(first.Path).toBe(join(override, 'html-bundle'))
        writeFileSync(join(first.Path, 'stale.txt'), 'old')

        const second = await provider.OpenOutput('html-bundle', { OutputRootOverride: override })
        expect(existsSync(join(second.Path, 'stale.txt'))).toBe(false)
        expect(existsSync(second.Path)).toBe(true)
    })

    it('OpenOutput throws when OutputRootOverride is missing', async () =>
    {
        const provider = new MainDiskBuildStorageProvider(freshUserData())
        await expect(provider.OpenOutput('html-bundle', {})).rejects.toThrow(/OutputRootOverride/)
    })

    it('CreateSandbox returns unique dirs under <userData>/build-sandboxes and DeleteSandbox removes them', async () =>
    {
        const userData = freshUserData()
        const provider = new MainDiskBuildStorageProvider(userData)
        const a = await provider.CreateSandbox()
        const b = await provider.CreateSandbox()
        const pa = (a as unknown as { Root: string }).Root
        const pb = (b as unknown as { Root: string }).Root
        expect(pa).not.toBe(pb)
        expect(dirname(pa)).toBe(join(userData, 'build-sandboxes'))
        expect(existsSync(pa)).toBe(true)
        await provider.DeleteSandbox(a)
        expect(existsSync(pa)).toBe(false)
    })
})
