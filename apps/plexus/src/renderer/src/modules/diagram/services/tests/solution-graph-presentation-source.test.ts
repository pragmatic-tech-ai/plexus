import { describe, it, expect, afterEach, vi } from 'vitest'
import { FakeStorage, ServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    ProjectSystemComposer, SolutionLanguageService, SolutionManagerService, WikiLocator, fromJSON,
    type Entity, type JsonEdge, type JsonNode, type Repository, type TodlDocument, type WikiOrigin,
} from '@pragmatic-tech-ai/todl'

import { FakeLanguageService } from '../../../../services/todl/tests/fake-language-service.js'
import { SolutionGraphPresentationSource } from '../solution-graph-presentation-source.js'
import { TodlPresentationRegistry } from '../todl-presentation-registry.js'
import { setIconResourceResolver } from '../icon-key-converter.js'
import { resolveElementPresentation } from '../../../architecture-projects/services/element-presentation.js'

// Builds a microsoft-like source member's slice of the shared solution graph: each term is
// an Instance-tier class carrying an `icon` annotation application (`annotate icon { path }`)
// whose path points at an SVG in the member's own storage. The source carves this slice out
// by origin and bakes it, so the fixture reproduces exactly what the real compiled graph
// hands ModelView.
class GraphFixture
{
    public static readonly MemberId = 'microsoft'
    // The qualified ids the compiler emits for `MS.azure` / `MS.aws` under namespace `lib`
    // (<ns>.<Taxonomy>.<term>) — the REAL icon-index keys, NOT the brief's bare `lib.azure`.
    public static readonly AzureId = 'lib.MS.azure'
    public static readonly AwsId = 'lib.MS.aws'
    public static readonly AzureIconPath = 'resources/azure.svg'
    public static readonly AwsIconPath = 'resources/aws.svg'
    public static readonly AzureLabel = 'Azure'
    private static readonly IconAnnotation = 'todl.icon'
    private static readonly AnnotatedKind = 'Annotated'
    private static readonly InstanceTier = 'Instance'
    private static readonly PathAttr = 'path'
    private static readonly Namespace = 'lib'
    private static readonly ConceptType = 'lib.Technology'
    private static readonly FileUriPrefix = 'file:///'
    private static readonly FileUriSuffix = '.todl'
    private static readonly IconSvg = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 3h18v18H3z"/></svg>'

    // A term node, its icon-application node, and the Annotated edge joining them.
    private static TermSlice(id: string, iconPath: string): { nodes: JsonNode[]; edges: JsonEdge[] }
    {
        const appId = `${id}@${GraphFixture.IconAnnotation}`
        return {
            nodes: [
                { id, tier: GraphFixture.InstanceTier, type: GraphFixture.ConceptType, metaKind: null, namespace: GraphFixture.Namespace, localId: id, isClass: true, class: null, storageId: null, fields: [], attrs: {} } as unknown as JsonNode,
                { id: appId, tier: GraphFixture.InstanceTier, type: GraphFixture.IconAnnotation, metaKind: null, namespace: null, localId: null, isClass: false, class: null, storageId: null, fields: [], attrs: { [GraphFixture.PathAttr]: iconPath } } as unknown as JsonNode,
            ],
            edges: [{ kind: GraphFixture.AnnotatedKind, via: null, from: id, to: appId } as unknown as JsonEdge],
        }
    }

    public static IconApplicationOf(id: string): string
    {
        return `${id}@${GraphFixture.IconAnnotation}`
    }

    // The authoring file a term (and its icon-application node) is homed to: each term is
    // its own file, so a multi-term member is a multi-file member.
    public static FileOf(id: string): string
    {
        return `${GraphFixture.FileUriPrefix}${id}${GraphFixture.FileUriSuffix}`
    }

    // The shared-graph view ModelView returns: one Repository over every term's slice plus
    // the origin map pointing every own node at this member's storage.
    public static View(storage: IStorage, terms: ReadonlyArray<{ id: string; iconPath: string }>): { model: Repository; originOf: ReadonlyMap<string, WikiOrigin>; provenanceOf: ReadonlyMap<string, string> }
    {
        const nodes: JsonNode[] = []
        const edges: JsonEdge[] = []
        for (const term of terms)
        {
            const slice = GraphFixture.TermSlice(term.id, term.iconPath)
            nodes.push(...slice.nodes)
            edges.push(...slice.edges)
        }
        const model = fromJSON({ nodes, edges } as TodlDocument)
        const origin = WikiLocator.OpenProjectOrigin(storage)
        const originOf = new Map<string, WikiOrigin>()
        const provenanceOf = new Map<string, string>()
        for (const term of terms)
        {
            const file = GraphFixture.FileOf(term.id)
            provenanceOf.set(term.id, file)
            provenanceOf.set(`${term.id}@${GraphFixture.IconAnnotation}`, file)
        }
        for (const node of nodes)
        {
            originOf.set(node.id, origin)
        }
        return { model, originOf, provenanceOf }
    }

    public static async WriteIcons(storage: IStorage, paths: ReadonlyArray<string>): Promise<void>
    {
        for (const path of paths)
        {
            await storage.WriteText(path, GraphFixture.IconSvg)
        }
    }
}

// Reaches into a source's private state so tests can count bakes, inspect the cache and
// compute the whole-member reference bake the per-file result must equal.
class SourceProbe
{
    public static SpyBake(source: SolutionGraphPresentationSource)
    {
        return vi.spyOn((source as unknown as { baker: { Bake: (...args: unknown[]) => unknown } }).baker, 'Bake')
    }

    public static CacheKeys(source: SolutionGraphPresentationSource): string[]
    {
        return [...(source as unknown as { cache: Map<string, unknown> }).cache.keys()]
    }

    // The pre-file-granular semantics: ALL of the member's nodes baked as ONE document.
    public static async WholeMemberBake(source: SolutionGraphPresentationSource, view: { model: Repository }, storage: IStorage): Promise<{ assets: { Entries(): Iterable<[string, unknown]> }; iconKeys: Map<string, string> }>
    {
        const ids = new Set<string>([...view.model.allNodes()].map(node => node.id))
        const bake = (source as unknown as { BakeFile: (...args: unknown[]) => Promise<{ assets: { Entries(): Iterable<[string, unknown]> }; iconKeys: Map<string, string> }> }).BakeFile
        return bake.call(source, view, storage, SourceProbe.WholeBakeId, ids, [])
    }

    // Assets are eval'd template closures, so compare them by sorted key plus source text
    // (functions) or JSON (data) rather than by identity.
    public static AssetFingerprint(assets: { Entries(): Iterable<[string, unknown]> }): Array<[string, string]>
    {
        return [...assets.Entries()]
            .map(([key, value]): [string, string] => [key, typeof value === 'function' ? value.toString() : JSON.stringify(value)])
            .sort((a, b) => a[0].localeCompare(b[0]))
    }

    private static readonly WholeBakeId = 'reference-whole'
}

// A composed provider (so PresentationBakerKey resolves to TODL's default baker) backed by
// the fake language service + a one-member fake solution manager.
class Harness
{
    public readonly provider: ServiceProvider
    public readonly language: FakeLanguageService
    public readonly storage: FakeStorage

    constructor()
    {
        this.provider = new ServiceProvider()
        ProjectSystemComposer.Compose(this.provider)
        this.language = new FakeLanguageService()
        this.provider.registerInstance(SolutionLanguageService.Key, this.language as unknown as SolutionLanguageService)
        this.storage = new FakeStorage()
        this.provider.registerInstance(
            SolutionManagerService.Key,
            { ActiveSolution: { Members: [{ Storage: this.storage }] } } as unknown as SolutionManagerService,
        )
        this.language.ConsumerIds.set(this.storage, GraphFixture.MemberId)
    }
}

// discover() bridges the IconKeyConverter to the registry's owned aggregate via the module
// global — reset it between tests so one test's resolver cannot leak into the next.
afterEach(() => setIconResourceResolver(undefined))

describe('SolutionGraphPresentationSource', () =>
{
    it('contributes icon keys baked from a source member', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath])
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [{ id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath }])

        const source = new SolutionGraphPresentationSource(harness.provider)
        const { iconKeys, assets } = await source.load()

        // The contributed key is the node's fully-qualified id — the SAME id the diagram's
        // arch-icon lookup passes to registry.iconKeyFor — not the brief's bare 'lib.azure'.
        expect(iconKeys.get(GraphFixture.AzureId)).toBeTruthy()
        expect([...assets.Entries()].length).toBeGreaterThan(0)

        // Close the consumer loop: drive the REAL registry + the arch icon-resolution path end
        // to end, so a future drift in arch-icon.iconEntityKey (an instance id / a prefixed key)
        // that no longer matched the bake key would fail HERE, not render blank in the app.
        const registry = new TodlPresentationRegistry(harness.provider)
        registry.registerSource(source)
        await registry.discover()
        expect(registry.iconKeyFor(GraphFixture.AzureId)).toBeTruthy()

        const repo = harness.language.ModelViewResult.model
        const entity = repo.entity(GraphFixture.AzureId) as Entity
        const presentation = resolveElementPresentation(repo, registry, entity, GraphFixture.AzureLabel)
        expect(presentation.iconKey).not.toBeNull()

        source.dispose()
    })

    it('serves the cache until GraphChanged names the member, then re-bakes', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath, GraphFixture.AwsIconPath])
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [{ id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath }])

        const source = new SolutionGraphPresentationSource(harness.provider)
        const first = await source.load()
        expect(first.iconKeys.size).toBe(1)

        // Grow the SAME file to two icon-bearing terms (the new term is homed to Azure's file);
        // without invalidation the file's cached contribution still wins.
        const grown = GraphFixture.View(harness.storage, [
            { id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath },
            { id: GraphFixture.AwsId, iconPath: GraphFixture.AwsIconPath },
        ])
        const azureFile = GraphFixture.FileOf(GraphFixture.AzureId)
        const provenanceOf = new Map<string, string>()
        for (const id of grown.provenanceOf.keys())
        {
            provenanceOf.set(id, azureFile)
        }
        harness.language.ModelViewResult = { ...grown, provenanceOf }
        const cached = await source.load()
        expect(cached.iconKeys.size).toBe(1)

        // GraphChanged naming the member evicts its cached contribution → next load re-bakes.
        harness.language.GraphChanged.emit({ memberIds: [GraphFixture.MemberId], fileIds: [] })
        const rebaked = await source.load()
        expect(rebaked.iconKeys.size).toBe(2)
        expect(rebaked.iconKeys.get(GraphFixture.AwsId)).toBeTruthy()
        source.dispose()
    })

    it('re-bakes only the changed file of a multi-file member, equal to a whole-member bake', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath, GraphFixture.AwsIconPath])
        const view = GraphFixture.View(harness.storage, [
            { id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath },
            { id: GraphFixture.AwsId, iconPath: GraphFixture.AwsIconPath },
        ])
        harness.language.ModelViewResult = view

        const source = new SolutionGraphPresentationSource(harness.provider)
        const bake = SourceProbe.SpyBake(source)
        const cold = await source.load()
        expect(cold.iconKeys.size).toBe(2)
        expect(bake).toHaveBeenCalledTimes(2)

        // Only fileA changed: exactly one more bake, fileB's cached entry survives directly.
        harness.language.GraphChanged.emit({ memberIds: [GraphFixture.MemberId], fileIds: [GraphFixture.FileOf(GraphFixture.AzureId)] })
        const keys = SourceProbe.CacheKeys(source)
        expect(keys).toHaveLength(1)
        expect(keys[0]).toContain(GraphFixture.FileOf(GraphFixture.AwsId))
        const granular = await source.load()
        expect(bake).toHaveBeenCalledTimes(3)
        expect(SourceProbe.CacheKeys(source)).toHaveLength(2)

        // Parity: the granular merge equals baking the whole member as one document.
        const whole = await SourceProbe.WholeMemberBake(source, view, harness.storage)
        expect(granular.iconKeys).toEqual(whole.iconKeys)
        expect(SourceProbe.AssetFingerprint(whole.assets).length).toBeGreaterThan(0)
        expect(SourceProbe.AssetFingerprint(granular.assets)).toEqual(SourceProbe.AssetFingerprint(whole.assets))

        source.dispose()
    })

    it('evicts every file of a multi-file member on a member-level change (empty fileIds)', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath, GraphFixture.AwsIconPath])
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [
            { id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath },
            { id: GraphFixture.AwsId, iconPath: GraphFixture.AwsIconPath },
        ])

        const source = new SolutionGraphPresentationSource(harness.provider)
        const bake = SourceProbe.SpyBake(source)
        await source.load()
        expect(bake).toHaveBeenCalledTimes(2)

        harness.language.GraphChanged.emit({ memberIds: [GraphFixture.MemberId], fileIds: [] })
        expect(SourceProbe.CacheKeys(source)).toHaveLength(0)
        await source.load()
        expect(bake).toHaveBeenCalledTimes(4)
        source.dispose()
    })

    it('bakes a member whole when an icon application lives in a different file than its term', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath, GraphFixture.AwsIconPath])
        const view = GraphFixture.View(harness.storage, [
            { id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath },
            { id: GraphFixture.AwsId, iconPath: GraphFixture.AwsIconPath },
        ])
        // Azure's icon application is authored in Aws's file: the Annotated edge crosses files.
        const provenanceOf = new Map(view.provenanceOf)
        provenanceOf.set(GraphFixture.IconApplicationOf(GraphFixture.AzureId), GraphFixture.FileOf(GraphFixture.AwsId))
        const crossing = { ...view, provenanceOf }
        harness.language.ModelViewResult = crossing

        const source = new SolutionGraphPresentationSource(harness.provider)
        const bake = SourceProbe.SpyBake(source)
        const merged = await source.load()
        expect(merged.iconKeys.get(GraphFixture.AzureId)).toBeTruthy()
        expect(merged.iconKeys.get(GraphFixture.AwsId)).toBeTruthy()
        expect(bake).toHaveBeenCalledTimes(1)
        expect(SourceProbe.CacheKeys(source)).toHaveLength(1)

        const whole = await SourceProbe.WholeMemberBake(source, crossing, harness.storage)
        expect(merged.iconKeys).toEqual(whole.iconKeys)
        expect(SourceProbe.AssetFingerprint(merged.assets)).toEqual(SourceProbe.AssetFingerprint(whole.assets))

        // Any of the member's files changing re-bakes the whole member.
        harness.language.GraphChanged.emit({ memberIds: [GraphFixture.MemberId], fileIds: [GraphFixture.FileOf(GraphFixture.AzureId)] })
        expect(SourceProbe.CacheKeys(source)).toHaveLength(0)
        source.dispose()
    })

    it('prunes cache entries for files that disappear', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath, GraphFixture.AwsIconPath])
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [
            { id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath },
            { id: GraphFixture.AwsId, iconPath: GraphFixture.AwsIconPath },
        ])
        const source = new SolutionGraphPresentationSource(harness.provider)
        await source.load()
        expect(SourceProbe.CacheKeys(source)).toHaveLength(2)

        // The Aws file is deleted: its entry is pruned on the next load.
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [{ id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath }])
        await source.load()
        expect(SourceProbe.CacheKeys(source)).toHaveLength(1)
        source.dispose()
    })
})
