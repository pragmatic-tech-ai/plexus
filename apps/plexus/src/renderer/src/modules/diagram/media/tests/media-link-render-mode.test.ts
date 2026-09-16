import { describe, it, expect } from 'vitest'
import { MediaLinkRenderMode, MEDIA_LINK_RENDER_MODE_SETTING, readMediaLinkRenderMode } from '../media-link-render-mode'

describe('readMediaLinkRenderMode', () => {
    it('defaults to ThumbnailLabel when unset', () => {
        expect(readMediaLinkRenderMode(() => undefined)).toBe(MediaLinkRenderMode.ThumbnailLabel)
    })
    it('reads a stored value', () => {
        const get = (k: string) => (k === MEDIA_LINK_RENDER_MODE_SETTING ? 'plain-link' : undefined)
        expect(readMediaLinkRenderMode(get)).toBe(MediaLinkRenderMode.PlainLink)
    })
    it('falls back to default on an unknown value', () => {
        expect(readMediaLinkRenderMode(() => 'bogus')).toBe(MediaLinkRenderMode.ThumbnailLabel)
    })
})
