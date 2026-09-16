import { describe, test, expect, vi } from 'vitest'
import { Size } from '@pragmatic-tech-ai/mural/runtime'
import { Image } from '@pragmatic-tech-ai/mural/basic'
import { BitmapImage } from '@pragmatic-tech-ai/mural/visual-engine'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    isRemoteUri, resolveLocalPath, mimeForPath, bytesToDataUri, resolveImageUri, loadImageInto,
} from '../markdown-image.js'

// Minimal in-memory storage exposing just ReadBytes for these tests.
function memStorage(files: Record<string, Uint8Array>): IStorage {
    return {
        Root: '/mem',
        ReadBytes: async (p: string) => {
            const f = files[p]
            if (f === undefined) throw new Error(`missing ${p}`)
            return f
        },
    } as unknown as IStorage
}

describe('isRemoteUri', () => {
    test('http/https/data/blob are remote; relative paths are not', () => {
        expect(isRemoteUri('https://x/y.png')).toBe(true)
        expect(isRemoteUri('http://x/y.png')).toBe(true)
        expect(isRemoteUri('data:image/png;base64,AA')).toBe(true)
        expect(isRemoteUri('blob:abc')).toBe(true)
        expect(isRemoteUri('./img/a.png')).toBe(false)
        expect(isRemoteUri('img/a.png')).toBe(false)
    })
})

describe('resolveLocalPath', () => {
    test('joins against the base dir', () => {
        expect(resolveLocalPath('docs', 'img/a.png')).toBe('docs/img/a.png')
        expect(resolveLocalPath('docs', './a.png')).toBe('docs/a.png')
    })
    test('honours .. and .', () => {
        expect(resolveLocalPath('docs/sub', '../assets/a.png')).toBe('docs/assets/a.png')
        expect(resolveLocalPath('docs/sub', '../../a.png')).toBe('a.png')
    })
    test('a leading slash is project-root relative', () => {
        expect(resolveLocalPath('docs/sub', '/assets/a.png')).toBe('assets/a.png')
    })
    test('strips query and hash', () => {
        expect(resolveLocalPath('docs', 'a.png?v=2#x')).toBe('docs/a.png')
    })
})

describe('mimeForPath', () => {
    test('maps common extensions, defaulting to png', () => {
        expect(mimeForPath('a.jpg')).toBe('image/jpeg')
        expect(mimeForPath('a.jpeg')).toBe('image/jpeg')
        expect(mimeForPath('a.gif')).toBe('image/gif')
        expect(mimeForPath('a.svg')).toBe('image/svg+xml')
        expect(mimeForPath('a.webp')).toBe('image/webp')
        expect(mimeForPath('a.png')).toBe('image/png')
        expect(mimeForPath('a.unknown')).toBe('image/png')
    })
})

describe('bytesToDataUri', () => {
    test('base64-encodes bytes with the mime', () => {
        const uri = bytesToDataUri(new Uint8Array([1, 2, 3]), 'image/png')
        expect(uri).toBe('data:image/png;base64,AQID')
    })
})

describe('resolveImageUri', () => {
    test('remote uris pass through unchanged', async () => {
        const uri = await resolveImageUri('https://x/y.png', { baseDir: 'docs' })
        expect(uri).toBe('https://x/y.png')
    })
    test('local paths are read from storage as a data url', async () => {
        const storage = memStorage({ 'docs/img/a.png': new Uint8Array([1, 2, 3]) })
        const uri = await resolveImageUri('img/a.png', { baseDir: 'docs', storage })
        expect(uri).toBe('data:image/png;base64,AQID')
    })
    test('a missing local file resolves undefined (no throw)', async () => {
        const storage = memStorage({})
        expect(await resolveImageUri('nope.png', { baseDir: 'docs', storage })).toBeUndefined()
    })
    test('a local path with no storage resolves undefined', async () => {
        expect(await resolveImageUri('a.png', { baseDir: 'docs' })).toBeUndefined()
    })
})

describe('loadImageInto', () => {
    test('sets Image.Source to a BitmapImage at the decoded size', async () => {
        const image = new Image()
        const measure = vi.fn(async () => new Size(200, 100))
        await loadImageInto(image, 'https://x/y.png', { baseDir: '', measure })
        expect(image.Source).toBeInstanceOf(BitmapImage)
        expect((image.Source as BitmapImage).Uri).toBe('https://x/y.png')
        expect(image.Source!.NaturalSize).toEqual(new Size(200, 100))
    })

    test('scales down oversized images preserving aspect ratio', async () => {
        const image = new Image()
        const measure = vi.fn(async () => new Size(1360, 680))   // 2x max width
        await loadImageInto(image, 'https://x/y.png', { baseDir: '', maxWidth: 680, measure })
        expect(image.Source!.NaturalSize).toEqual(new Size(680, 340))
    })

    test('leaves Source unset when the size cannot be decoded', async () => {
        const image = new Image()
        const measure = vi.fn(async () => undefined)
        await loadImageInto(image, 'https://x/y.png', { baseDir: '', measure })
        expect(image.Source).toBeUndefined()
    })

    test('inlines a local image from storage before decoding', async () => {
        const image = new Image()
        const storage = memStorage({ 'docs/a.png': new Uint8Array([1, 2, 3]) })
        const measure = vi.fn(async (uri: string) => (uri.startsWith('data:') ? new Size(10, 10) : undefined))
        await loadImageInto(image, 'a.png', { baseDir: 'docs', storage, measure })
        expect((image.Source as BitmapImage).Uri).toBe('data:image/png;base64,AQID')
        expect(image.Source!.NaturalSize).toEqual(new Size(10, 10))
    })
})
