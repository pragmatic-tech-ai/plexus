import { ResourceDictionary, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FakeStorage, type IDisposable, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    MetaKind, PresentationResourceEmitter, ProviderPresentationBaker, SolutionLanguageService, SolutionManagerService,
    WikiOriginKind, toJSONOwn,
    type BakeOptions, type JsonNode, type Repository, type TodlDocument,
} from '@pragmatic-tech-ai/todl'

import type { PresentationContribution, PresentationSource } from './todl-presentation-registry.js'
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

// One cached per-file bake, remembering which member and file it belongs to so eviction
// can match either by file or by member.
interface FileEntry
{
    memberId: string
    fileUri: string
    contribution: PresentationContribution
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

    public readonly id = SolutionGraphPresentationSource.SourceId

    private readonly baker: ProviderPresentationBaker
    // `${memberId}::${fileUri}` → that file's last baked contribution; evicted on GraphChanged.
    private readonly cache = new Map<string, FileEntry>()
    // The single GraphChanged subscription, attached lazily on the first load() that finds
    // a live language service and torn down in dispose().
    private subscription: IDisposable | undefined

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
        this.cache.clear()
    }

    // Attach the GraphChanged eviction handler once: a replace/rebuild of a member's slice
    // names that member, so its cached contribution is dropped and re-baked on next load().
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
            for (const [key, entry] of this.cache)
            {
                // Named files evict file-granularly; with none named, evict the whole member.
                const evict = fileIds.size > 0 ? fileIds.has(entry.fileUri) : memberIds.has(entry.memberId)
                if (evict)
                {
                    this.cache.delete(key)
                }
            }
        })
    }

    // The bake-or-cache step for one member storage: merges the member's per-file
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

        // Group the member's file-homed own nodes by authoring file (a node with no
        // provenance entry is not file-homed and belongs to no file subset).
        const idsByFile = new Map<string, Set<string>>()
        for (const id of ownIds)
        {
            const fileUri = view.provenanceOf.get(id)
            if (fileUri === undefined)
            {
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

        const assets = new ResourceDictionary()
        const iconKeys = new Map<string, string>()
        let bases: readonly TodlDocument[] | undefined
        let any = false
        for (const [fileUri, ids] of idsByFile)
        {
            const key = SolutionGraphPresentationSource.CacheKey(memberId, fileUri)
            let contribution = this.cache.get(key)?.contribution
            if (contribution === undefined)
            {
                bases ??= (await language.ResolveBasesFor(storage)).bases
                contribution = await this.BakeFile(view, storage, key, ids, bases)
                if (contribution !== undefined)
                {
                    this.cache.set(key, { memberId, fileUri, contribution })
                }
            }
            if (contribution === undefined)
            {
                continue
            }
            any = true
            for (const [assetKey, value] of contribution.assets.Entries())
            {
                assets.Set(assetKey, value)
            }
            for (const [iconKey, value] of contribution.iconKeys)
            {
                iconKeys.set(iconKey, value)
            }
        }
        return any ? { assets, iconKeys } : undefined
    }

    private static CacheKey(memberId: string, fileUri: string): string
    {
        return `${memberId}${SolutionGraphPresentationSource.KeySeparator}${fileUri}`
    }

    // Bake one file's icon subset: carve its own document, close it over the member's bases,
    // bake in memory (icon bytes read from the member's storage) and read the sidecars back.
    // undefined when the file declares no icons or the bake cannot complete (a missing icon
    // file — swallowed so one file can't sink the whole discover). `bakeId` is both the
    // bake id and the read-back id.
    private async BakeFile(
        view: SolutionModelView,
        storage: IStorage,
        bakeId: string,
        fileIds: Set<string>,
        bases: readonly TodlDocument[],
    ): Promise<PresentationContribution | undefined>
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
            return undefined
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
