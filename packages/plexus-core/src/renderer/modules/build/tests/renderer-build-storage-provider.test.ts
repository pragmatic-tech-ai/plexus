import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { FileSystemService } from '../../storage/file-system-service.js'
import { RendererBuildStorageProvider } from '../renderer-build-storage-provider.js'

// In-memory fake of FileSystemService keyed by ABSOLUTE path (see the
// LocalFileStorage test). Records the order of Delete/CreateDirectory calls.
class FakeFileSystemService
{
    public readonly files = new Map<string, string>()
    public readonly dirs = new Set<string>()
    public readonly calls: string[] = []

    public async Exists(path: string): Promise<boolean>
    {
        if (this.files.has(path) || this.dirs.has(path))
        {
            return true
        }
        const prefix = path.endsWith('/') ? path : path + '/'
        for (const f of this.files.keys())
        {
            if (f.startsWith(prefix))
            {
                return true
            }
        }
        for (const d of this.dirs)
        {
            if (d.startsWith(prefix))
            {
                return true
            }
        }
        return false
    }

    public async Delete(path: string): Promise<void>
    {
        this.calls.push(`delete:${path}`)
        const prefix = path + '/'
        for (const f of [...this.files.keys()])
        {
            if (f === path || f.startsWith(prefix))
            {
                this.files.delete(f)
            }
        }
        for (const d of [...this.dirs])
        {
            if (d === path || d.startsWith(prefix))
            {
                this.dirs.delete(d)
            }
        }
    }

    public async CreateDirectory(path: string): Promise<void>
    {
        this.calls.push(`mkdir:${path}`)
        this.dirs.add(path)
    }
}

class Fixture
{
    public readonly fs = new FakeFileSystemService()
    public readonly provider = new RendererBuildStorageProvider('/userdata', this.fs as unknown as FileSystemService, '/')
}

test('OpenOutput with override creates <override>/<name>, cleaning stale content first', async () =>
{
    const x = new Fixture()
    x.fs.files.set('/p/build/html-bundle/stale.txt', 'old')
    const opened = await x.provider.OpenOutput('html-bundle', { OutputRootOverride: '/p/build' })
    assert.equal(opened.Path, '/p/build/html-bundle')
    assert.equal(x.fs.files.has('/p/build/html-bundle/stale.txt'), false)
    assert.ok(x.fs.dirs.has('/p/build/html-bundle'))
    assert.deepEqual(x.fs.calls, ['delete:/p/build/html-bundle', 'mkdir:/p/build/html-bundle'])
})

test('OpenOutput without OutputRootOverride does not throw and falls back under userData', async () =>
{
    const x = new Fixture()
    const opened = await x.provider.OpenOutput('npm-package', {})
    assert.equal(opened.Path, '/userdata/build-output/npm-package')
    assert.ok(x.fs.dirs.has('/userdata/build-output/npm-package'))
})

test('CreateSandbox yields distinct dirs under userData/build-sandboxes', async () =>
{
    const x = new Fixture()
    const a = await x.provider.CreateSandbox()
    const b = await x.provider.CreateSandbox()
    const ra = (a as unknown as { ResolveOsPath(p: string): string }).ResolveOsPath('')
    const rb = (b as unknown as { ResolveOsPath(p: string): string }).ResolveOsPath('')
    assert.ok(ra.startsWith('/userdata/build-sandboxes/sandbox-'))
    assert.ok(rb.startsWith('/userdata/build-sandboxes/sandbox-'))
    assert.notEqual(ra, rb)
    assert.ok(x.fs.dirs.has(ra))
    assert.ok(x.fs.dirs.has(rb))
})

test('DeleteSandbox removes the sandbox root', async () =>
{
    const x = new Fixture()
    const sandbox = await x.provider.CreateSandbox()
    const root = (sandbox as unknown as { ResolveOsPath(p: string): string }).ResolveOsPath('')
    assert.ok(x.fs.dirs.has(root))
    await x.provider.DeleteSandbox(sandbox)
    assert.equal(x.fs.dirs.has(root), false)
    assert.ok(x.fs.calls.includes(`delete:${root}`))
})
