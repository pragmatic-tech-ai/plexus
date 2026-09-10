import { MetaData, MuralBase } from '@pragmatic-tech-ai/mural/runtime'
import { FlowDocument } from '@pragmatic-tech-ai/mural/basic'
import type { IDocument } from '@pragmatic-tech-ai/mural/framework'

import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { renderMarkdown } from '../../services/markdown/marked-flow-renderer.js'

// A markdown (.md) file opened as a READ-ONLY rendered document tab. Holds the
// FlowDocument the DataTemplate[MarkdownDocument] lays out with a RichTextBlock —
// full-fidelity CommonMark+GFM via renderMarkdown (highlighted code, inline
// images, best-effort raw html). Id is the file's project-relative path so
// re-opening dedupes to one tab. Never dirties, never saves (view-only).
export class MarkdownDocument extends MuralBase implements IDocument
{
    public static readonly IdKey = MuralBase.RegisterProperty<string>(
        MarkdownDocument, 'Id', '', MetaData.None)
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        MarkdownDocument, 'Title', '', MetaData.None)
    public static readonly DocumentKey = MuralBase.RegisterProperty<FlowDocument>(
        MarkdownDocument, 'Document', undefined as unknown as FlowDocument, MetaData.None)

    // storage + path drive image resolution (local image paths resolve against the
    // .md file's folder); kept so Refresh can re-render with the same context.
    private readonly _storage?: IStorage
    private readonly _path: string

    public constructor(path: string, text: string, storage?: IStorage)
    {
        super()
        this._path = path
        this._storage = storage
        this.set_property_value(MarkdownDocument.IdKey, path)
        this.set_property_value(MarkdownDocument.TitleKey, fileName(path))
        this.set_property_value(MarkdownDocument.DocumentKey, this.render(text))
    }

    private render(text: string): FlowDocument
    {
        return renderMarkdown(text, {
            image: { storage: this._storage, baseDir: dirName(this._path) },
            openLink: openExternal,
        })
    }

    public get Id(): string { return this.get_property_value(MarkdownDocument.IdKey) }
    public get Title(): string { return this.get_property_value(MarkdownDocument.TitleKey) }
    public get Document(): FlowDocument { return this.get_property_value(MarkdownDocument.DocumentKey) }

    // Read-only: never dirty, save is a no-op (IDocument requires both).
    public get IsDirty(): boolean { return false }
    public Save(): void {}

    // Re-render from new text (the file changed on disk) so a reused tab isn't stale.
    public Refresh(text: string): void
    {
        this.set_property_value(MarkdownDocument.DocumentKey, this.render(text))
    }
}

// The file name (last path segment) of a path.
function fileName(path: string): string
{
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] || path
}

// The directory (project-relative, POSIX) containing a path; '' at the root.
function dirName(path: string): string
{
    const norm = path.replace(/\\/g, '/')
    const i = norm.lastIndexOf('/')
    return i > 0 ? norm.slice(0, i) : ''
}

// Best-effort external open for links. Guarded so the module stays safe outside a
// renderer window; in the renderer the browser routes it to the OS default.
function openExternal(uri: string): void
{
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(uri, '_blank', 'noopener')
    }
}
