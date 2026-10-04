import { ServiceProvider, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import {
    ContentHostService,
    DocumentTypeRegistry,
    type DocumentsContentHostService,
    type IDocument,
} from '@pragmatic-tech-ai/mural/framework'
import { isLocalFileAccess, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { SolutionMember } from '@pragmatic-tech-ai/todl'
import { isRelocatable, type IDocumentFactory } from '../../../documents/document-factory.js'
import { EnvironmentService } from '../../../environment/environment-service.js'
import { samePath } from '../../../file-watch/path-utils.js'

// A document that can reload itself from disk (the code buffer can). IDocument
// supplies Id/IsDirty; Reload is the buffer's own. Duck-typed so this stays
// decoupled from the code-editor module. Ported from the retired ProjectExplorerService.
export type ReloadableDocument = IDocument & { Reload(): Promise<void> }

// The open-document map keyed by (member, project-relative path) — ported from
// the retired ProjectExplorerService's docOwners/docPaths plus its open/close/repoint helpers,
// re-keyed off SolutionMember (no OpenProject). It is the UI side of the engine
// content lifecycle: SolutionWorkspaceService opens tabs through it, and its
// IContentLifecycleGuard/ICloseGuard implementations drive the close/repoint here.
//
// A tab is owned by exactly one member; its path is the key an in-place rename /
// move re-points (via the factory's relocateOpenFile) and a delete closes. All
// framework collaborators (ContentHostService, DocumentTypeRegistry,
// EnvironmentService) are resolved lazily from the provider so registration order
// is free (mirrors the service it was extracted from).
export class DocOwnership
{
    private static readonly Separator = '/'

    // Which member each open document belongs to — for close-cleanup + repoint.
    private readonly owners = new Map<IDocument, SolutionMember>()
    // Each open document's project-relative path — so an in-place rename can
    // re-point the tab instead of leaving it stale.
    private readonly paths = new Map<IDocument, string>()

    constructor(private readonly provider: IServiceProvider)
    {
    }

    private get host(): DocumentsContentHostService
    {
        return this.provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
    }

    // Open a project file as a document tab (through the given editor) and record
    // its owning member. Re-activates an already-open tab instead of duplicating —
    // the single dedupe point every open path funnels through.
    public async OpenDocument(member: SolutionMember, path: string, factory: IDocumentFactory): Promise<IDocument>
    {
        const existing = this.FindOpenDoc(member, path)
        if (existing !== undefined) { this.host.Open(existing); return existing }
        const storage = DocOwnership.StorageOf(member)
        const doc = await factory.openFile(storage, path)
        this.owners.set(doc, member)
        this.paths.set(doc, path)
        this.host.Open(doc)
        return doc
    }

    // Open (or re-activate) a file resolving its editor by extension. Undefined
    // when no registered editor claims the extension (the caller decides the
    // fallback — e.g. open externally).
    public async OpenFile(member: SolutionMember, path: string): Promise<IDocument | undefined>
    {
        const factory = this.FactoryFor(DocOwnership.ExtName(path))
        if (factory === undefined) return undefined
        return this.OpenDocument(member, path, factory)
    }

    // The already-open document for (member, project-relative path), if any.
    public FindOpenDoc(member: SolutionMember, path: string): IDocument | undefined
    {
        for (const [doc, p] of this.paths)
        {
            if (p === path && this.owners.get(doc) === member) return doc
        }
        return undefined
    }

    // Every open document owned by `member` — the set CanClose guards on a close.
    public OwnedDocs(member: SolutionMember): IDocument[]
    {
        const out: IDocument[] = []
        for (const [doc, owner] of this.owners) if (owner === member) out.push(doc)
        return out
    }

    // Every open document of `member` living at (or under, for a folder) any of
    // `paths` — the set CanRemove guards before a delete.
    public DocsUnder(member: SolutionMember, paths: readonly string[]): IDocument[]
    {
        const out: IDocument[] = []
        for (const [doc, p] of this.paths)
        {
            if (this.owners.get(doc) !== member) continue
            if (paths.some((root) => DocOwnership.IsAtOrUnder(p, root))) out.push(doc)
        }
        return out
    }

    // Drop a document from the maps (the caller closed it, or it closed itself).
    public Forget(doc: IDocument): void
    {
        this.owners.delete(doc)
        this.paths.delete(doc)
    }

    // Close every open tab of `member` whose file lived at `path` or under it (for
    // a folder delete) and forget it — the file is gone, so the tab can't save back.
    public CloseDocumentsUnder(member: SolutionMember, path: string): void
    {
        for (const [doc, p] of [...this.paths])
        {
            if (this.owners.get(doc) !== member) continue
            if (DocOwnership.IsAtOrUnder(p, path))
            {
                this.host.Close(doc)
                this.Forget(doc)
            }
        }
    }

    // After a rename/move within one storage, re-point every open tab whose file
    // lived at (or under, for a folder) the old path — the factory updates the
    // document's path + title in place so the tab keeps working. No-op for editors
    // that can't relocate (their tabs would need a manual reopen).
    public RepointOpenDocuments(member: SolutionMember, oldPath: string, newPath: string): void
    {
        for (const [doc, p] of [...this.paths])
        {
            if (this.owners.get(doc) !== member) continue
            const moved = p === oldPath ? newPath
                : p.startsWith(oldPath + DocOwnership.Separator) ? newPath + p.slice(oldPath.length)
                    : undefined
            if (moved === undefined) continue
            const factory = this.FactoryFor(DocOwnership.ExtName(moved))
            if (factory !== undefined && isRelocatable(factory)) factory.relocateOpenFile(doc, moved)
            this.paths.set(doc, moved)
        }
    }

    // Forget every document owned by `member` (its project closed/removed). The
    // tabs themselves are closed by the close guard before this runs.
    public UntrackMember(member: SolutionMember): void
    {
        for (const [doc, owner] of [...this.owners]) if (owner === member) this.Forget(doc)
    }

    // The open reloadable document whose resolved OS path matches `absPath`, if any
    // — for the file-watch editor-reload consumer. Narrows to a reloadable buffer
    // (only code buffers reload from disk) on a local-file member storage.
    public FindOpenCodeDocByOsPath(absPath: string): ReloadableDocument | undefined
    {
        const ci = this.provider.getRequired(EnvironmentService.Key).IsWindows
        for (const [doc, rel] of this.paths)
        {
            if (!DocOwnership.IsReloadable(doc)) continue
            const storage = this.owners.get(doc)?.Storage
            if (storage === undefined || !isLocalFileAccess(storage)) continue
            if (samePath(storage.ResolveOsPath(rel), absPath, ci)) return doc
        }
        return undefined
    }

    // Resolve the editor for a file extension via the framework DocumentTypeRegistry.
    // A module contributes a DocumentDefinition whose `Factory` token resolves to an
    // IDocumentFactory; unknown extension → undefined. Ported verbatim.
    public FactoryFor(ext: string): IDocumentFactory | undefined
    {
        const registry = this.provider.get(DocumentTypeRegistry.Key)
        const def = registry?.GetByExtension(ext)
        if (def?.Factory === undefined) return undefined
        const token = ServiceProvider.tokenFor(def.Factory as unknown as new (...args: never[]) => IDocumentFactory)
        return this.provider.get(token) as IDocumentFactory | undefined
    }

    private static StorageOf(member: SolutionMember): IStorage
    {
        const storage = member.Storage
        if (storage === undefined) throw new Error('Member has no open storage.')
        return storage
    }

    // Is `path` the same as `root` or nested under it?
    private static IsAtOrUnder(path: string, root: string): boolean
    {
        return path === root || path.startsWith(root + DocOwnership.Separator)
    }

    // The lowercased extension (with leading dot) of a path, e.g. ".todl"; '' when
    // there is none or the name is a dotfile.
    private static ExtName(path: string): string
    {
        const i = path.lastIndexOf('.')
        return i > 0 ? path.slice(i).toLowerCase() : ''
    }

    private static IsReloadable(doc: IDocument): doc is ReloadableDocument
    {
        return typeof (doc as Partial<{ Reload: unknown }>).Reload === 'function'
    }
}
