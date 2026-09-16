import { describe, it, expect, vi } from 'vitest'
import { Size } from '@pragmatic-tech-ai/mural/runtime'
import { MediaKind } from '../media-kind'
import { MediaNodeVM } from '../media-node-vm'

describe('MediaNodeVM', () => {
    it('round-trips DPs', () => {
        const vm = new MediaNodeVM()
        vm.MediaKind = MediaKind.Hyperlink
        vm.Source = 'https://example.com'
        vm.Label = 'Example'
        vm.HyperlinkUri = 'https://example.com'
        expect(vm.MediaKind).toBe(MediaKind.Hyperlink)
        expect(vm.Label).toBe('Example')
    })

    it('LoadAsync sets a BitmapImage for an image source', async () => {
        const vm = new MediaNodeVM()
        vm.MediaKind = MediaKind.Image
        vm.Source = 'data:image/png;base64,AAAA'
        const measure = vi.fn(async () => new Size(64, 48))
        const natural = await vm.LoadAsync({ storage: {} as never, measure })
        expect(natural?.Width).toBe(64)
        expect(vm.Bitmap).toBeDefined()
    })

    it('LoadAsync is a no-op for non-image kinds', async () => {
        const vm = new MediaNodeVM()
        vm.MediaKind = MediaKind.FileLink
        vm.Source = 'C:/x/y.pdf'
        const natural = await vm.LoadAsync({ storage: {} as never })
        expect(natural).toBeUndefined()
        expect(vm.Bitmap).toBeUndefined()
    })

    it('derives IsImage/ShowChip from kind + bitmap', async () => {
        const vm = new MediaNodeVM()
        // A file link shows the chip, never the picture.
        vm.MediaKind = MediaKind.FileLink
        expect(vm.IsImage).toBe(false)
        expect(vm.ShowChip).toBe(true)
        // An image with no resolved bitmap falls back to the chip.
        vm.MediaKind = MediaKind.Image
        expect(vm.IsImage).toBe(false)
        expect(vm.ShowChip).toBe(true)
        // Once the bitmap resolves, it shows the picture.
        vm.Source = 'data:image/png;base64,AAAA'
        await vm.LoadAsync({ storage: {} as never, measure: async () => new Size(10, 10) })
        expect(vm.IsImage).toBe(true)
        expect(vm.ShowChip).toBe(false)
    })
})
