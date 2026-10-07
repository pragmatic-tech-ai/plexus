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

    it('re-bakes only the changed file of a multi-file member, matching a cold load', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath, GraphFixture.AwsIconPath])
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [
            { id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath },
            { id: GraphFixture.AwsId, iconPath: GraphFixture.AwsIconPath },
        ])

        const source = new SolutionGraphPresentationSource(harness.provider)
        const bake = vi.spyOn((source as unknown as { baker: { Bake: (...args: unknown[]) => unknown } }).baker, 'Bake')
        const cold = await source.load()
        expect(cold.iconKeys.size).toBe(2)
        expect(bake).toHaveBeenCalledTimes(2)

        // Only fileA changed: exactly one more bake, fileB's cached entry survives.
        harness.language.GraphChanged.emit({ memberIds: [GraphFixture.MemberId], fileIds: [GraphFixture.FileOf(GraphFixture.AzureId)] })
        const granular = await source.load()
        expect(bake).toHaveBeenCalledTimes(3)
        expect(granular.iconKeys.get(GraphFixture.AzureId)).toBeTruthy()
        expect(granular.iconKeys.get(GraphFixture.AwsId)).toBeTruthy()

        // Parity: a brand-new source's cold load of the same state yields the same keys.
        const fresh = new SolutionGraphPresentationSource(harness.provider)
        const full = await fresh.load()
        expect([...granular.iconKeys.keys()].sort()).toEqual([...full.iconKeys.keys()].sort())
        expect([...granular.assets.Entries()].map(([key]) => key).sort()).toEqual([...full.assets.Entries()].map(([key]) => key).sort())

        source.dispose()
        fresh.dispose()
    })
})
