// How dropped file/hyperlink chips render on the diagram. Image nodes ignore
// this — they always render as a picture.
export enum MediaLinkRenderMode
{
    IconLabel      = 'icon-label',
    ThumbnailLabel = 'thumbnail-label',
    PlainLink      = 'plain-link',
}

export const MEDIA_LINK_RENDER_MODE_SETTING = 'diagram.media.linkRenderMode'

const VALUES = new Set<string>(Object.values(MediaLinkRenderMode))

export function readMediaLinkRenderMode(get: (key: string) => unknown): MediaLinkRenderMode
{
    const raw = get(MEDIA_LINK_RENDER_MODE_SETTING)
    return typeof raw === 'string' && VALUES.has(raw)
        ? (raw as MediaLinkRenderMode)
        : MediaLinkRenderMode.ThumbnailLabel
}
