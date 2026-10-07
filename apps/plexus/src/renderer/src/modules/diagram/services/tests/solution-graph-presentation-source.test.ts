import { describe, it, expect, afterEach, vi } from 'vitest'
import { FakeStorage, ServiceProvider, type ILocalFileAccess, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    ProjectSystemComposer, SolutionLanguageService, SolutionManagerService, WikiLocator, fromJSON,
    type Entity, type JsonEdge, type JsonNode, type Repository, type TodlDocument, type WikiOrigin,
} from '@pragmatic-tech-ai/todl'

import { FileChangeKind, type FileChangeEvent } from '@pragmatic-tech-ai/plexus-core/shared/file-watch-api.js'
import { FileWatchService } from '../../../../services/file-watch/file-watch-service.js'
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
    public static readonly ChangedIconSvg = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg>'
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

    // The whole-member bake with the SAME content-hash stamping the per-file path applies.
    public static async WholeMemberStamped(source: SolutionGraphPresentationSource, language: FakeLanguageService, view: { model: Repository }, storage: IStorage): Promise<{ assets: { Entries(): Iterable<[string, unknown]>; Resolve(key: string): unknown }; iconKeys: Map<string, string> }>
    {
        const ids = new Set<string>([...view.model.allNodes()].map(node => node.id))
        const internals = source as unknown as {
            AssetIdentityOf: (l: unknown, i: Set<string>) => Promise<{ hashes: Map<string, string> }>
            Stamp: (c: unknown, h: Map<string, string>) => { assets: { Entries(): Iterable<[string, unknown]>; Resolve(key: string): unknown }; iconKeys: Map<string, string> }
        }
        const baked = await SourceProbe.WholeMemberBake(source, view, storage)
        const identity = await internals.AssetIdentityOf(language, ids)
        return internals.Stamp(baked, identity.hashes)
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

// A FakeStorage that also offers local-file access, so asset keys are absolute OS paths
// (a plain FakeStorage is not a disk file and contributes no key).
class LocalFakeStorage extends FakeStorage implements ILocalFileAccess
{
    public static readonly OsRoot = 'C:\\proj'
    private static readonly OsSeparator = '\\'

    public ResolveOsPath(path: string): string
    {
        return `${LocalFakeStorage.OsRoot}${LocalFakeStorage.OsSeparator}${path.split('/').join(LocalFakeStorage.OsSeparator)}`
    }

    public OpenExternal(_path: string): Promise<void>
    {
        return Promise.resolve()
    }
}

// Stands in for the desktop-only FileWatchService (whose real constructor needs the
// Electron preload): same Subscribe contract, plus Emit so a test can fire a change.
class FakeFileWatch
{
    public static readonly AzureAbsolutePath = 'C:\\proj\\resources\\azure.svg'
    public static readonly AzureAbsolutePathLowerDrive = 'c:\\PROJ\\resources\\azure.svg'
    public static readonly OtherRootAzurePath = 'D:\\elsewhere\\resources\\azure.svg'
    public static readonly UnrelatedTextPath = 'C:\\proj\\notes.txt'
    public static readonly UnrelatedSvgPath = 'C:\\proj\\resources\\other.svg'
    public static readonly TodlPath = 'C:\\proj\\model.todl'
    private readonly subscribers = new Set<(e: FileChangeEvent) => void>()

    public Subscribe(cb: (e: FileChangeEvent) => void): () => void
    {
        this.subscribers.add(cb)
        return () => { this.subscribers.delete(cb) }
    }

    public Emit(e: FileChangeEvent): void
    {
        for (const cb of [...this.subscribers]) cb(e)
    }

    public get SubscriberCount(): number
    {
        return this.subscribers.size
    }
}

// A composed provider (so PresentationBakerKey resolves to TODL's default baker) backed by
// the fake language service + a one-member fake solution manager.
class Harness
{
    public readonly provider: ServiceProvider
    public readonly language: FakeLanguageService
    public readonly storage: LocalFakeStorage

    constructor()
    {
        this.provider = new ServiceProvider()
        ProjectSystemComposer.Compose(this.provider)
        this.language = new FakeLanguageService()
        this.provider.registerInstance(SolutionLanguageService.Key, this.language as unknown as SolutionLanguageService)
        this.storage = new LocalFakeStorage()
        this.provider.registerInstance(
            SolutionManagerService.Key,
            { ActiveSolution: { Members: [{ Storage: this.storage }] } } as unknown as SolutionManagerService,
        )
        this.language.ConsumerIds.set(this.storage, GraphFixture.MemberId)
    }

    // The language service reports the azure term's icon asset (storage + relative path).
    public DeclareAzureAsset(): void
    {
        this.language.ResourceResults.set(GraphFixture.AzureId, [{ annotation: 'todl.icon', storage: this.storage, path: GraphFixture.AzureIconPath }])
    }

    public DeclareAwsAsset(): void
    {
        this.language.ResourceResults.set(GraphFixture.AwsId, [{ annotation: 'todl.icon', storage: this.storage, path: GraphFixture.AwsIconPath }])
    }

    // Registers a fake file watcher and a real registry whose solution-graph source IS `source`
    // (the only source; AssetChanged re-discovers it).
    public WireAssetWatch(source: SolutionGraphPresentationSource): { watch: FakeFileWatch; registry: TodlPresentationRegistry }
    {
        const watch = new FakeFileWatch()
        this.provider.registerInstance(FileWatchService.Key, watch as unknown as FileWatchService)
        const registry = new TodlPresentationRegistry(this.provider)
        this.provider.registerInstance(TodlPresentationRegistry.Key, registry)
        registry.RegisterSolutionGraphSource(source)
        return { watch, registry }
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

    it('stamps identical content-hash keys on the per-file path and the whole-member bake', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath])
        await harness.storage.WriteText(GraphFixture.AwsIconPath, GraphFixture.ChangedIconSvg)
        const view = GraphFixture.View(harness.storage, [
            { id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath },
            { id: GraphFixture.AwsId, iconPath: GraphFixture.AwsIconPath },
        ])
        harness.language.ModelViewResult = view
        harness.DeclareAzureAsset()
        harness.DeclareAwsAsset()

        const source = new SolutionGraphPresentationSource(harness.provider)
        const granular = await source.load()
        expect(granular.iconKeys.size).toBe(2)
        const whole = await SourceProbe.WholeMemberStamped(source, harness.language, view, harness.storage)

        // Stamping really ran: the keys carry a hash suffix, and the two icons differ.
        const azureKey = granular.iconKeys.get(GraphFixture.AzureId) as string
        expect(azureKey).toMatch(/_[0-9a-f]+$/)
        expect(azureKey).not.toBe(granular.iconKeys.get(GraphFixture.AwsId))

        expect(granular.iconKeys).toEqual(whole.iconKeys)
        for (const key of granular.iconKeys.values())
        {
            expect(granular.assets.Resolve(key)).toBeDefined()
            expect(whole.assets.Resolve(key)).toBeDefined()
        }
        expect(SourceProbe.AssetFingerprint(granular.assets).map(([key]) => key)).toEqual(SourceProbe.AssetFingerprint(whole.assets).map(([key]) => key))
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

    it('evicts and re-bakes a unit when its resource asset changes on disk, with no GraphChanged', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath])
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [{ id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath }])
        harness.DeclareAzureAsset()

        const source = new SolutionGraphPresentationSource(harness.provider)
        const { watch, registry } = harness.WireAssetWatch(source)
        const bake = SourceProbe.SpyBake(source)
        await registry.discover()
        expect(bake).toHaveBeenCalledTimes(1)
        expect(watch.SubscriberCount).toBe(1)

        // Unrelated files (another svg, a text file, a .todl) evict nothing and re-bake nothing.
        for (const path of [FakeFileWatch.UnrelatedTextPath, FakeFileWatch.UnrelatedSvgPath, FakeFileWatch.TodlPath])
        {
            watch.Emit({ path, kind: FileChangeKind.Changed })
        }
        expect(SourceProbe.CacheKeys(source)).toHaveLength(1)
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(bake).toHaveBeenCalledTimes(1)

        watch.Emit({ path: FakeFileWatch.AzureAbsolutePath, kind: FileChangeKind.Changed })
        expect(SourceProbe.CacheKeys(source)).toHaveLength(0)
        await vi.waitFor(() => expect(bake).toHaveBeenCalledTimes(2))
        await vi.waitFor(() => expect(SourceProbe.CacheKeys(source)).toHaveLength(1))

        source.dispose()
        expect(watch.SubscriberCount).toBe(0)
    })

    it('gives the entity a NEW resource key and fires onChanged when the svg bytes change under the same path', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath])
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [{ id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath }])
        harness.DeclareAzureAsset()

        const source = new SolutionGraphPresentationSource(harness.provider)
        const { watch, registry } = harness.WireAssetWatch(source)
        await registry.discover()
        const before = registry.iconKeyFor(GraphFixture.AzureId)
        expect(before).toBeTruthy()
        expect(registry.resolveAsset(before as string)).toBeDefined()

        const changed: string[] = []
        registry.onChanged(key => changed.push(key))
        await harness.storage.WriteText(GraphFixture.AzureIconPath, GraphFixture.ChangedIconSvg)
        watch.Emit({ path: FakeFileWatch.AzureAbsolutePath, kind: FileChangeKind.Changed })

        await vi.waitFor(() => expect(changed).toContain(GraphFixture.AzureId))
        const after = registry.iconKeyFor(GraphFixture.AzureId)
        expect(after).toBeTruthy()
        expect(after).not.toBe(before)
        // Index value and asset-dictionary key moved in lockstep.
        expect(registry.resolveAsset(after as string)).toBeDefined()
        source.dispose()
    })

    it('matches asset paths case-insensitively but never across different roots', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath])
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [{ id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath }])
        harness.DeclareAzureAsset()

        const source = new SolutionGraphPresentationSource(harness.provider)
        const { watch, registry } = harness.WireAssetWatch(source)
        const bake = SourceProbe.SpyBake(source)
        await registry.discover()

        // Same relative tail, different root: not this unit's asset.
        watch.Emit({ path: FakeFileWatch.OtherRootAzurePath, kind: FileChangeKind.Changed })
        expect(SourceProbe.CacheKeys(source)).toHaveLength(1)

        // Drive-letter / directory case difference still matches.
        watch.Emit({ path: FakeFileWatch.AzureAbsolutePathLowerDrive, kind: FileChangeKind.Changed })
        expect(SourceProbe.CacheKeys(source)).toHaveLength(0)
        await vi.waitFor(() => expect(bake).toHaveBeenCalledTimes(2))
        source.dispose()
    })

    it('falls back to the default glyph when a resource asset is removed, without throwing', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath])
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [{ id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath }])
        harness.DeclareAzureAsset()

        const source = new SolutionGraphPresentationSource(harness.provider)
        const { watch, registry } = harness.WireAssetWatch(source)
        const bake = SourceProbe.SpyBake(source)
        await registry.discover()
        expect(registry.iconKeyFor(GraphFixture.AzureId)).toBeTruthy()

        await harness.storage.Delete(GraphFixture.AzureIconPath)
        expect(() => watch.Emit({ path: FakeFileWatch.AzureAbsolutePath, kind: FileChangeKind.Removed })).not.toThrow()
        await vi.waitFor(() => expect(registry.iconKeyFor(GraphFixture.AzureId)).toBeFalsy())

        // The failed bake is a cached marker: a plain reload does not re-bake it.
        const bakes = bake.mock.calls.length
        await registry.discover()
        expect(bake.mock.calls.length).toBe(bakes)

        // Restoring the asset (Added) evicts the marker and re-bakes the icon.
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath])
        watch.Emit({ path: FakeFileWatch.AzureAbsolutePath, kind: FileChangeKind.Added })
        await vi.waitFor(() => expect(registry.iconKeyFor(GraphFixture.AzureId)).toBeTruthy())

        source.dispose()
    })

    it('loads icons normally and attaches no asset watcher when no FileWatchService is registered (headless)', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath])
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [{ id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath }])
        harness.DeclareAzureAsset()
        const source = new SolutionGraphPresentationSource(harness.provider)
        const { iconKeys } = await source.load()
        expect(iconKeys.get(GraphFixture.AzureId)).toBeTruthy()
        expect((source as unknown as { assetUnsubscribe: unknown }).assetUnsubscribe).toBeUndefined()
        source.dispose()
    })

    it('survives a rejecting Resources() lookup', async () =>
    {
        const harness = new Harness()
        await GraphFixture.WriteIcons(harness.storage, [GraphFixture.AzureIconPath])
        harness.language.ModelViewResult = GraphFixture.View(harness.storage, [{ id: GraphFixture.AzureId, iconPath: GraphFixture.AzureIconPath }])
        harness.language.Resources = () => Promise.reject(new Error('boom'))
        const source = new SolutionGraphPresentationSource(harness.provider)
        const { iconKeys } = await source.load()
        expect(iconKeys.get(GraphFixture.AzureId)).toBeTruthy()
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
