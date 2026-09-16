import { describe, it, expect, vi } from 'vitest'
import { Size } from '@pragmatic-tech-ai/mural/runtime'
import { MediaKind } from '../media-kind'
import { LargeFileChoice } from '../media-storage'
import { buildMediaNode } from '../media-drop-handler'

function deps() {
    const files = new Map<string, Uint8Array>()
    const storage = {
        Root: '', ReadText: vi.fn(), WriteText: vi.fn(), Delete: vi.fn(), Rename: vi.fn(), List: vi.fn(),
        ReadBytes: vi.fn(async (p: string) => files.get(p)!),
        WriteBytes: vi.fn(async (p: string, b: Uint8Array) => { files.set(p, b) }),
        Exists: vi.fn(async (p: string) => files.has(p)),
        CreateDirectory: vi.fn(async () => {}),
    }
    return {
        storage: storage as never,
        promptLargeFile: async () => LargeFileChoice.Embed,
        openExternal: vi.fn(async () => {}),
        newId: () => 'id-1',
        measure: async () => new Size(120, 90),
    }
}

describe('buildMediaNode', () => {
    it('builds an Image node from a small image File', async () => {
        const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
        const { vm, natural } = await buildMediaNode({ file }, deps())
        expect(vm.MediaKind).toBe(MediaKind.Image)
        expect(vm.Source?.startsWith('data:image/png')).toBe(true)
        expect(vm.Id).toBe('id-1')
        expect(natural?.Width).toBe(120)
    })

    it('builds a Hyperlink node from a URI', async () => {
        const { vm } = await buildMediaNode({ uri: 'https://example.com' }, deps())
        expect(vm.MediaKind).toBe(MediaKind.Hyperlink)
        expect(vm.HyperlinkUri).toBe('https://example.com')
        expect(vm.Source).toBe('https://example.com')
    })

    it('builds a FileLink node from a non-image URI', async () => {
        const { vm } = await buildMediaNode({ uri: 'file:///C:/docs/x.pdf' }, deps())
        expect(vm.MediaKind).toBe(MediaKind.FileLink)
        expect(vm.Source).toBe('file:///C:/docs/x.pdf')
    })
})
