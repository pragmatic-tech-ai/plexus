import { test } from 'vitest'
import assert from 'node:assert/strict'
import { FileChangeKind } from '@pragmatic-tech-ai/todl-runtime'
import type { FileChange, StorageEntry } from '@pragmatic-tech-ai/todl-runtime'
import type { StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import { RemoteFileStorage } from '../remote-file-storage.js'
import type { IDevStorageSession } from '../remote-file-storage.js'

class FakeSession implements IDevStorageSession
{
    readonly bytes = new Map<string, Uint8Array>()
    readonly text = new Map<string, string>()
    readonly listings = new Map<string, StorageEntry[]>()
    readonly handlers = new Set<(c: StorageChangedPayload) => void>()

    async ReadText(path: string): Promise<string>
    {
        return this.text.get(path) ?? ''
    }

    async ReadBytes(path: string): Promise<Uint8Array>
    {
        return this.bytes.get(path) ?? new Uint8Array()
    }

    async WriteText(path: string, content: string): Promise<void>
    {
        this.text.set(path, content)
    }

    async WriteBytes(path: string, b: Uint8Array): Promise<void>
    {
        this.bytes.set(path, Uint8Array.from(b))
    }

    async Exists(path: string): Promise<boolean>
    {
        return this.text.has(path) || this.bytes.has(path)
    }

    async Delete(path: string): Promise<void>
    {
        this.text.delete(path)
        this.bytes.delete(path)
    }

    async CreateDirectory(_path: string): Promise<void>
    {}

    async Rename(from: string, to: string): Promise<void>
    {
        const t = this.text.get(from)
        if (t !== undefined)
        {
            this.text.set(to, t)
            this.text.delete(from)
        }
    }

    async List(path: string): Promise<readonly StorageEntry[]>
    {
        return this.listings.get(path) ?? []
    }

    OnStorageChanged(handler: (c: StorageChangedPayload) => void): () => void
    {
        this.handlers.add(handler)
        return () =>
        {
            this.handlers.delete(handler)
        }
    }

    Emit(c: StorageChangedPayload): void
    {
        for (const h of [...this.handlers]) h(c)
    }
}

test('Root returns the remote root', () =>
{
    assert.equal(new RemoteFileStorage(new FakeSession(), '/srv/sol').Root, '/srv/sol')
})

test('binary round-trip is byte-exact incl. high bytes', async () =>
{
    const s = new RemoteFileStorage(new FakeSession(), '/r')
    const data = Uint8Array.from([0, 1, 127, 128, 200, 254, 255])
    await s.WriteBytes('a/b.bin', data)
    assert.deepEqual(Array.from(await s.ReadBytes('a/b.bin')), Array.from(data))
})

test('text, exists, delete, rename delegate', async () =>
{
    const s = new RemoteFileStorage(new FakeSession(), '/r')
    await s.WriteText('x.txt', 'hi')
    assert.equal(await s.ReadText('x.txt'), 'hi')
    assert.equal(await s.Exists('x.txt'), true)
    await s.Rename('x.txt', 'y.txt')
    assert.equal(await s.ReadText('y.txt'), 'hi')
    await s.Delete('y.txt')
    assert.equal(await s.Exists('y.txt'), false)
})

test('List preserves IsDirectory per entry', async () =>
{
    const f = new FakeSession()
    f.listings.set('d', [{ Name: 'sub', IsDirectory: true }, { Name: 'f.txt', IsDirectory: false }])
    const list = await new RemoteFileStorage(f, '/r').List('d')
    assert.deepEqual(list, [{ Name: 'sub', IsDirectory: true }, { Name: 'f.txt', IsDirectory: false }])
})

test('Watch maps kinds for direct children and ignores others; disposer unsubscribes', () =>
{
    const f = new FakeSession()
    const s = new RemoteFileStorage(f, '/r')
    const seen: FileChange[] = []
    const dispose = s.Watch('src', c => seen.push(c))
    f.Emit({ Kind: 'added', Path: 'src/a.ts', IsDirectory: false })
    f.Emit({ Kind: 'removed', Path: 'src/dir', IsDirectory: true })
    f.Emit({ Kind: 'changed', Path: 'src/b.ts', IsDirectory: false })
    f.Emit({ Kind: 'added', Path: 'other/a.ts', IsDirectory: false })
    f.Emit({ Kind: 'added', Path: 'src/deep/x.ts', IsDirectory: false })
    f.Emit({ Kind: 'added', Path: 'srcx/a.ts', IsDirectory: false })
    assert.deepEqual(seen, [
        { Kind: FileChangeKind.Added, Path: 'src/a.ts', IsDirectory: false },
        { Kind: FileChangeKind.Removed, Path: 'src/dir', IsDirectory: true },
        { Kind: FileChangeKind.Changed, Path: 'src/b.ts', IsDirectory: false },
    ])
    dispose()
    f.Emit({ Kind: 'added', Path: 'src/c.ts', IsDirectory: false })
    assert.equal(seen.length, 3)
    assert.equal(f.handlers.size, 0)
})

test('Watch of root \'\' sees top-level entries only', () =>
{
    const f = new FakeSession()
    const seen: FileChange[] = []
    new RemoteFileStorage(f, '/r').Watch('', c => seen.push(c))
    f.Emit({ Kind: 'added', Path: 'top.txt', IsDirectory: false })
    f.Emit({ Kind: 'added', Path: 'a/b.txt', IsDirectory: false })
    assert.deepEqual(seen.map(c => c.Path), ['top.txt'])
})

test('Watch matches a leading-slash payload path and emits the payload path verbatim', () =>
{
    const f = new FakeSession()
    const seen: FileChange[] = []
    new RemoteFileStorage(f, '/r').Watch('src', c => seen.push(c))
    f.Emit({ Kind: 'added', Path: '/src/a.ts', IsDirectory: false })
    assert.deepEqual(seen, [{ Kind: FileChangeKind.Added, Path: '/src/a.ts', IsDirectory: false }])
})

test('Watch matches backslash-separated payload paths', () =>
{
    const f = new FakeSession()
    const seen: FileChange[] = []
    new RemoteFileStorage(f, '/r').Watch('src', c => seen.push(c))
    f.Emit({ Kind: 'changed', Path: 'src\\a.ts', IsDirectory: false })
    assert.equal(seen.length, 1)
    assert.equal(seen[0].Path, 'src\\a.ts')
})

test('Watch ignores an off-contract Kind', () =>
{
    const f = new FakeSession()
    const seen: FileChange[] = []
    new RemoteFileStorage(f, '/r').Watch('src', c => seen.push(c))
    f.Emit({ Kind: 'bogus', Path: 'src/a.ts', IsDirectory: false } as unknown as StorageChangedPayload)
    assert.equal(seen.length, 0)
})
