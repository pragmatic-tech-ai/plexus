import { MetaData, MuralBase } from '@pragmatic-tech-ai/mural/runtime'
import { FlowDocument } from '@pragmatic-tech-ai/mural/basic'
import type { IDocument } from '@pragmatic-tech-ai/mural/framework'

import { buildFlowDocument } from '../markdown/markdown-document.js'

// The file name (last path segment) of an absolute path.
function fileName(path: string): string
{
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] || path
}

// A wiki page opened as a READ-ONLY document tab. Unlike CodeDocument it owns no
// editable text and never saves: it holds the parsed FlowDocument the
// DataTemplate[WikiDocument] lays out with a RichTextBlock. Id is the file's
// absolute path, so re-opening the same page dedupes to one tab.
export class WikiDocument extends MuralBase implements IDocument
{
    public static readonly IdKey = MuralBase.RegisterProperty<string>(
        WikiDocument, 'Id', '', MetaData.None)
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(
        WikiDocument, 'Title', '', MetaData.None)
    public static readonly DocumentKey = MuralBase.RegisterProperty<FlowDocument>(
        WikiDocument, 'Document', undefined as unknown as FlowDocument, MetaData.None)

    public constructor(path: string, text: string)
    {
        super()
        this.set_property_value(WikiDocument.IdKey, path)
        this.set_property_value(WikiDocument.TitleKey, fileName(path))
        this.set_property_value(WikiDocument.DocumentKey, buildFlowDocument(text))
    }

    public get Id(): string { return this.get_property_value(WikiDocument.IdKey) }
    public get Title(): string { return this.get_property_value(WikiDocument.TitleKey) }
    public get Document(): FlowDocument { return this.get_property_value(WikiDocument.DocumentKey) }

    // Read-only: never dirty, save is a no-op (IDocument requires both).
    public get IsDirty(): boolean { return false }
    public Save(): void {}

    // Re-render from new text (a regenerated page) so a reused tab isn't stale.
    public Refresh(text: string): void
    {
        this.set_property_value(WikiDocument.DocumentKey, buildFlowDocument(text))
    }
}
