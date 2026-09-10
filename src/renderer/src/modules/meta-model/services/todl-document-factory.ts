import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ContentHostService, type IDocument, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'

import type { IDocumentFactory, IRelocatableDocumentFactory } from '../../../services/documents/document-factory.js'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { CodeDocument } from '../../code-editor/code-document.js'
import { StorageCodeFile } from '../../code-editor/code-file.js'
import { TodlLanguageClient } from '../../../services/todl/todl-language-client.js'
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { toEditorDiagnostic } from '../../../services/diagnostics/diagnostic.js'

// The `.todl` editor: a definition file is plain-text TODL edited in the Monaco
// CodeEditor (a CodeDocument over the project's IStorage). Contributed as the
// DocumentDefinition.Factory for the meta-model module's `.documents:` entry; the
// ProjectExplorerService resolves it by the `.todl` extension and delegates.
export class TodlDocumentFactory extends ServiceBase implements IDocumentFactory, IRelocatableDocumentFactory
{
    public static readonly Key = new ServiceKey<TodlDocumentFactory>('TodlDocumentFactory')

    // Per-open-doc unsubscribe from its DiagnosticsService per-uri feed. The store
    // is the single source of truth; each open doc mirrors its slice into its own
    // Diagnostics collection (which the editor binds → Monaco squiggles).
    private readonly diagSubs = new Map<CodeDocument, () => void>()
    private hostUnsub: (() => void) | undefined

    constructor(provider: IServiceProvider) { super(provider) }

    public async openFile(storage: IStorage, path: string): Promise<IDocument>
    {
        // A .todl file is a CodeDocument over the project storage; its language
        // resolves to 'todl' from the extension. The project-relative path is the
        // document's Id — what whole-project validation keys diagnostics by.
        const doc = new CodeDocument(new StorageCodeFile(storage, path))
        // Wire the document to the language client: assigns its stable URI and
        // forwards edits as didChange. Optional (`get`, not `getRequired`) —
        // absent in unit tests.
        this.Provider.get(TodlLanguageClient.Key)?.AttachDocument(doc, storage)
        this.attachDiagnostics(doc)
        this.ensureHostSubscription()
        return doc
    }

    // (Re)subscribe a document's Diagnostics collection to the store's feed for
    // its current Id. Idempotent — drops any prior subscription first, so it can
    // re-key after a rename/relocate (the doc's Id changed).
    private attachDiagnostics(doc: CodeDocument): void
    {
        this.diagSubs.get(doc)?.()
        const diagnostics = this.Provider.get(DiagnosticsService.Key)
        if (diagnostics === undefined) { this.diagSubs.delete(doc); return }
        const unsub = diagnostics.SubscribeUri(doc.Id, (diags) => {
            doc.Diagnostics.Clear()
            for (const d of diags) doc.Diagnostics.Add(toEditorDiagnostic(d))
        })
        this.diagSubs.set(doc, unsub)
    }

    // Watch the open-set once, to drop a closed doc's diagnostic subscription.
    private ensureHostSubscription(): void
    {
        if (this.hostUnsub !== undefined) return
        const host = this.Provider.get(ContentHostService.Key) as DocumentsContentHostService | undefined
        this.hostUnsub = host?.OpenDocuments.Subscribe((change) => {
            if (change.kind === 'removed') for (const d of change.items) this.detachDiagnostics(d as CodeDocument)
            else if (change.kind === 'cleared') {
                for (const unsub of this.diagSubs.values()) unsub()
                this.diagSubs.clear()
            }
        })
    }

    private detachDiagnostics(doc: CodeDocument): void
    {
        const unsub = this.diagSubs.get(doc)
        if (unsub !== undefined) { unsub(); this.diagSubs.delete(doc) }
    }

    public async saveFile(document: IDocument): Promise<void>
    {
        await (document as CodeDocument).Save()
    }

    // Re-point an open .todl document after its file was renamed on storage: the
    // CodeDocument re-targets its StorageCodeFile and refreshes Id/Title/Language.
    // The validator tracks the document by instance and reads its Id live, so no
    // re-registration is needed.
    public relocateOpenFile(document: IDocument, newPath: string): void
    {
        (document as CodeDocument).Relocate(newPath)
        this.Provider.get(TodlLanguageClient.Key)?.RelocateDocument(document as CodeDocument, newPath)
        this.attachDiagnostics(document as CodeDocument)   // re-key to the new Id
    }

    // Cross-project move: re-point the document at the target project's storage +
    // path (tab stays open) and re-attach it to the validator under that storage,
    // so it validates against the new project's bases.
    public relocateAcrossStorage(document: IDocument, storage: IStorage, newPath: string): void
    {
        (document as CodeDocument).RelocateTo(storage, newPath)
        this.Provider.get(TodlLanguageClient.Key)?.ReattachDocument(document as CodeDocument, storage)
        this.attachDiagnostics(document as CodeDocument)   // re-key to the new Id
    }

    public async newFile(storage: IStorage, name: string): Promise<string>
    {
        const path = ensureExtension(name, '.todl')   // project-relative, at the root
        await storage.WriteText(path, '')
        return path
    }
}

function ensureExtension(name: string, ext: string): string
{
    return name.toLowerCase().endsWith(ext) ? name : name + ext
}
