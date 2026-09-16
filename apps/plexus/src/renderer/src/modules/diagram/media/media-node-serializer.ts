import { registerNodeSerializer, serializerByType } from '@pragmatic-tech-ai/mural/framework'
import { MediaKind } from './media-kind'
import { MediaNodeVM } from './media-node-vm'

// Persist media nodes into the .diagram. Geometry (position/size) rides the
// document's `visuals` section like every other node; this record carries only
// the media identity. Registered at module-import time (mirrors the arch node
// serializer) so a diagram loading before the drop handler is wired still
// restores its media nodes rather than dropping them.
export function registerMediaNodeSerializer(): void
{
    if (serializerByType('media') !== undefined) return
    registerNodeSerializer({
        type: 'media',
        matches: (n: unknown) => n instanceof MediaNodeVM,
        serialize: (node: unknown): Record<string, unknown> => {
            const vm = node as MediaNodeVM
            return {
                mediaKind:    vm.MediaKind,
                source:       vm.Source ?? '',
                hyperlinkUri: vm.HyperlinkUri ?? '',
                label:        vm.Label,
            }
        },
        deserialize: (data: Record<string, unknown>): MediaNodeVM => {
            const vm = new MediaNodeVM()
            vm.MediaKind    = (data.mediaKind as MediaKind) ?? MediaKind.Image
            vm.Source       = typeof data.source === 'string' && data.source.length > 0 ? data.source : undefined
            vm.HyperlinkUri = typeof data.hyperlinkUri === 'string' && data.hyperlinkUri.length > 0 ? data.hyperlinkUri : undefined
            vm.Label        = typeof data.label === 'string' ? data.label : ''
            return vm
        },
    })
}

registerMediaNodeSerializer()
