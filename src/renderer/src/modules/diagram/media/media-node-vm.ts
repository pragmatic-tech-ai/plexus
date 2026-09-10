import { MetaData, MuralBase, Size } from '@pragmatic-tech-ai/mural/runtime'
import { NodeViewModel } from '@pragmatic-tech-ai/mural/framework'
import { BitmapImage } from '@pragmatic-tech-ai/mural/visual-engine'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { resolveImageUri } from '../../../services/markdown/markdown-image'
import { MediaKind } from './media-kind'

export interface MediaLoadDeps
{
    storage: IStorage
    baseDir?: string
    measure?: (uri: string) => Promise<Size | undefined>
}

// A content view-model for a media shape dropped/pasted onto the diagram. Carries
// no geometry (that lives in NodeVisualStore, like every other node) — only the
// media identity: kind, source (data URI / project-relative media path / URL),
// label, optional hyperlink target, and the resolved BitmapImage for image kinds.
export class MediaNodeVM extends NodeViewModel
{
    static readonly MediaKindKey    = MuralBase.RegisterProperty<MediaKind>(MediaNodeVM, 'MediaKind', MediaKind.Image, MetaData.None)
    static readonly SourceKey       = MuralBase.RegisterProperty<string | undefined>(MediaNodeVM, 'Source', undefined, MetaData.None)
    static readonly LabelKey        = MuralBase.RegisterProperty<string>(MediaNodeVM, 'Label', '', MetaData.None)
    static readonly HyperlinkUriKey = MuralBase.RegisterProperty<string | undefined>(MediaNodeVM, 'HyperlinkUri', undefined, MetaData.None)
    static readonly BitmapKey       = MuralBase.RegisterProperty<BitmapImage | undefined>(MediaNodeVM, 'Bitmap', undefined, MetaData.None)

    // Derived view flags the template triggers on (boolean triggers only — avoids
    // unproven string-equality data triggers). IsImage = show the picture;
    // ShowChip = show the icon+label chip (non-image kinds, or an image whose
    // bitmap failed/hasn't resolved — the error-handling fallback).
    static readonly IsImageKey  = MuralBase.RegisterProperty<boolean>(MediaNodeVM, 'IsImage', false, MetaData.None)
    static readonly ShowChipKey = MuralBase.RegisterProperty<boolean>(MediaNodeVM, 'ShowChip', true, MetaData.None)

    get MediaKind(): MediaKind { return this.get_property_value(MediaNodeVM.MediaKindKey) }
    set MediaKind(v: MediaKind) { this.set_property_value(MediaNodeVM.MediaKindKey, v); this._refreshViewFlags() }
    get Source(): string | undefined { return this.get_property_value(MediaNodeVM.SourceKey) }
    set Source(v: string | undefined) { this.set_property_value(MediaNodeVM.SourceKey, v) }
    get Label(): string { return this.get_property_value(MediaNodeVM.LabelKey) }
    set Label(v: string) { this.set_property_value(MediaNodeVM.LabelKey, v) }
    get HyperlinkUri(): string | undefined { return this.get_property_value(MediaNodeVM.HyperlinkUriKey) }
    set HyperlinkUri(v: string | undefined) { this.set_property_value(MediaNodeVM.HyperlinkUriKey, v) }
    get Bitmap(): BitmapImage | undefined { return this.get_property_value(MediaNodeVM.BitmapKey) }
    set Bitmap(v: BitmapImage | undefined) { this.set_property_value(MediaNodeVM.BitmapKey, v); this._refreshViewFlags() }
    get IsImage(): boolean { return this.get_property_value(MediaNodeVM.IsImageKey) }
    get ShowChip(): boolean { return this.get_property_value(MediaNodeVM.ShowChipKey) }

    private _refreshViewFlags(): void
    {
        const isImage = this.MediaKind === MediaKind.Image && this.Bitmap !== undefined
        this.set_property_value(MediaNodeVM.IsImageKey, isImage)
        this.set_property_value(MediaNodeVM.ShowChipKey, !isImage)
    }

    // Resolve Source → BitmapImage for image nodes; returns decoded natural size
    // (undefined for non-image kinds, or when the source can't be read/decoded).
    async LoadAsync(deps: MediaLoadDeps): Promise<Size | undefined>
    {
        if (this.MediaKind !== MediaKind.Image || this.Source === undefined) return undefined
        const uri = await resolveImageUri(this.Source, { storage: deps.storage, baseDir: deps.baseDir ?? '' })
        if (uri === undefined) return undefined
        const measure = deps.measure ?? decodeSizeInBrowser
        const natural = await measure(uri)
        this.Bitmap = new BitmapImage(uri, natural)
        return natural
    }
}

// Decode a URI to its intrinsic size via a browser HTMLImageElement. Returns
// undefined off the main thread (mirrors markdown-image's private decoder).
function decodeSizeInBrowser(uri: string): Promise<Size | undefined>
{
    const Ctor = (globalThis as { Image?: new () => HTMLImageElement }).Image
    if (Ctor === undefined) return Promise.resolve(undefined)
    return new Promise((resolve) => {
        const el = new Ctor()
        el.onload = (): void => resolve(new Size(el.naturalWidth, el.naturalHeight))
        el.onerror = (): void => resolve(undefined)
        el.src = uri
    })
}
