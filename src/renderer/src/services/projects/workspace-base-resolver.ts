import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { PackageKind, type TodlDocument, type PackageRef } from '@pragmatic-tech-ai/todl'

import type { IStorage } from '../storage/storage.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'
import { ensureMetaModelsBackend } from '../../modules/meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../modules/library/services/libraries-backend.js'
import { TodlLanguageClient } from '../todl/todl-language-client.js'
import type { OpenProject } from './open-project.js'
import type { BaseRef } from './base-binding.js'
import { PROJECT_MANIFEST_FILENAME, ProducerKind, isProducer } from './project-factory.js'
import { type WikiOrigin, openProjectOrigin, packageOrigin } from './wiki-origin.js'

// The provenance of every base node — where its declaring artifact lives — keyed
// by node id, so the wiki opener can resolve a concept's page against the right
// storage (open project root vs published package dir).
type OriginMap = Map<string, WikiOrigin>

// The normalized manifest fields the resolver reads (modelVersion/libVersion
// unified to `version`).
interface ProjManifest
{
    type:       string
    id?:        string
    version?:   string
    metaModel?: BaseRef
    libraries?: readonly BaseRef[]
}

// A published model.json read back: the graph plus any recorded base deps.
interface PackageDocument extends TodlDocument { dependencies?: PackageRef[] }

// A snapshot of the open set, rebuilt when OpenProjects changes: producers keyed
// by `<kind>:<id>` (+ their version), and every project's outbound binding ids.
interface Snapshot
{
    producers: Map<string, { project: OpenProject; version: string | undefined }>
    consumers: { project: OpenProject; producedId: string | undefined; refIds: Set<string> }[]
}

// Resolves a project's bases local-first: an open producer (meta-model/library)
// whose manifest id matches a binding is compiled live (via its factory's
// compileToDocument) instead of read from the published registry. Recursive
// (a producer's own bases resolve the same way), cycle-guarded, self-excluding.
// Publish does NOT use this — it stays on resolveBases (published only).
export class WorkspaceBaseResolver extends ServiceBase
{
    public static readonly Key = new ServiceKey<WorkspaceBaseResolver>('WorkspaceBaseResolver')

    private snapshot: Snapshot | undefined
    private previousProducerKeys = new Set<string>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        // Signal B: rebuild the snapshot and refresh dependents whose resolution
        // could have flipped when the open set changes (open/close). Subscribed
        // once here; the explorer exists by the time this service is resolved.
        const explorer = this.Provider.get(ProjectExplorerService.Key)
        explorer?.OpenProjects.Subscribe(() => { this.snapshot = undefined; void this.onOpenSetChanged() })
    }

    // Resolve a consumer's declared bases, preferring open producers. `originOf`
    // tags each resolved base node with where its declaring artifact lives.
    public async ResolveForStorage(consumerStorage: IStorage): Promise<{ bases: TodlDocument[]; problems: string[]; originOf: OriginMap }>
    {
        return this.resolveBindingsOf(consumerStorage, new Set<IStorage>([consumerStorage]), new Set<string>())
    }

    // The set of published base package keys (`<id>@<version>`) a project
    // references, transitively — its manifest's meta-model + libraries plus each
    // published package's recorded dependencies. Scopes the toolbox's library /
    // meta-model pages to the active diagram's model. Best-effort: a ref whose
    // published model.json is absent (e.g. an unpublished local producer) still
    // contributes its own key; only its transitive deps are then unreachable.
    // Independent of ResolveForStorage (which merges docs) — here we only need ids.
    public async referencedPublishedRefs(storage: IStorage): Promise<Set<string>>
    {
        const manifest = await this.readManifest(storage)
        const out = new Set<string>()
        if (manifest?.metaModel !== undefined)
            await this.collectPublishedRef(manifest.metaModel, ProducerKind.MetaModel, out)
        for (const lib of manifest?.libraries ?? [])
            await this.collectPublishedRef(lib, ProducerKind.Library, out)
        return out
    }

    private async collectPublishedRef(ref: BaseRef, kind: ProducerKind, out: Set<string>): Promise<void>
    {
        const key = `${ref.id}@${ref.version}`
        if (out.has(key)) return
        out.add(key)
        const backend = kind === ProducerKind.MetaModel
            ? ensureMetaModelsBackend(this.Provider)
            : ensureLibrariesBackend(this.Provider)
        try {
            const doc = JSON.parse(await backend.ReadText(`${ref.id}/${ref.version}/model.json`)) as PackageDocument
            for (const dep of doc.dependencies ?? []) {
                const depKind = dep.kind === PackageKind.Library ? ProducerKind.Library : ProducerKind.MetaModel
                await this.collectPublishedRef({ id: dep.id, version: dep.version }, depKind, out)
            }
        } catch { /* unpublished / absent — its own key is recorded; deps unreachable */ }
    }

    // The producer id this storage publishes, or undefined if it is not a producer.
    public producedIdOf(storage: IStorage): string | undefined
    {
        const snap = this.snapshot
        if (snap === undefined) return undefined
        for (const c of snap.consumers) if (c.project.Storage === storage) return c.producedId
        return undefined
    }

    // Open projects whose bindings reference `id` (direct dependents).
    public dependentsOf(id: string): OpenProject[]
    {
        const snap = this.snapshot
        if (snap === undefined) return []
        return snap.consumers.filter((c) => c.refIds.has(id)).map((c) => c.project)
    }

    // Refresh (revalidate) every open project that transitively depends on any of
    // the given producer ids, via the language client's per-storage base refresh.
    public async RefreshDependentsOfIds(ids: readonly string[]): Promise<void>
    {
        await this.ensureSnapshot()
        const client = this.Provider.get(TodlLanguageClient.Key)
        const seenIds = new Set<string>()
        const toRefresh = new Set<IStorage>()
        const queue = [...ids]
        while (queue.length > 0)
        {
            const id = queue.shift()!
            if (seenIds.has(id)) continue
            seenIds.add(id)
            for (const dep of this.dependentsOf(id))
            {
                toRefresh.add(dep.Storage)
                const depId = this.producedIdOf(dep.Storage)
                if (depId !== undefined) queue.push(depId)
            }
        }
        for (const storage of toRefresh) await client?.RefreshBases(storage)
    }

    // ── internals ──

    private async resolveBindingsOf(
        storage: IStorage, visited: Set<IStorage>, seenPub: Set<string>,
    ): Promise<{ bases: TodlDocument[]; problems: string[]; originOf: OriginMap }>
    {
        const manifest = await this.readManifest(storage)
        const bases: TodlDocument[] = []
        const problems: string[] = []
        const originOf: OriginMap = new Map()
        if (manifest?.metaModel !== undefined)
            await this.resolveOne(manifest.metaModel, ProducerKind.MetaModel, storage, visited, bases, problems, originOf, seenPub)
        for (const lib of manifest?.libraries ?? [])
            await this.resolveOne(lib, ProducerKind.Library, storage, visited, bases, problems, originOf, seenPub)
        return { bases, problems, originOf }
    }

    private async resolveOne(
        ref: BaseRef, kind: ProducerKind, consumerStorage: IStorage,
        visited: Set<IStorage>, bases: TodlDocument[], problems: string[], originOf: OriginMap, seenPub: Set<string>,
    ): Promise<void>
    {
        const producer = await this.findOpenProducer(kind, ref.id)
        if (producer !== undefined && producer.Storage !== consumerStorage
            && !visited.has(producer.Storage) && isProducer(producer.Factory))
        {
            // `visited` is the current DFS path (ancestors), not a global seen-set:
            // add on entry, remove on exit (backtrack). This catches genuine cycles
            // — a producer still on the path — while allowing diamonds, where the
            // same producer (e.g. a meta-model bound by both the architecture and
            // one of its libraries) is reached by two independent branches.
            visited.add(producer.Storage)
            const child = await this.resolveBindingsOf(producer.Storage, visited, seenPub)
            visited.delete(producer.Storage)
            problems.push(...child.problems)
            const compiled = await producer.Factory.compileToDocument(producer.Storage, child.bases, this.Provider)
            for (const p of compiled.problems) problems.push(`local ${kind} "${ref.id}" — ${p}`)
            const pv = (await this.readManifest(producer.Storage))?.version
            if (pv !== undefined && pv !== ref.version)
                problems.push(`using local "${ref.id}" (open project) — binding requests @${ref.version}, project is @${pv}`)
            bases.push(compiled.doc)
            // Open producer → its concepts' pages are live source under its root.
            tagOrigin(originOf, compiled.doc, openProjectOrigin(producer.Storage))
            return
        }
        if (producer !== undefined && visited.has(producer.Storage))
            problems.push(`cyclic local reference to "${ref.id}"; using published`)
        // Published fallback — read the own-only doc and walk its recorded base
        // dependencies transitively (own-only packages record the bases they were
        // compiled against; the closure is reassembled by resolving those).
        await this.resolvePublishedTransitive(ref, kind, bases, problems, originOf, seenPub)
    }

    // Read a published package's own-only model.json and recurse into its recorded
    // dependencies, deduped by `kind:id@version` (cycle-safe). Deps always resolve
    // from the published registry (pinned versions); mergeBases dedups any node
    // overlap with a base already resolved local-first at the top level.
    private async resolvePublishedTransitive(
        ref: BaseRef, kind: ProducerKind, bases: TodlDocument[], problems: string[], originOf: OriginMap, seenPub: Set<string>,
    ): Promise<void>
    {
        const key = `${kind}:${ref.id}@${ref.version}`
        if (seenPub.has(key)) return
        seenPub.add(key)
        const backend = kind === ProducerKind.MetaModel
            ? ensureMetaModelsBackend(this.Provider)
            : ensureLibrariesBackend(this.Provider)
        try {
            const doc = JSON.parse(await backend.ReadText(`${ref.id}/${ref.version}/model.json`)) as PackageDocument
            bases.push({ nodes: doc.nodes, edges: doc.edges })
            // Published package → its concepts' pages ship at <backend>/<id>/<ver>/.
            tagOrigin(originOf, doc, packageOrigin(kind, ref.id, ref.version ?? ''))
            for (const dep of doc.dependencies ?? [])
            {
                const depKind = dep.kind === PackageKind.Library ? ProducerKind.Library : ProducerKind.MetaModel
                await this.resolvePublishedTransitive({ id: dep.id, version: dep.version }, depKind, bases, problems, originOf, seenPub)
            }
        } catch {
            problems.push(`${kind} "${ref.id}@${ref.version}" is not published`)
        }
    }

    private async findOpenProducer(kind: ProducerKind, id: string): Promise<OpenProject | undefined>
    {
        const snap = await this.ensureSnapshot()
        return snap.producers.get(`${kind}:${id}`)?.project
    }

    // Every open workspace project that PRODUCES a base of `kind`, as a BaseRef
    // (its manifest id + published version). Backs the References manager's
    // "add from an open project" catalog — a sibling can be referenced before it
    // is published, since resolution prefers the open producer. A producer with no
    // version yet (never published) is skipped: a reference needs a concrete
    // version to record.
    public async WorkspaceProducers(kind: ProducerKind): Promise<BaseRef[]>
    {
        const snap = await this.ensureSnapshot()
        const prefix = `${kind}:`
        const refs: BaseRef[] = []
        for (const [key, { version }] of snap.producers)
        {
            if (!key.startsWith(prefix) || version === undefined) continue
            refs.push({ id: key.slice(prefix.length), version })
        }
        return refs
    }

    private async ensureSnapshot(): Promise<Snapshot>
    {
        if (this.snapshot !== undefined) return this.snapshot
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const producers = new Map<string, { project: OpenProject; version: string | undefined }>()
        const consumers: Snapshot['consumers'] = []
        for (const op of explorer.OpenProjects.ToArray())
        {
            const m = await this.readManifest(op.Storage)
            if (m === undefined) continue
            let producedId: string | undefined
            if ((m.type === ProducerKind.MetaModel || m.type === ProducerKind.Library) && m.id !== undefined)
            {
                producers.set(`${m.type}:${m.id}`, { project: op, version: m.version })
                producedId = m.id
            }
            const refIds = new Set<string>()
            if (m.metaModel?.id !== undefined) refIds.add(m.metaModel.id)
            for (const l of m.libraries ?? []) if (l.id !== undefined) refIds.add(l.id)
            consumers.push({ project: op, producedId, refIds })
        }
        this.snapshot = { producers, consumers }
        return this.snapshot
    }

    private async readManifest(storage: IStorage): Promise<ProjManifest | undefined>
    {
        try {
            const m = JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as {
                type: string; id?: string; modelVersion?: string; libVersion?: string
                metaModel?: BaseRef; libraries?: readonly BaseRef[]
            }
            return { type: m.type, id: m.id, version: m.modelVersion ?? m.libVersion, metaModel: m.metaModel, libraries: m.libraries }
        } catch {
            return undefined
        }
    }

    // Signal B: on open/close, refresh dependents of any producer id that
    // appeared or disappeared (their resolution flips local<->published).
    private async onOpenSetChanged(): Promise<void>
    {
        const snap = await this.ensureSnapshot()
        const now = new Set(snap.producers.keys())
        const changedIds: string[] = []
        for (const key of now) if (!this.previousProducerKeys.has(key)) changedIds.push(key.split(':')[1]!)
        for (const key of this.previousProducerKeys) if (!now.has(key)) changedIds.push(key.split(':')[1]!)
        this.previousProducerKeys = now
        if (changedIds.length > 0) await this.RefreshDependentsOfIds(changedIds)
    }
}

// Tag every node of a resolved base with its origin. First-writer-wins so a node
// reached first via a direct open-producer binding keeps that (live-source)
// origin over a later published-diamond reach.
function tagOrigin(originOf: OriginMap, doc: TodlDocument, origin: WikiOrigin): void
{
    for (const n of doc.nodes) if (!originOf.has(n.id)) originOf.set(n.id, origin)
}

export default WorkspaceBaseResolver
