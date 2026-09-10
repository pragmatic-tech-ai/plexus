import { test, expect } from 'vitest'

import type { FileSystemService } from '../../file-system/file-system-service.js'
import type { FileEntry } from '../../../../../shared/file-system-api.js'
import { LocalFileStorage } from '../local-file-storage.js'
import { isLocalFileAccess } from '@pragmatic-tech-ai/todl-runtime'

// A FileSystemService stub that records the absolute path each call receives, so
// we can assert LocalFileStorage joins root + relative correctly and delegates.
function stubFs(): { fs: FileSystemService; calls: Array<[string, string]>; listResult: FileEntry[] }
{
    const calls: Array<[string, string]> = []
    const listResult: FileEntry[] = []
    const fs = {
        ReadText: (p: string) => { calls.push(['ReadText', p]); return Promise.resolve('text') },
        ReadBytes: (p: string) => { calls.push(['ReadBytes', p]); return Promise.resolve(new Uint8Array()) },
        WriteText: (p: string, _c: string) => { calls.push(['WriteText', p]); return Promise.resolve() },
        WriteBytes: (p: string, _b: Uint8Array) => { calls.push(['WriteBytes', p]); return Promise.resolve() },
        Exists: (p: string) => { calls.push(['Exists', p]); return Promise.resolve(true) },
        Delete: (p: string) => { calls.push(['Delete', p]); return Promise.resolve() },
        CreateDirectory: (p: string) => { calls.push(['CreateDirectory', p]); return Promise.resolve() },
        Rename: (f: string, t: string) => { calls.push(['Rename', `${f}=>${t}`]); return Promise.resolve() },
        ListDirectory: (p: string) => { calls.push(['ListDirectory', p]); return Promise.resolve(listResult) },
        OpenExternal: (p: string) => { calls.push(['OpenExternal', p]); return Promise.resolve() },
    } as unknown as FileSystemService
    return { fs, calls, listResult }
}

test('joins root + project-relative path with the POSIX root separator', async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('/root/proj', fs)
    await storage.ReadText('diagrams/a.diagram')
    expect(calls).toEqual([['ReadText', '/root/proj/diagrams/a.diagram']])
})

test("the root itself ('') resolves to the root, not root + '/'", async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('/root/proj', fs)
    await storage.List('')
    expect(calls).toEqual([['ListDirectory', '/root/proj']])
})

test('joins against a Windows (backslash) root using backslashes', async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('C:\\Users\\proj', fs)
    await storage.WriteText('sub/x.diagram', 'data')
    // The parent directory is created first (recursive mkdir), then the file written.
    expect(calls).toEqual([
        ['CreateDirectory', 'C:\\Users\\proj\\sub'],
        ['WriteText', 'C:\\Users\\proj\\sub\\x.diagram'],
    ])
})

test('WriteBytes joins the path and delegates to the binary write', async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('/root/proj', fs)
    await storage.WriteBytes('assets/logo.png', new Uint8Array([1, 2, 3]))
    expect(calls).toEqual([
        ['CreateDirectory', '/root/proj/assets'],
        ['WriteBytes', '/root/proj/assets/logo.png'],
    ])
})

// Regression: publishing a meta-model writes <id>/<version>/model.json to a fresh
// backend where none of those directories exist. Writing must create the parent
// tree first (matching FakeStorage, where a nested write always succeeds), or the
// real-disk backend ENOENTs — the publish bug.
test('WriteText creates the full parent tree for a deeply-nested new path', async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('/data/meta-models', fs)
    await storage.WriteText('tech-architecture/0.1.0/model.json', '{}')
    expect(calls).toEqual([
        ['CreateDirectory', '/data/meta-models/tech-architecture/0.1.0'],
        ['WriteText', '/data/meta-models/tech-architecture/0.1.0/model.json'],
    ])
})

test('a top-level write (no parent segment) skips the mkdir and just writes', async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('/root/proj', fs)
    await storage.WriteText('project.plexus', '{}')
    expect(calls).toEqual([['WriteText', '/root/proj/project.plexus']])
})

test('CreateDirectory joins the path and delegates to the backend', async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('/root/proj', fs)
    await storage.CreateDirectory('diagrams/sub')
    expect(calls).toEqual([['CreateDirectory', '/root/proj/diagrams/sub']])
})

test('Rename joins both paths and delegates', async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('/root/proj', fs)
    await storage.Rename('a/old.todl', 'a/new.todl')
    expect(calls).toEqual([['Rename', '/root/proj/a/old.todl=>/root/proj/a/new.todl']])
})

test('List maps FileEntry → StorageEntry', async () => {
    const { fs, listResult } = stubFs()
    listResult.push({ Name: 'a', IsDirectory: true }, { Name: 'b.diagram', IsDirectory: false })
    const storage = new LocalFileStorage('/r', fs)
    const entries = await storage.List('')
    expect(entries).toEqual([{ Name: 'a', IsDirectory: true }, { Name: 'b.diagram', IsDirectory: false }])
})

test('List returns [] for a directory that does not exist (matches FakeStorage, not a throw)', async () => {
    // readdir on a missing path rejects with ENOENT; a not-yet-created backend
    // (e.g. <userData>/meta-models before anything is published) hits exactly this.
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, scandir '/r/missing'"), { code: 'ENOENT' })
    const fs = {
        ListDirectory: () => Promise.reject(enoent),
        Exists: () => Promise.resolve(false),   // the directory genuinely isn't there
    } as unknown as FileSystemService
    const storage = new LocalFileStorage('/r', fs)
    expect(await storage.List('missing')).toEqual([])
})

test('List rethrows a listing failure when the directory DOES exist (a real error)', async () => {
    const eperm = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    const fs = {
        ListDirectory: () => Promise.reject(eperm),
        Exists: () => Promise.resolve(true),    // it exists, so the failure is genuine
    } as unknown as FileSystemService
    const storage = new LocalFileStorage('/r', fs)
    await expect(storage.List('secret')).rejects.toThrow('EPERM')
})

test('ReadBytes joins the path and delegates', async () => {
    const { fs, calls } = stubFs()
    await new LocalFileStorage('/root/proj', fs).ReadBytes('a/b.bin')
    expect(calls).toEqual([['ReadBytes', '/root/proj/a/b.bin']])
})

test('Root exposes the location descriptor', () => {
    const { fs } = stubFs()
    expect(new LocalFileStorage('/root/proj', fs).Root).toBe('/root/proj')
})

test('ResolveOsPath and OpenExternal go through the absolute join', async () => {
    const { fs, calls } = stubFs()
    const storage = new LocalFileStorage('/root/proj', fs)
    expect(storage.ResolveOsPath('a/b.txt')).toBe('/root/proj/a/b.txt')
    await storage.OpenExternal('a/b.txt')
    expect(calls).toEqual([['OpenExternal', '/root/proj/a/b.txt']])
})

test('is recognized as a local-file-access backend', () => {
    const { fs } = stubFs()
    expect(isLocalFileAccess(new LocalFileStorage('/r', fs))).toBe(true)
})
