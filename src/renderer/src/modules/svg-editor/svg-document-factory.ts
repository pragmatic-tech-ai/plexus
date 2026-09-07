import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { IDocument } from '@pragmatic-tech-ai/mural/framework'
import type { IDocumentFactory, IRelocatableDocumentFactory } from '../../services/documents/document-factory.js'
import type { IStorage } from '../../services/storage/storage.js'
import { SvgDocument } from './svg-document.js'
import { StorageCodeFile } from '../code-editor/code-file.js'

// Opens/saves/creates .svg files as SvgDocuments over the project's IStorage.
// Mirrors CodeDocumentFactory: no language server, just open/save/new/relocate.
export class SvgDocumentFactory extends ServiceBase implements IDocumentFactory, IRelocatableDocumentFactory
{
    public static readonly Key = new ServiceKey<SvgDocumentFactory>('SvgDocumentFactory')

    // A blank canvas: a valid, namespaced, empty SVG with a default viewBox.
    private static readonly EMPTY_SVG =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>\n'

    public constructor(provider?: IServiceProvider) { super(provider as IServiceProvider) }

    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        return new SvgDocument(new StorageCodeFile(storage, path))
    }

    public async saveFile(document: IDocument): Promise<void>
    {
        await (document as SvgDocument).Save()
    }

    public async newFile(storage: IStorage, name: string): Promise<string>
    {
        const path = name.toLowerCase().endsWith('.svg') ? name : name + '.svg'
        await storage.WriteText(path, SvgDocumentFactory.EMPTY_SVG)
        return path
    }

    public relocateOpenFile(document: IDocument, newPath: string): void
    {
        (document as SvgDocument).Relocate(newPath)
    }

    public relocateAcrossStorage(document: IDocument, storage: IStorage, newPath: string): void
    {
        (document as SvgDocument).RelocateTo(storage, newPath)
    }
}
