import { ModelDraft } from '@pragmatic-tech-ai/todl'
import type { Repository, Entity, SourceFile } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type WikiOrigin, openProjectOrigin } from '../../../services/projects/wiki-origin.js'

// One viewpoint's projection over the model: the concepts it frames and the
// entities visible through it (an entity is a member when its concept is framed
// by this viewpoint, subtype-aware via Repository.viewpointsFraming).
export interface Viewpoint
{
    id: string
    framedConcepts: string[]
    members: Entity[]
}

// A live, per-project architecture model. Wraps a ModelDraft (bases ∪ own
// instances) and projects it through the meta-model's viewpoints. Read surface
// only here; mutation + save arrive in Task 2.
export class ArchModel
{
    public constructor(
        protected draft: ModelDraft,
        protected readonly storage: IStorage,
        public readonly namespace: string,
        // The merged base Repository (meta-model + libraries) this model composes
        // against. Required for restore() to recompose from captured .todl text;
        // optional so existing 3-arg constructions (tests) still compile.
        private readonly baseModel?: Repository,
        // Provenance of each base node (nodeId → where its declaring artifact
        // lives), so a concept's wiki page resolves against the right storage.
        private readonly wikiOriginByNode: ReadonlyMap<string, WikiOrigin> = new Map(),
    ) {}

    // Where the artifact declaring `concept` lives — its published package, or an
    // open source project. Drives wiki-page location. A resolvable-but-untagged
    // concept was declared by this project's own source (→ its project root).
    public wikiOriginOf(concept: string): WikiOrigin | undefined
    {
        const direct = this.wikiOriginByNode.get(concept)
        if (direct !== undefined) return direct
        const node = this.repository().resolve(concept)
        if (node === undefined) return undefined
        return this.wikiOriginByNode.get(node.id) ?? openProjectOrigin(this.storage)
    }

    public entities(): Entity[]
    {
        return this.draft.ownInstances()
    }

    public repository(): Repository
    {
        return this.draft.model
    }

    // The project's storage — used to read its manifest (bases the model
    // references) when scoping the toolbox's library pages to the active diagram.
    public get Storage(): IStorage
    {
        return this.storage
    }

    // The own-file delta as uri → TODL text — what save() writes and what the undo
    // history layer captures as this model's snapshot.
    public toTodlByFile(): Map<string, string>
    {
        return this.draft.toTodlByFile()
    }

    // Replace the own instances from a previously-captured toTodlByFile snapshot,
    // recomposed against the (unchanged) base model. Silent: does NOT fire onChanged
    // — the undo history's reconcile step drives the single rescan + save.
    public restore(fileTexts: Map<string, string>): void
    {
        const sources: SourceFile[] = [...fileTexts].map(([uri, text]) => ({ uri, text }))
        const bases = this.baseModel !== undefined ? [this.baseModel] : []
        this.draft = ModelDraft.fromSources(bases, sources, { namespace: this.namespace })
    }

    // Rebuild the own-instance draft from the CURRENT on-disk sources, recomposed
    // against the unchanged base model, then fire onChanged so live consumers (the
    // arch diagram bindings) rescan + re-project. Called when the project's .todl
    // files change externally (or via the in-app TODL editor) so open diagrams
    // reflect the edit instead of projecting a stale cached model. Unlike restore()
    // (silent, undo-driven), this DOES fire onChanged — it is the authoritative
    // "the source of truth on disk moved" refresh.
    public reloadFromDisk(sources: SourceFile[]): void
    {
        const bases = this.baseModel !== undefined ? [this.baseModel] : []
        this.draft = ModelDraft.fromSources(bases, sources, { namespace: this.namespace })
        this.fire()
    }

    public viewpoints(): Viewpoint[]
    {
        const repo = this.draft.model
        const ents = this.entities()
        return repo.viewpoints().map((id) => ({
            id,
            framedConcepts: repo.frames(id),
            members: ents.filter((e) => repo.viewpointsFraming(e.concept).includes(id)),
        }))
    }

    // Subscribers notified after any mutation, so SP4 diagrams can refresh.
    // ModelDraft has no events; ArchModel owns them.
    private readonly listeners = new Set<() => void>()

    public onChanged(cb: () => void): () => void
    {
        this.listeners.add(cb)
        return () => { this.listeners.delete(cb) }
    }

    private fire(): void
    {
        for (const cb of this.listeners) cb()
    }

    // Create an own instance. homeUri routes it to a source file for save();
    // viewpoint→file routing (first-suitable) is SP4's concern.
    public create(concept: string, id: string, homeUri?: string): Entity
    {
        const e = this.draft.create(concept, id, homeUri)
        this.fire()
        return e
    }

    public setField(id: string, name: string, value: string): void
    {
        this.draft.setField(id, name, value)
        this.fire()
    }

    public addRef(from: string, member: string, to: string): void
    {
        this.draft.addRef(from, member, to)
        this.fire()
    }

    public removeRef(from: string, member: string, to: string): void
    {
        this.draft.removeRef(from, member, to)
        this.fire()
    }

    public remove(id: string): void
    {
        this.draft.remove(id)
        this.fire()
    }

    // Persist every home file the draft partitions its own delta into.
    public async save(): Promise<void>
    {
        for (const [uri, text] of this.draft.toTodlByFile())
            await this.storage.WriteText(uri, text)
    }

    // The home file (source uri) an own entity round-trips to.
    public homeOf(id: string): string | undefined
    {
        return this.draft.homeOf(id)
    }

    // The file that conforms to `vp`: an existing own entity's home whose
    // `conforms` attr is `vp`, else a fresh `<vp>.todl` (lowercased).
    public homeForViewpoint(vp: string): string
    {
        for (const e of this.entities()) {
            if (this.repository().resolve(e.id)?.attrs.get('conforms') === vp) {
                const h = this.draft.homeOf(e.id)
                if (h !== undefined) return h
            }
        }
        return `${vp.toLowerCase()}.todl`
    }

    // Create a new own instance of `concept`, routed to `vp`'s file and stamped
    // `conforms = vp` so toTodlByFile emits that file's `conforms vp` header.
    public createInViewpoint(concept: string, vp: string): Entity
    {
        const id = this.uniqueId(concept)
        const e = this.draft.create(concept, id, this.homeForViewpoint(vp))
        this.draft.setField(id, 'conforms', vp)
        this.fire()
        return e
    }

    // Re-fire the change signal (used by the drop after wiring a Figure so the
    // binding rescans and binds the new node).
    public notifyChanged(): void
    {
        this.fire()
    }

    // A model-unique id: `concept1`, `concept2`, … Numbered from 1 so it never
    // collides with the concept node itself (which shares the lowercased name).
    public uniqueId(concept: string): string
    {
        const base = concept.toLowerCase()
        let i = 1
        while (this.repository().resolve(`${base}${i}`) !== undefined) i++
        return `${base}${i}`
    }
}
