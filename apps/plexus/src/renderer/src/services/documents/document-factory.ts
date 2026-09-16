import type { IDocument } from '@pragmatic-tech-ai/mural/framework'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// The file-editing half of the old IProjectFactory — extracted so an EDITOR owns
// a file format, not a project. A module contributes a DocumentDefinition (mural)
// whose `Factory` service token resolves to an IDocumentFactory; the generic
// ProjectExplorerService resolves it by extension (DocumentTypeRegistry) and
// delegates open/save/new. Any project can open any file whose extension a
// registered editor handles — the editor opens it, regardless of project type.
//
// Persistence flows through the project's IStorage (rooted, project-relative
// paths); the factory never sees an absolute path or the raw file system.
export interface IDocumentFactory
{
    // Deserialize a project file (project-relative path) into a tab document.
    openFile(storage: IStorage, path: string): Promise<IDocument>
    // Serialize a document back to its file.
    saveFile(document: IDocument): Promise<void>
    // Create an empty file (the caller supplies the base name, extension and
    // all) and return its project-relative path.
    newFile(storage: IStorage, name: string): Promise<string>
}

// Optional capability: re-point an already-open document after its file was
// renamed/moved on storage. The explorer feature-tests with isRelocatable before
// re-pointing tabs across a rename; a factory that omits it leaves stale tabs to
// the caller's policy. `newPath` is the document's new project-relative path.
export interface IRelocatableDocumentFactory
{
    relocateOpenFile(document: IDocument, newPath: string): void
    // Optional: re-point an already-open document at a DIFFERENT storage + path (a
    // cross-project move keeps the tab open, now saving to the target project).
    // Editors that can follow a file across storages implement it.
    relocateAcrossStorage?(document: IDocument, storage: IStorage, newPath: string): void
}

// Type guard: can this factory re-point an open document to a new path?
export function isRelocatable(factory: IDocumentFactory): factory is IDocumentFactory & IRelocatableDocumentFactory
{
    return typeof (factory as Partial<IRelocatableDocumentFactory>).relocateOpenFile === 'function'
}

// Type guard: can this factory re-point an open document across storages?
export function isRelocatableAcrossStorage(
    factory: IDocumentFactory,
): factory is IDocumentFactory & Required<Pick<IRelocatableDocumentFactory, 'relocateAcrossStorage'>>
{
    return typeof (factory as Partial<IRelocatableDocumentFactory>).relocateAcrossStorage === 'function'
}
