import { describe, it, expect } from 'vitest'
import { serializerByType } from '@pragmatic-tech-ai/mural/framework'
import { MediaKind } from '../media-kind'
import { MediaNodeVM } from '../media-node-vm'
import { registerMediaNodeSerializer } from '../media-node-serializer'

describe('media node serializer', () => {
    it('round-trips a hyperlink media node', () => {
        registerMediaNodeSerializer()
        const ser = serializerByType('media')!
        const vm = new MediaNodeVM()
        vm.MediaKind = MediaKind.Hyperlink
        vm.Source = 'https://example.com'
        vm.HyperlinkUri = 'https://example.com'
        vm.Label = 'Example'

        expect(ser.matches(vm)).toBe(true)
        const data = ser.serialize(vm)
        expect(data).toMatchObject({ mediaKind: 'hyperlink', source: 'https://example.com', label: 'Example' })

        const restored = ser.deserialize(data) as MediaNodeVM
        expect(restored.MediaKind).toBe(MediaKind.Hyperlink)
        expect(restored.Source).toBe('https://example.com')
        expect(restored.Label).toBe('Example')
    })
})
