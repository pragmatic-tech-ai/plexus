import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { IDocument } from '@pragmatic-tech-ai/mural/framework'

import type { IDocumentFactory } from '../../services/documents/document-factory.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { MarkdownDocument } from './markdown-document.js'

// Opens .md/.markdown files as READ-ONLY rendered MarkdownDocuments. Registered by
// MarkdownViewerModule and resolved by the ProjectExplorerService via the file
// extension. Unlike CodeDocumentFactory it wires no editing — a markdown file is
// shown rendered (a RichTextBlock over the parsed FlowDocument), not as raw text.
export class MarkdownDocumentFactory extends ServiceBase implements IDocumentFactory
{
    public static readonly Key = new ServiceKey<MarkdownDocumentFactory>('MarkdownDocumentFactory')

    private static readonly DEFAULT_EXT = '.md'

    constructor(provider?: IServiceProvider) { super(provider as IServiceProvider) }

    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        return new MarkdownDocument(path, await storage.ReadText(path), storage)
    }

    // View-only: saving a rendered markdown tab writes nothing (it never dirties).
    public async saveFile(_document: IDocument): Promise<void> {}

    public async newFile(storage: IStorage, name: string): Promise<string>
    {
        const path = hasMarkdownExt(name) ? name : name + MarkdownDocumentFactory.DEFAULT_EXT
        await storage.WriteText(path, '')
        return path
    }
}

function hasMarkdownExt(name: string): boolean
{
    const lower = name.toLowerCase()
    return lower.endsWith('.md') || lower.endsWith('.markdown')
}
