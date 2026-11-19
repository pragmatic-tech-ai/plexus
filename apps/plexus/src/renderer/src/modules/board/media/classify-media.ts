import { MediaKind } from './media-kind'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])

export function isImageExtension(nameOrPath: string): boolean
{
    const dot = nameOrPath.lastIndexOf('.')
    if (dot < 0) return false
    return IMAGE_EXTENSIONS.has(nameOrPath.slice(dot + 1).toLowerCase())
}

export function classifyFile(file: { name: string; type: string }): MediaKind
{
    if (file.type.startsWith('image/')) return MediaKind.Image
    if (isImageExtension(file.name)) return MediaKind.Image
    return MediaKind.FileLink
}

export function classifyUri(uri: string): MediaKind
{
    if (isImageExtension(uri)) return MediaKind.Image
    if (/^https?:/i.test(uri)) return MediaKind.Hyperlink
    return MediaKind.FileLink // file:// and anything else opens as a file link
}
