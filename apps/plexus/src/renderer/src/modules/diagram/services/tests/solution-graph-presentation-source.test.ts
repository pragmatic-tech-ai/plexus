import { describe, it, expect } from 'vitest'
import { FakeStorage, ServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    ProjectSystemComposer, SolutionLanguageService, SolutionManagerService, WikiLocator, fromJSON,
    type JsonEdge, type JsonNode, type Repository, type TodlDocument, type WikiOrigin,
} from '@pragmatic-tech-ai/todl'

import { FakeLanguageService } from '../../../../services/todl/tests/fake-language-service.js'
import { SolutionGraphPresentationSource } from '../solution-graph-presentation-source.js'

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
    private static readonly IconAnnotation = 'todl.icon'
    private static readonly AnnotatedKind = 'Annotated'
    private static readonly InstanceTier = 'Instance'
    private static readonly PathAttr = 'path'
    private static readonly Namespace = 'lib'
    private static readonly ConceptType = 'lib.Technology'
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

    // The shared-graph view ModelView returns: one Repository over every term's slice plus
    // the origin map pointing every own node at this member's storage.
    public static View(storage: IStorage, terms: ReadonlyArray<{ id: string; iconPath: string }>): { model: Repository; originOf: ReadonlyMap<string, WikiOrigin> }
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
        for (const node of nodes)
        {
            originOf.set(node.id, origin)
        }
        return { model, originOf }
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

        // Grow the member to two icon-bearing terms; without invalidation the cache still wins.
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [
            { id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath },
            { id: GraphFixture.AwsId, iconPath: GraphFixture.AwsIconPath },
        ])
        const cached = await source.load()
        expect(cached.iconKeys.size).toBe(1)

        // GraphChanged naming the member evicts its cached contribution → next load re-bakes.
        harness.language.GraphChanged.emit({ memberIds: [GraphFixture.MemberId] })
        const rebaked = await source.load()
        expect(rebaked.iconKeys.size).toBe(2)
        expect(rebaked.iconKeys.get(GraphFixture.AwsId)).toBeTruthy()
        source.dispose()
    })
})
