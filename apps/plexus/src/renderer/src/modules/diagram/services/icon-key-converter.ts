import { Application } from '@pragmatic-tech-ai/mural/runtime'
import { parseSvgIcon, type IconDefinition } from '@pragmatic-tech-ai/mural/basic'
import { BitmapImage } from '@pragmatic-tech-ai/mural/visual-engine'

// The fallback glyph an entity renders when its icon resource key is empty or
// resolves nothing. A neutral "category" grid, monochrome (currentColor → themed
// by the Icon's Foreground). Swap this SVG to change the default look.
const DEFAULT_ICON_SVG =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/></svg>'

export const DEFAULT_ICON: IconDefinition = parseSvgIcon(DEFAULT_ICON_SVG)

let resolver: ((key: string) => unknown) | undefined

// Override the resource resolver. undefined restores the default
// Application.Resources lookup. Used by headless tests and by the registry to
// bridge its owned aggregate (headless-safe, no Application.current needed).
export function setIconResourceResolver(fn: ((key: string) => unknown) | undefined): void
{
    resolver = fn
}

function resolve(key: string): unknown
{
    if (resolver !== undefined) return resolver(key)
    return Application.current?.Resources.Resolve(key)
}

// A resolved asset that is a raster bitmap (baked BitmapImage) rather than a vector
// IconDefinition. Raster icons render through the default template's Image element,
// so the Icon converter yields nothing for them.
function isBitmap(asset: unknown): asset is BitmapImage
{
    return asset instanceof BitmapImage
}

// Binding converter for the default template's Icon (vector): an icon resource-key
// string → its colored IconDefinition, or the default glyph when the key is empty or
// resolves nothing. Returns undefined when the key resolves to a RASTER asset, so the
// Image element draws it and no glyph shows behind. Instantiated zero-arg by markup
// (`$IconKey << IconKeyConverter`); receives the bound value only.
export class IconKeyConverter
{
    public convert(key: unknown): unknown
    {
        const k = typeof key === 'string' ? key : ''
        if (k === '') return DEFAULT_ICON
        const hit = resolve(k)
        if (hit === undefined || hit === null) return DEFAULT_ICON
        return isBitmap(hit) ? undefined : hit
    }
}

// Binding converter for the default template's Image (raster): an icon resource-key
// string → its BitmapImage when the key resolves to one, else undefined (an empty
// Image draws nothing; a vector icon is drawn by the Icon element instead).
export class ImageKeyConverter
{
    public convert(key: unknown): unknown
    {
        const k = typeof key === 'string' ? key : ''
        if (k === '') return undefined
        const hit = resolve(k)
        return isBitmap(hit) ? hit : undefined
    }
}

// Shared singleton converter instances for MARKUP use. A `.mu` binding converter
// reference (`$IconKey << iconKeyConverter`) compiles to the bare symbol with
// `.convert` called on it (see mural's compileConverterRef — no `new`, no dotted
// paths), so the symbol must resolve to an INSTANCE, not the class. This mirrors
// the ValueConverter-instance pattern of ZoomPercent. The classes above stay for
// direct/typed use (and their unit test constructs them with `new`).
export const iconKeyConverter = new IconKeyConverter()
export const imageKeyConverter = new ImageKeyConverter()
