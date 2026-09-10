import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { IDocument } from '@pragmatic-tech-ai/mural/framework'

import type { IDocumentFactory, IRelocatableDocumentFactory } from '../../services/documents/document-factory.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { CodeDocument } from './code-document.js'
import { StorageCodeFile } from './code-file.js'

// A generic plain-text document editor: opens any file as a CodeDocument over the
// project's IStorage, edited in the Monaco CodeEditor. Unlike TodlDocumentFactory
// it wires no language server or diagnostics — just open/save/new/relocate — so it
// serves file types that only need editing + syntax colouring (mural `.mu`/`.mural`
// today; more extensions can register the same factory). The Monaco language is
// inferred from the extension by CodeDocument (LANGUAGE_BY_EXT).
export class CodeDocumentFactory extends ServiceBase implements IDocumentFactory, IRelocatableDocumentFactory
{
    public static readonly Key = new ServiceKey<CodeDocumentFactory>('CodeDocumentFactory')

    // Default extension for a new file when the caller's name carries none.
    private static readonly DEFAULT_EXT = '.mural'

    constructor(provider?: IServiceProvider) { super(provider as IServiceProvider) }

    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        return new CodeDocument(new StorageCodeFile(storage, path))
    }

    public async saveFile(document: IDocument): Promise<void>
    {
        await (document as CodeDocument).Save()
    }

    public async newFile(storage: IStorage, name: string): Promise<string>
    {
        const path = hasKnownExt(name) ? name : name + CodeDocumentFactory.DEFAULT_EXT
        await storage.WriteText(path, '')
        return path
    }

    // In-place rename: re-point the open document at the new project-relative path
    // (Content/dirty preserved; Id/Title/Language refresh from the new extension).
    public relocateOpenFile(document: IDocument, newPath: string): void
    {
        (document as CodeDocument).Relocate(newPath)
    }

    // Cross-project move: re-point at the target storage + path, tab stays open.
    public relocateAcrossStorage(document: IDocument, storage: IStorage, newPath: string): void
    {
        (document as CodeDocument).RelocateTo(storage, newPath)
    }
}

// A name already ending in a mural extension keeps it; anything else gets the
// default. Kept narrow (the extensions this factory is registered for) so a plain
// base name like "visual" becomes "visual.mural", not "visual" with no extension.
function hasKnownExt(name: string): boolean
{
    const lower = name.toLowerCase()
    return lower.endsWith('.mu') || lower.endsWith('.mural')
}
