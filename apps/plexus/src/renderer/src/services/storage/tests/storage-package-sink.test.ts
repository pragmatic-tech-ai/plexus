import { test, expect } from 'vitest'
import { StoragePackageSink } from '../storage-package-sink.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

function fakeStorage() {
    const files = new Map<string, string>()
    const storage = {
        Root: '/',
        WriteText: async (p: string, c: string) => void files.set(p, c),
        WriteBytes: async (p: string, b: Uint8Array) => void files.set(p, `bytes:${b.length}`),
    } as unknown as IStorage
    return { storage, files }
}

test('StoragePackageSink forwards writeText/writeBytes to IStorage', async () => {
    const { storage, files } = fakeStorage()
    const sink = new StoragePackageSink(storage)
    await sink.writeText('a/model.json', '{}')
    await sink.writeBytes('a/x.bin', new Uint8Array([1, 2, 3]))
    expect(files.get('a/model.json')).toBe('{}')
    expect(files.get('a/x.bin')).toBe('bytes:3')
})
