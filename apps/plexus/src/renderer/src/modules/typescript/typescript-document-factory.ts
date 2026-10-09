import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { IDocument } from '@pragmatic-tech-ai/mural/framework'
import type { IDocumentFactory, IRelocatableDocumentFactory } from '@pragmatic-tech-ai/plexus-core/renderer/documents/document-factory.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { CodeDocument } from '../code-editor/code-document.js'
import { StorageCodeFile } from '../code-editor/code-file.js'
import { TypeScriptWorkspace } from './typescript-workspace.js'

// The `.ts`/`.tsx` editor: a TypeScript file edited in the Monaco CodeEditor (a
// CodeDocument over the project's IStorage). Beyond CodeDocumentFactory it assigns
// the document a stable workspace model URI and ensures the TypeScriptWorkspace has
// a model for it, so the editor adopts the worker-visible model and IntelliSense
// resolves cross-file. Outside any attached project it degrades to a plain
// CodeDocument. Diagnostics come from Monaco's own markers (Task 8 bridge), so no
// per-document Diagnostics wiring here.
export class TypeScriptDocumentFactory extends ServiceBase implements IDocumentFactory, IRelocatableDocumentFactory
{
    public static readonly Key = new ServiceKey<TypeScriptDocumentFactory>('TypeScriptDocumentFactory')

    private static readonly DefaultExtension = '.ts'
    private static readonly TsxExtension = '.tsx'

    constructor(provider: IServiceProvider)
    {
        super(provider)
    }

    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        const doc = new CodeDocument(new StorageCodeFile(storage, path))
        const workspace = this.Provider.get(TypeScriptWorkspace.Key)
        if (workspace !== undefined)
        {
            const projectId = workspace.ProjectIdFor(storage)
            if (projectId !== undefined)
            {
                doc.Uri = TypeScriptWorkspace.ModelUriFor(projectId, path)
                await workspace.EnsureModelFor(projectId, path)
            }
        }
        return doc
    }

    public async saveFile(document: IDocument): Promise<void>
    {
        await (document as CodeDocument).Save()
    }

    public relocateOpenFile(document: IDocument, newPath: string): void
    {
        (document as CodeDocument).Relocate(newPath)
    }

    public relocateAcrossStorage(document: IDocument, storage: IStorage, newPath: string): void
    {
        (document as CodeDocument).RelocateTo(storage, newPath)
    }

    public async newFile(storage: IStorage, name: string): Promise<string>
    {
        const path = TypeScriptDocumentFactory.EnsureExtension(name)
        await storage.WriteText(path, '')
        return path
    }

    private static EnsureExtension(name: string): string
    {
        const lower = name.toLowerCase()
        const hasExtension = lower.endsWith(TypeScriptDocumentFactory.DefaultExtension) || lower.endsWith(TypeScriptDocumentFactory.TsxExtension)
        return hasExtension ? name : name + TypeScriptDocumentFactory.DefaultExtension
    }
}
