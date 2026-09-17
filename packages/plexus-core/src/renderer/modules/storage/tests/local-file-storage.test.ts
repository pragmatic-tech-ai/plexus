import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { FileEntry } from '../../../../shared/file-system-api.js'
import type { FileSystemService } from '../file-system-service.js'
import { LocalFileStorage } from '../local-file-storage.js'

// An in-memory fake of FileSystemService keyed by ABSOLUTE path — asserts that
// LocalFileStorage joins root + relative correctly and delegates each verb. Files
// are strings; directories are tracked as a set so List/Exists behave. Only the
// methods LocalFileStorage calls are implemented; cast to FileSystemService.
class FakeFileSystemService {
  readonly files = new Map<string, string>()
  readonly dirs = new Set<string>()
  readonly opened: string[] = []

  async ReadText(path: string): Promise<string> {
    const v = this.files.get(path)
    if (v === undefined) throw new Error(`ENOENT ${path}`)
    return v
  }
  async ReadBytes(path: string): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.ReadText(path))
  }
  async WriteText(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }
  async WriteBytes(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, new TextDecoder().decode(bytes))
  }
  async Exists(path: string): Promise<boolean> {
    if (this.files.has(path) || this.dirs.has(path)) return true
    const prefix = path.endsWith('/') ? path : path + '/'
    for (const f of this.files.keys()) if (f.startsWith(prefix)) return true
    for (const d of this.dirs) if (d.startsWith(prefix)) return true
    return false
  }
  async Delete(path: string): Promise<void> {
    this.files.delete(path)
    this.dirs.delete(path)
  }
  async CreateDirectory(path: string): Promise<void> {
    this.dirs.add(path)
  }
  async Rename(from: string, to: string): Promise<void> {
    const v = this.files.get(from)
    if (v !== undefined) {
      this.files.set(to, v)
      this.files.delete(from)
    }
  }
  async ListDirectory(path: string): Promise<readonly FileEntry[]> {
    const prefix = path.endsWith('/') ? path : path + '/'
    const out: FileEntry[] = []
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length)
        if (!rest.includes('/')) out.push({ Name: rest, IsDirectory: false })
      }
    }
    return out
  }
  async OpenExternal(path: string): Promise<void> {
    this.opened.push(path)
  }
}

function storage(root: string): { s: LocalFileStorage; fs: FakeFileSystemService } {
  const fs = new FakeFileSystemService()
  return { s: new LocalFileStorage(root, fs as unknown as FileSystemService), fs }
}

test('joins root + relative path (POSIX root) and round-trips text', async () => {
  const { s, fs } = storage('/work/sol')
  await s.WriteText('a/b.txt', 'hi')
  assert.equal(fs.files.get('/work/sol/a/b.txt'), 'hi')
  assert.equal(await s.ReadText('a/b.txt'), 'hi')
  // WriteText mkdir'd the parent
  assert.ok(fs.dirs.has('/work/sol/a'))
})

test("abs('') resolves to the root itself", async () => {
  const { s, fs } = storage('/work/sol')
  await s.CreateDirectory('')
  assert.ok(fs.dirs.has('/work/sol'))
})

test('List on a missing directory returns empty, not a throw', async () => {
  const { s } = storage('/work/sol')
  assert.deepEqual(await s.List('nope'), [])
})

test('List maps FileEntry → StorageEntry', async () => {
  const { s } = storage('/work/sol')
  await s.WriteText('x.todl', '1')
  await s.WriteText('y.todl', '2')
  const entries = await s.List('')
  assert.deepEqual(
    entries.map((e) => ({ Name: e.Name, IsDirectory: e.IsDirectory })).sort((a, b) => a.Name.localeCompare(b.Name)),
    [
      { Name: 'x.todl', IsDirectory: false },
      { Name: 'y.todl', IsDirectory: false },
    ],
  )
})

test('ResolveOsPath joins; OpenExternal delegates the absolute path', async () => {
  const { s, fs } = storage('/work/sol')
  assert.equal(s.ResolveOsPath('a/b'), '/work/sol/a/b')
  await s.OpenExternal('a/b')
  assert.deepEqual(fs.opened, ['/work/sol/a/b'])
})

test('Windows-rooted storage joins with backslashes', async () => {
  const { s, fs } = storage('C:\\work\\sol')
  await s.WriteText('a/b.txt', 'hi')
  assert.equal(fs.files.get('C:\\work\\sol\\a\\b.txt'), 'hi')
})
