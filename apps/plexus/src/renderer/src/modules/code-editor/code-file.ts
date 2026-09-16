import type { FileSystemService } from '../../services/file-system/file-system-service.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// A minimal read/write handle a CodeDocument persists through, decoupling the
// document from where its bytes live. `id` is the document's stable identity —
// used for tab dedupe, the tab title, and language inference from the extension.
export interface ICodeFile
{
    readonly id: string
    read(): Promise<string>
    write(text: string): Promise<void>
}

// An absolute-path file over the Electron FileSystemService — arbitrary files
// opened outside a project (e.g. the code editor's open-file command).
export class FileSystemCodeFile implements ICodeFile
{
    constructor(private readonly fs: FileSystemService, public readonly id: string) {}
    public read(): Promise<string> { return this.fs.ReadText(this.id) }
    public write(text: string): Promise<void> { return this.fs.WriteText(this.id, text) }
}

// A project-relative file over an IStorage — project files, where the backend
// (local FS today, cloud/REST later) is transparent. `id` is the project-
// relative path, so a document opened this way carries a project-relative
// identity (what whole-project validation keys diagnostics by). `id` is mutable
// so an in-place rename can re-target the open document (via Retarget).
export class StorageCodeFile implements ICodeFile
{
    constructor(private storage: IStorage, public id: string) {}
    public read(): Promise<string> { return this.storage.ReadText(this.id) }
    public write(text: string): Promise<void> { return this.storage.WriteText(this.id, text) }
    // Re-point at a new project-relative path (in-place rename) and, when given, a
    // new storage (cross-project move); subsequent read/write use them.
    public Retarget(id: string, storage?: IStorage): void { this.id = id; if (storage !== undefined) this.storage = storage }
}
