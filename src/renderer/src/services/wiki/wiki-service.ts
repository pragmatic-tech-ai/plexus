import {
    MetaData, MuralBase, RelayCommand, ServiceBase, ServiceKey,
    type ICommand, type IServiceProvider,
} from '@pragmatic-tech-ai/mural/runtime'

import { ContentHostService, type DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'

import type { Repository } from '@pragmatic-tech-ai/todl'

import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { FileSystemService } from '../file-system/file-system-service.js'
import { WikiLocator, wikiPathOf } from './wiki-locator.js'
import { WikiDocument } from './wiki-document.js'

// A fully-resolved wiki page: which storage holds it, the storage-relative path,
// and a stable id (dedup key + title source). Produced by a registered resolver
// that knows a concept's provenance; opened verbatim by the service.
export interface WikiTarget
{
    readonly id: string
    readonly storage: IStorage
    readonly path: string
}

// Opens a concept's wiki page. Visibility (hasWiki) and open both go through
// WikiLocator, so "Open Wiki" shows exactly when the page is openable (its
// declaring project is open). Approach A: a closed declaring project or a
// missing file sets Status and no tab is opened.
export class WikiService extends ServiceBase
{
    public static readonly Key = new ServiceKey<WikiService>('WikiService')

    public static readonly StatusKey = MuralBase.RegisterProperty<string>(
        WikiService, 'Status', '', MetaData.None)
    public static readonly OpenWikiCommandKey = MuralBase.RegisterProperty<ICommand>(
        WikiService, 'OpenWikiCommand', undefined as unknown as ICommand, MetaData.None)

    // Open wiki tabs keyed by their stable id, so re-opening a page re-activates
    // its tab (and refreshes its content) instead of stacking duplicates.
    private readonly open = new Map<string, WikiDocument>()

    // Provenance-aware resolver registered by the architecture runtime (which
    // knows a concept's origin). Preferred over the legacy source-probing locator;
    // returns undefined when it can't resolve the concept (→ legacy fallback).
    private targetResolver?: (concept: string) => WikiTarget | undefined

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        this.set_property_value(WikiService.OpenWikiCommandKey,
            new RelayCommand((p) => { void this.openWiki(String(p ?? '')) }))
    }

    public get Status(): string { return this.get_property_value(WikiService.StatusKey) }
    private set Status(v: string) { this.set_property_value(WikiService.StatusKey, v) }
    public get OpenWikiCommand(): ICommand { return this.get_property_value(WikiService.OpenWikiCommandKey) }

    private get locator(): WikiLocator { return this.Provider.getRequired(WikiLocator.Key) }

    // Register the provenance-aware target resolver (called once by the arch
    // runtime). Later registrations replace earlier ones.
    public RegisterResolver(resolver: (concept: string) => WikiTarget | undefined): void
    {
        this.targetResolver = resolver
    }

    // Synchronous existence check against an ALREADY-LOADED model — the cheap way
    // to drive a surface's "Open Wiki" visibility (HasWiki) without touching the
    // filesystem or recompiling source. A concept's wiki-ness depends only on the
    // model's concept declarations, so callers can cache the result per concept.
    public hasWikiIn(repo: Repository, concept: string): boolean
    {
        return wikiPathOf(repo, concept) !== undefined
    }

    // True when the concept has an openable wiki page (its declaring project is
    // open). Drives each surface's "Open Wiki" menu-item visibility.
    // DEPRECATED (source-recompiling): prefer hasWikiIn(repo, concept).
    public async hasWiki(concept: string): Promise<boolean>
    {
        if (concept.length === 0) return false
        return (await this.locator.resolveWiki(concept)) !== undefined
    }

    // Resolve + open the concept's wiki .md as a tab, or set Status. Prefers the
    // provenance-aware resolver (reads from the declaring package's backend or the
    // open project's storage); falls back to the legacy open-project source probe.
    public async openWiki(concept: string): Promise<void>
    {
        if (concept.length === 0) return
        const target = this.targetResolver?.(concept)
        if (target !== undefined) { await this.openTarget(target); return }
        await this.openLegacy(concept)
    }

    // Open a fully-resolved target: read from its storage, dedup by id, host it.
    private async openTarget(target: WikiTarget): Promise<void>
    {
        if (!(await this.exists(target.storage, target.path))) {
            this.Status = `Wiki file not found: ${target.path}`
            return
        }
        const text = await this.readStorage(target.storage, target.path)
        this.host(target.id, text)
    }

    // Legacy path: probe OPEN projects' source for the declaring project, reading
    // the .md via the absolute-path filesystem. Retired once every surface supplies
    // provenance through the resolver.
    private async openLegacy(concept: string): Promise<void>
    {
        const hit = await this.locator.resolveWiki(concept)
        if (hit === undefined) {
            this.Status = `Open the project that declares "${concept}" to view its wiki.`
            return
        }
        const abs = join(hit.root, hit.relPath)
        const fs = this.Provider.getRequired(FileSystemService.Key)
        if (!(await fs.Exists(abs))) {
            this.Status = `Wiki file not found: ${hit.relPath}`
            return
        }
        const text = await this.readFs(abs)
        this.host(abs, text)
    }

    // Create-or-refresh the tab for `id` and activate it.
    private host(id: string, text: string): void
    {
        let doc = this.open.get(id)
        if (doc === undefined) { doc = new WikiDocument(id, text); this.open.set(id, doc) }
        else doc.Refresh(text)
        const host = this.Provider.getRequired(ContentHostService.Key) as DocumentsContentHostService
        host.Open(doc)
        this.Status = ''
    }

    private async exists(storage: IStorage, path: string): Promise<boolean>
    {
        try { return await storage.Exists(path) } catch { return false }
    }

    private async readStorage(storage: IStorage, path: string): Promise<string>
    {
        try { return await storage.ReadText(path) } catch { return '' }
    }

    // Read via the absolute-path filesystem (legacy path), degrading a read error
    // to '' (buildFlowDocument renders an empty page rather than throwing).
    private async readFs(path: string): Promise<string>
    {
        const fs = this.Provider.getRequired(FileSystemService.Key)
        try { return await fs.ReadText(path) } catch { return '' }
    }
}

// Join a directory and a relative child using the directory's own separator
// (no node:path in the renderer). Mirrors open-projects-store.join.
function join(dir: string, rel: string): string
{
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    const d = dir.endsWith(sep) ? dir.slice(0, -1) : dir
    return d + sep + rel.replace(/[\\/]+/g, sep)
}
