import { ResourceDictionary, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FakeStorage, isLocalFileAccess, type IDisposable, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    MetaKind, PresentationResourceEmitter, ProviderPresentationBaker, SolutionLanguageService, SolutionManagerService,
    WikiOriginKind, toJSONOwn,
    type BakeOptions, type JsonNode, type Repository, type TodlDocument,
} from '@pragmatic-tech-ai/todl'

import type { FileChangeEvent } from '@pragmatic-tech-ai/plexus-core/shared/file-watch-api.js'

import { FileWatchService } from '../../../services/file-watch/file-watch-service.js'
import { TodlPresentationRegistry, type PresentationContribution, type PresentationSource } from './todl-presentation-registry.js'
import { loadCompiledPresentation } from '../../meta-model/services/compiled-presentation.js'
import { readIconIndex } from '../../meta-model/services/icon-index.js'

// The shared solution view a source member's own document is carved out of: the ONE
// compiled Repository for the whole open solution plus the origin map that says which
// member storage each node was authored in.
interface SolutionModelView
{
    model: Repository
    originOf: ReadonlyMap<string, { readonly kind: WikiOriginKind; readonly storage?: IStorage }>
    // node id → URI of the file that authored it (a term and its icon application share one).
    provenanceOf: ReadonlyMap<string, string>
}

// One cached bake unit: a single file of an independent member, or the whole member when
// its icon graph crosses files. Remembers which member and files it covers so eviction can
// match by file or by member. An undefined contribution is a negative-cache marker (the
// unit baked to nothing). `assetKeys` are the normalized resource-asset paths the unit's
// icons read, so a changed asset file can evict it; `failed` marks a bake that did not
// complete, kept only so an asset event can find it and never served as a cache hit.
interface FileEntry
{
    memberId: string
    fileUris: ReadonlySet<string>
    whole: boolean
    contribution: PresentationContribution | undefined
    assetKeys: ReadonlySet<string>
    failed: boolean
}

// One unit of baking: the cache key, the bake id, the files it covers and the node ids it carves.
interface BakeUnit
{
    key: string
    bakeId: string
    fileUris: ReadonlySet<string>
    whole: boolean
    ids: Set<string>
}

// A PresentationSource that bakes each OPEN source member's icons straight from the
// solution's live shared graph — no published package required. For every member it
// carves the member's OWN document out of the shared Repository (the nodes whose origin
// points at that member's storage), resolves its bases for the closure, bakes the icons
// in memory (icon bytes read from the member's own storage), and reads the sidecars back
// into a PresentationContribution. The member's icons are carved and baked PER AUTHORING FILE;
// each file's contribution is cached by `member::file` and evicted when GraphChanged names
// that file (or, when it names no files, the whole member), so a live edit re-bakes only the
// file that changed. This is what makes the hub-and-spoke solution render its icons from its
// source members before anything is published.
export class SolutionGraphPresentationSource implements PresentationSource, IDisposable
{
    private static readonly SourceId = 'solution-graph'
    // The baked dictionary name + icon keyspace. Source members bake into the LIBRARY
    // keyspace (bare node id, no prefix) because the diagram's icon lookup keys an arch
    // node by its bare entity id (see arch-icon.iconEntityKey → registry.iconKeyFor).
    private static readonly DictionaryName = 'SolutionGraphPresentation'
    private static readonly IconPrefix = ''
    private static readonly BakeOptionsValue: BakeOptions =
        { dictName: SolutionGraphPresentationSource.DictionaryName, iconPrefix: SolutionGraphPresentationSource.IconPrefix }
    // The prelude's icon-annotation ancestry, appended to every closure so the baker can
    // resolve the literal `icon` annotation up to `MuralResource` even when a member's
    // resolved bases happen not to carry the prelude declarations. Idempotent: duplicate
    // declarations/edges are harmless to the annotation projection.
    private static readonly IconAnnotationId = 'todl.icon'
    private static readonly MuralResourceAnnotationId = 'todl.MuralResource'
    // Ontology-tier serialization token for the synthetic annotation declarations
    // (JsonNode.tier is the Tier enum emitted by name).
    private static readonly OntologyTier = 'Ontology'
    private static readonly ExtendsEdgeKind = 'Extends'
    // Joins a member id and a file URI into one cache / bake id.
    private static readonly KeySeparator = '::'
    // Sentinel "file" naming a whole-member bake; no real file URI can equal it.
    private static readonly WholeSentinel = '<whole>'
    private static readonly AnnotatedEdgeKind = 'Annotated'
    private static readonly BakeIdUnsafe = /[^A-Za-z0-9_-]/g
    private static readonly BakeIdReplacement = '_'
    private static readonly BakeIdFilePrefix = 'f'
    private static readonly BakeIdWhole = 'whole'
    // Resource-asset extensions whose on-disk change invalidates a baked icon.
    private static readonly AssetExtensions: ReadonlySet<string> = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'])
    private static readonly BackslashPattern = /\\/g
    private static readonly PathSeparator = '/'
    private static readonly ExtensionDot = '.'

    public readonly id = SolutionGraphPresentationSource.SourceId

    private readonly baker: ProviderPresentationBaker
    // `${memberId}::${fileUri}` (or `::<whole>`) → that unit's last bake; evicted on GraphChanged.
    private readonly cache = new Map<string, FileEntry>()
    // Bumped on every eviction so a bake that raced a GraphChanged never stores a stale entry.
    private generation = 0
    // The single GraphChanged subscription, attached lazily on the first load() that finds
    // a live language service and torn down in dispose().
    private subscription: IDisposable | undefined
    // Unsubscribe from the FileWatchService asset-change feed; undefined until attached
    // (the service only exists in the desktop host).
    private assetUnsubscribe: (() => void) | undefined

    constructor(private readonly provider: IServiceProvider)
    {
        this.baker = new ProviderPresentationBaker(provider)
    }

    public async load(): Promise<PresentationContribution>
    {
        const assets = new ResourceDictionary()
        const iconKeys = new Map<string, string>()

        const language = this.provider.get(SolutionLanguageService.Key)
        const solution = this.provider.get(SolutionManagerService.Key)?.ActiveSolution
        if (language === undefined || solution === undefined)
        {
            return { assets, iconKeys }
        }

        this.EnsureSubscription(language)
        this.EnsureAssetWatch()

        const storages = this.MemberStorages(solution)
        if (storages.length === 0)
        {
            return { assets, iconKeys }
        }

        // Every member shares the identical graph, so one ModelView yields the whole
        // solution's model + origin map; each member's own slice is carved by origin.
        const view = (await language.ModelView(storages[0])) as SolutionModelView | undefined
        if (view === undefined)
        {
            return { assets, iconKeys }
        }

        for (const storage of storages)
        {
            const contribution = await this.ContributionFor(language, view, storage)
            if (contribution === undefined)
            {
                continue
            }
            for (const [key, value] of contribution.assets.Entries())
            {
                assets.Set(key, value)
            }
            for (const [key, value] of contribution.iconKeys)
            {
                iconKeys.set(key, value)
            }
        }

        return { assets, iconKeys }
    }

    public dispose(): void
    {
        this.subscription?.dispose()
        this.subscription = undefined
        this.assetUnsubscribe?.()
        this.assetUnsubscribe = undefined
        this.cache.clear()
    }

    // Attach the resource-asset watcher once. FileWatchService only exists in the desktop
    // host, so a headless provider simply skips asset watching.
    private EnsureAssetWatch(): void
    {
        if (this.assetUnsubscribe !== undefined)
        {
            return
        }
        const watcher = this.provider.get(FileWatchService.Key)
        if (watcher === undefined)
        {
            return
        }
        this.assetUnsubscribe = watcher.Subscribe(event => this.OnFileChanged(event))
    }

    // A changed / added / removed asset file evicts every unit whose icons read it, then
    // asks the registry to re-bake so the icons update with no .todl edit. A removed asset
    // re-bakes to nothing (the bake fails and is swallowed), so the default glyph returns.
    private OnFileChanged(event: FileChangeEvent): void
    {
        const path = SolutionGraphPresentationSource.Normalize(event.path)
        if (!SolutionGraphPresentationSource.IsAssetPath(path))
        {
            return
        }
        if (this.EvictAsset(path))
        {
            this.provider.get(TodlPresentationRegistry.Key)?.Refresh().catch(() => undefined)
        }
    }

    // Evicts every cached unit whose asset-key set matches the (normalized) path: equal, or
    // the path ends with the key (a storage-relative key against an absolute path).
    // Returns whether anything was evicted.
    public EvictAsset(normalizedPath: string): boolean
    {
        let evicted = false
        for (const [key, entry] of this.cache)
        {
            for (const assetKey of entry.assetKeys)
            {
                if (normalizedPath === assetKey || normalizedPath.endsWith(`${SolutionGraphPresentationSource.PathSeparator}${assetKey}`))
                {
                    this.cache.delete(key)
                    evicted = true
                    break
                }
            }
        }
        if (evicted)
        {
            this.generation++
        }
        return evicted
    }

    private static Normalize(path: string): string
    {
        return path.replace(SolutionGraphPresentationSource.BackslashPattern, SolutionGraphPresentationSource.PathSeparator)
    }

    private static IsAssetPath(path: string): boolean
    {
        const dot = path.lastIndexOf(SolutionGraphPresentationSource.ExtensionDot)
        return dot >= 0 && SolutionGraphPresentationSource.AssetExtensions.has(path.slice(dot).toLowerCase())
    }

    // The normalized identities of the resource assets a unit's icons read: the absolute OS
    // path when the storage is local-file-access, else the storage-relative path.
    private async AssetKeysOf(language: SolutionLanguageService, ids: ReadonlySet<string>): Promise<Set<string>>
    {
        const keys = new Set<string>()
        for (const id of ids)
        {
            for (const resource of await language.Resources(id))
            {
                if (!SolutionGraphPresentationSource.IsAssetPath(resource.path))
                {
                    continue
                }
                const location = isLocalFileAccess(resource.storage) ? resource.storage.ResolveOsPath(resource.path) : resource.path
                keys.add(SolutionGraphPresentationSource.Normalize(location))
            }
        }
        return keys
    }

    // Attach the GraphChanged eviction handler once. Eviction is file-granular: when the
    // change names files, only entries covering one of those files go (a whole-member entry
    // also goes when its member is named); when it names no files, every entry of each named
    // member goes. The next load() re-bakes whatever was dropped.
    private EnsureSubscription(language: SolutionLanguageService): void
    {
        if (this.subscription !== undefined)
        {
            return
        }
        this.subscription = language.GraphChanged.subscribe((change) =>
        {
            const fileIds = new Set(change.fileIds)
            const memberIds = new Set(change.memberIds)
            this.generation++
            for (const [key, entry] of this.cache)
            {
                const memberNamed = memberIds.has(entry.memberId)
                let evict = fileIds.size === 0 ? memberNamed : (entry.whole && memberNamed)
                if (!evict && fileIds.size > 0)
                {
                    for (const fileUri of entry.fileUris)
                    {
                        if (fileIds.has(fileUri))
                        {
                            evict = true
                            break
                        }
                    }
                }
                if (evict)
                {
                    this.cache.delete(key)
                }
            }
        })
    }

    // The bake-or-cache step for one member storage: merges the member's per-unit
    // contributions, or returns undefined when the member has no icon-bearing own nodes
    // (nothing to contribute).
    private async ContributionFor(
        language: SolutionLanguageService,
        view: SolutionModelView,
        storage: IStorage,
    ): Promise<PresentationContribution | undefined>
    {
        const memberId = await language.ConsumerIdOf(storage)
        if (memberId === undefined)
        {
            return undefined
        }

        const ownIds = this.OwnIds(view, storage)
        if (ownIds.size === 0)
        {
            return undefined
        }

        const units = this.PlanUnits(view, memberId, ownIds)

        // Drop this member's entries for units that no longer exist (deleted files, or a
        // switch between per-file and whole-member baking).
        const liveKeys = new Set(units.map(unit => unit.key))
        for (const [key, entry] of this.cache)
        {
            if (entry.memberId === memberId && !liveKeys.has(key))
            {
                this.cache.delete(key)
            }
        }

        const assets = new ResourceDictionary()
        const iconKeys = new Map<string, string>()
        let bases: readonly TodlDocument[] | undefined
        let hasContribution = false
        // Units are in sorted-file order. A duplicate icon key across files resolves
        // last-wins here (the whole-member bake deduped it).
        for (const unit of units)
        {
            let entry = this.cache.get(unit.key)
            // A failed bake is never a cache hit: retry it.
            if (entry === undefined || entry.failed)
            {
                const generation = this.generation
                bases ??= (await language.ResolveBasesFor(storage)).bases
                const assetKeys = await this.AssetKeysOf(language, unit.ids)
                const baked = await this.BakeFile(view, storage, unit.bakeId, unit.ids, bases)
                // null = the bake failed (not the same as a legitimately empty unit).
                entry = { memberId, fileUris: unit.fileUris, whole: unit.whole, contribution: baked ?? undefined, assetKeys, failed: baked === null }
                // A GraphChanged during the bake supersedes it: use the result once, don't store it.
                if (generation === this.generation)
                {
                    this.cache.set(unit.key, entry)
                }
            }
            if (entry.contribution === undefined)
            {
                continue
            }
            hasContribution = true
            for (const [assetKey, value] of entry.contribution.assets.Entries())
            {
                assets.Set(assetKey, value)
            }
            for (const [iconKey, value] of entry.contribution.iconKeys)
            {
                iconKeys.set(iconKey, value)
            }
        }
        return hasContribution ? { assets, iconKeys } : undefined
    }

    // Splits a member's own nodes into bake units. When every own Annotated/Extends edge
    // stays inside one file and every own node is file-homed, each file bakes independently
    // (sorted by URI); otherwise the icon graph crosses files (or has unhomed nodes), so
    // the member bakes WHOLE as one unit — exactly the pre-file-granular behavior.
    private PlanUnits(view: SolutionModelView, memberId: string, ownIds: ReadonlySet<string>): BakeUnit[]
    {
        const idsByFile = new Map<string, Set<string>>()
        let independent = true
        for (const id of ownIds)
        {
            const fileUri = view.provenanceOf.get(id)
            if (fileUri === undefined)
            {
                independent = false
                continue
            }
            let ids = idsByFile.get(fileUri)
            if (ids === undefined)
            {
                ids = new Set<string>()
                idsByFile.set(fileUri, ids)
            }
            ids.add(id)
        }

        if (independent)
        {
            for (const edge of toJSONOwn(view.model, ownIds).edges)
            {
                const crossing = (edge.kind === SolutionGraphPresentationSource.AnnotatedEdgeKind || edge.kind === SolutionGraphPresentationSource.ExtendsEdgeKind)
                    && ownIds.has(edge.to) && view.provenanceOf.get(edge.from) !== view.provenanceOf.get(edge.to)
                if (crossing)
                {
                    independent = false
                    break
                }
            }
        }

        if (!independent)
        {
            return [{
                key: SolutionGraphPresentationSource.CacheKey(memberId, SolutionGraphPresentationSource.WholeSentinel),
                bakeId: SolutionGraphPresentationSource.BakeId(memberId, SolutionGraphPresentationSource.BakeIdWhole),
                fileUris: new Set(idsByFile.keys()),
                whole: true,
                ids: new Set(ownIds),
            }]
        }

        return [...idsByFile.keys()].sort().map((fileUri, index) => ({
            key: SolutionGraphPresentationSource.CacheKey(memberId, fileUri),
            bakeId: SolutionGraphPresentationSource.BakeId(memberId, `${SolutionGraphPresentationSource.BakeIdFilePrefix}${index}`),
            fileUris: new Set([fileUri]),
            whole: false,
            ids: idsByFile.get(fileUri) as Set<string>,
        }))
    }

    private static CacheKey(memberId: string, fileUri: string): string
    {
        return `${memberId}${SolutionGraphPresentationSource.KeySeparator}${fileUri}`
    }

    // A path-safe bake id, distinct from the cache key; used for BOTH the bake and the read-back.
    private static BakeId(memberId: string, suffix: string): string
    {
        const safe = memberId.replace(SolutionGraphPresentationSource.BakeIdUnsafe, SolutionGraphPresentationSource.BakeIdReplacement)
        return `${safe}-${suffix}`
    }

    // Bake one file's icon subset: carve its own document, close it over the member's bases,
    // bake in memory (icon bytes read from the member's storage) and read the sidecars back.
    // undefined when the file declares no icons (cacheable); null when the bake cannot
    // complete (a missing icon file, swallowed so one file cannot sink the whole discover;
    // never cached). `bakeId` is both the bake id and the read-back id.
    private async BakeFile(
        view: SolutionModelView,
        storage: IStorage,
        bakeId: string,
        fileIds: Set<string>,
        bases: readonly TodlDocument[],
    ): Promise<PresentationContribution | undefined | null>
    {
        const document = toJSONOwn(view.model, fileIds)
        const closure = this.Closure(document, bases)

        // A file with no own MuralResource-bearing node declares no icons — skip the bake
        // (an empty resources block would have nothing to compile).
        if (PresentationResourceEmitter.DistinctIcons(document, closure).length === 0)
        {
            return undefined
        }

        const dest = new FakeStorage()
        const result = await this.baker.Bake(storage, dest, bakeId, document, closure, SolutionGraphPresentationSource.BakeOptionsValue)
        if (!result.ok)
        {
            return null
        }

        const assets = new ResourceDictionary()
        const presentation = await loadCompiledPresentation(dest, bakeId)
        if (presentation !== undefined)
        {
            for (const [key, value] of presentation.Entries())
            {
                assets.Set(key, value)
            }
        }
        const iconKeys = await readIconIndex(dest, bakeId)
        return { assets, iconKeys }
    }

    // The ids of the nodes a member OWNS in the shared graph: those whose origin is this
    // member's open-project storage. Exactly the node set toJSONOwn carves the member's
    // own document out of.
    private OwnIds(view: SolutionModelView, storage: IStorage): Set<string>
    {
        const ids = new Set<string>()
        for (const node of view.model.allNodes())
        {
            const origin = view.originOf.get(node.id)
            if (origin !== undefined && origin.kind === WikiOriginKind.OpenProject && origin.storage === storage)
            {
                ids.add(node.id)
            }
        }
        return ids
    }

    // The baker's closure: the member's own document merged with its resolved bases, plus
    // the prelude icon-annotation ancestry so the literal `icon` annotation resolves up to
    // `MuralResource` regardless of which bases carry it.
    private Closure(document: TodlDocument, bases: readonly TodlDocument[]): TodlDocument
    {
        const nodes = [...document.nodes]
        const edges = [...document.edges]
        for (const base of bases)
        {
            nodes.push(...base.nodes)
            edges.push(...base.edges)
        }
        nodes.push(
            SolutionGraphPresentationSource.AnnotationDecl(SolutionGraphPresentationSource.IconAnnotationId),
            SolutionGraphPresentationSource.AnnotationDecl(SolutionGraphPresentationSource.MuralResourceAnnotationId),
        )
        edges.push({ kind: SolutionGraphPresentationSource.ExtendsEdgeKind, via: null, from: SolutionGraphPresentationSource.IconAnnotationId, to: SolutionGraphPresentationSource.MuralResourceAnnotationId })
        return { nodes, edges }
    }

    // A synthetic annotation-DECLARATION node for the closure's is-a chain: only its
    // id + Annotation metaKind matter to the projector (it keys annIds by metaKind);
    // the remaining JsonNode fields are filled with inert defaults.
    private static AnnotationDecl(id: string): JsonNode
    {
        return {
            id,
            tier: SolutionGraphPresentationSource.OntologyTier,
            type: null,
            metaKind: MetaKind.Annotation,
            namespace: null,
            localId: null,
            isClass: false,
            class: null,
            storageId: null,
            fields: [],
            attrs: {},
        }
    }

    // The open solution's member storages, in member order (a member without a resolved
    // storage is skipped).
    private MemberStorages(solution: { Members: Iterable<{ Storage: IStorage | undefined }> }): IStorage[]
    {
        const storages: IStorage[] = []
        for (const member of solution.Members)
        {
            if (member.Storage !== undefined)
            {
                storages.push(member.Storage)
            }
        }
        return storages
    }
}
