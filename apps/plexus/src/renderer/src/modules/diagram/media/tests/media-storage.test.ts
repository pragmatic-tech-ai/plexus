import { describe, it, expect, vi } from 'vitest'
import { MediaKind } from '../media-kind'
import { LargeFileChoice, MEDIA_INLINE_LIMIT_BYTES, resolveDroppedFile, writeMedia } from '../media-storage'

function fakeStorage() {
    const files = new Map<string, Uint8Array>()
    return {
        files,
        Root: '',
        ReadText: vi.fn(), WriteText: vi.fn(), Delete: vi.fn(), Rename: vi.fn(), List: vi.fn(),
        ReadBytes: vi.fn(async (p: string) => files.get(p)!),
        WriteBytes: vi.fn(async (p: string, b: Uint8Array) => { files.set(p, b) }),
        Exists: vi.fn(async (p: string) => files.has(p)),
        CreateDirectory: vi.fn(async () => {}),
    }
}

describe('resolveDroppedFile', () => {
    it('inlines a sub-1MB image as a data URI', async () => {
        const storage = fakeStorage()
        const r = await resolveDroppedFile(
            { name: 'a.png', kind: MediaKind.Image, bytes: new Uint8Array([1, 2, 3]) },
            { storage, promptLargeFile: async () => LargeFileChoice.Embed },
        )
        expect(r.source.startsWith('data:image/png;base64,')).toBe(true)
        expect(r.label).toBe('a.png')
        expect(storage.WriteBytes).not.toHaveBeenCalled()
    })

    it('copies a large image into media/ without prompting', async () => {
        const storage = fakeStorage()
        const big = new Uint8Array(MEDIA_INLINE_LIMIT_BYTES + 1)
        const prompt = vi.fn(async () => LargeFileChoice.Link)
        const r = await resolveDroppedFile(
            { name: 'big.png', kind: MediaKind.Image, bytes: big }, { storage, promptLargeFile: prompt },
        )
        expect(r.source).toBe('media/big.png')
        expect(prompt).not.toHaveBeenCalled() // images never prompt
        expect(storage.WriteBytes).toHaveBeenCalledOnce()
    })

    it('prompts on a large arbitrary file and links when chosen', async () => {
        const storage = fakeStorage()
        const big = new Uint8Array(MEDIA_INLINE_LIMIT_BYTES + 1)
        const r = await resolveDroppedFile(
            { name: 'big.pdf', kind: MediaKind.FileLink, bytes: big, osPath: 'C:/x/big.pdf' },
            { storage, promptLargeFile: async () => LargeFileChoice.Link },
        )
        expect(r.source).toBe('C:/x/big.pdf')
        expect(storage.WriteBytes).not.toHaveBeenCalled()
    })

    it('prompts on a large arbitrary file and embeds when chosen', async () => {
        const storage = fakeStorage()
        const big = new Uint8Array(MEDIA_INLINE_LIMIT_BYTES + 1)
        const r = await resolveDroppedFile(
            { name: 'big.pdf', kind: MediaKind.FileLink, bytes: big, osPath: 'C:/x/big.pdf' },
            { storage, promptLargeFile: async () => LargeFileChoice.Embed },
        )
        expect(r.source).toBe('media/big.pdf')
        expect(storage.WriteBytes).toHaveBeenCalledOnce()
    })
})

describe('writeMedia', () => {
    it('de-duplicates a colliding name', async () => {
        const storage = fakeStorage()
        await writeMedia(storage, 'a.png', new Uint8Array([1]))
        const second = await writeMedia(storage, 'a.png', new Uint8Array([2]))
        expect(second).toBe('media/a-1.png')
    })
})
