import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { Disposable, IStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    ProjectType, SolutionBaseResolver, type SolutionMember,
} from '@pragmatic-tech-ai/todl'
import { PublishedBasesKey, LiveValidationKey, BaseResolverKey } from '../../../projects/index.js'
import { PROJECT_MANIFEST_FILENAME } from '../../../projects/project-factory.js'
import type { OpenProject } from '../../../projects/open-project.js'
import type { BaseRef, BaseBindings } from '../../../projects/base-binding.js'
import {
    ReferenceResolution, type IReferenceView, type MemberReferencesView, type DeclaredReference,
} from '../../solution-explorer/services/reference-view.js'

// The narrow surface ReferenceEditingService needs from its owning ProjectExplorerService:
// the projected OpenProject for a member (undefined when unresolved) and a status sink.
export interface IReferenceHost
{
    ProjectFor(member: SolutionMember): OpenProject | undefined
    SetStatus(message: string): void
    // Announce the manifest edit on the app's project lifecycle bus (the host owns
    // ProjectEvents / ReferencesChanged); called after each successful write.
    RaiseReferencesChanged(storage: IStorage): Promise<void>
}

// The References branch's read + mutate + refresh-signal logic, factored out of
// ProjectExplorerService so it is testable in isolation. Reads the member's manifest,
// annotates each declared reference with its resolution (LiveWorkspace by open-producer id,
// else Published by exact id@version in the registry catalog, else Unresolved), and writes
// edits through one tail (manifest write preserving other fields → RefreshBases → status →
// ReferencesChanged event → OnReferencesViewChanged). The modal "Manage References…" routes
// its confirm through WriteReferences too, so both paths repaint the tree.
export class ReferenceEditingService implements IReferenceView
{
    private static readonly UpdatedStatusPrefix = 'Updated references for '
    private static readonly StaleMemberIdsProperty = 'StaleMemberIds'

    private readonly handlers = new Set<(affected: SolutionMember | undefined) => void>()
    private staleSubscribed = false
    private staleOff: Disposable | undefined

    constructor(private readonly provider: IServiceProvider, private readonly host: IReferenceHost)
    {
    }

    public OnReferencesViewChanged(handler: (affected: SolutionMember | undefined) => void): Disposable
    {
        this.ensureStaleSubscription()
        this.handlers.add(handler)
        return { dispose: () => { this.handlers.delete(handler) } }
    }

    public IsConsumer(member: SolutionMember): boolean
    {
        const op = this.host.ProjectFor(member)
        return op !== undefined && op.Factory.requiresMetaModel === true
    }

    public async ReferencesViewFor(member: SolutionMember): Promise<MemberReferencesView | undefined>
    {
        const op = this.host.ProjectFor(member)
        if (op === undefined || op.Factory.requiresMetaModel !== true) return undefined   // not a references consumer
        const manifest = await this.readManifest(op.Storage)
        const offersLibraries = op.Factory.offersLibraries === true
        const metaModels = await this.classify(ProjectType.MetaModel, manifest.metaModels ?? [])
        const libraries = offersLibraries ? await this.classify(ProjectType.Library, manifest.libraries ?? []) : []
        return { OffersLibraries: offersLibraries, MetaModels: metaModels, Libraries: libraries }
    }

    public async AvailableReferencesFor(member: SolutionMember, kind: ProjectType): Promise<readonly BaseRef[]>
    {
        const op = this.host.ProjectFor(member)
        if (op === undefined) return []
        const manifest = await this.readManifest(op.Storage)
        const declared = new Set((this.listOf(manifest, kind)).map(ReferenceEditingService.key))
        const candidates = [...await this.published(kind), ...await this.producers(kind)]
        const out: BaseRef[] = []
        const seen = new Set<string>()
        for (const ref of candidates)
        {
            const k = ReferenceEditingService.key(ref)
            if (declared.has(k) || seen.has(k)) continue
            seen.add(k)
            out.push({ id: ref.id, version: ref.version })
        }
        return out
    }

    public async AvailableVersionsFor(_member: SolutionMember, kind: ProjectType, id: string): Promise<readonly string[]>
    {
        const versions = new Set<string>()
        for (const ref of await this.published(kind)) if (ref.id === id) versions.add(ref.version)
        for (const ref of await this.producers(kind)) if (ref.id === id) versions.add(ref.version)
        return [...versions].sort(ReferenceEditingService.compareVersionsDesc)
    }

    public async AddMemberReference(member: SolutionMember, kind: ProjectType, ref: BaseRef): Promise<void>
    {
        await this.writeReferences(member, (b) => this.mutateList(b, kind, (list) =>
        {
            if (list.some((r) => r.id === ref.id && r.version === ref.version)) return list
            return [...list, { id: ref.id, version: ref.version }]
        }))
    }

    public async RemoveMemberReference(member: SolutionMember, kind: ProjectType, ref: BaseRef): Promise<void>
    {
        await this.writeReferences(member, (b) => this.mutateList(b, kind, (list) =>
            list.filter((r) => !(r.id === ref.id && r.version === ref.version))))
    }

    public async SetMemberReferenceVersion(member: SolutionMember, kind: ProjectType, id: string, version: string): Promise<void>
    {
        await this.writeReferences(member, (b) => this.mutateList(b, kind, (list) =>
            list.map((r) => (r.id === id ? { id, version } : r))))
    }

    // The single write tail for an already-resolved OpenProject — used by the modal's
    // confirm so it shares the mutators' path (fires the view-changed signal so the tree
    // repaints; affected is undefined → every References provider re-fetches from disk).
    public async WriteReferencesFor(op: OpenProject, mutate: (bindings: BaseBindings) => void): Promise<void>
    {
        await this.writeForOp(op, mutate, undefined)
    }

    public dispose(): void { this.staleOff?.dispose() }

    private async writeReferences(member: SolutionMember, mutate: (bindings: BaseBindings) => void): Promise<void>
    {
        const op = this.host.ProjectFor(member)
        if (op === undefined) return
        await this.writeForOp(op, mutate, member)
    }

    private async writeForOp(op: OpenProject, mutate: (bindings: BaseBindings) => void, affected: SolutionMember | undefined): Promise<void>
    {
        const manifest = await this.readManifest(op.Storage)
        const offersLibraries = op.Factory.offersLibraries === true
        const bindings: BaseBindings = { metaModels: manifest.metaModels, libraries: manifest.libraries }
        mutate(bindings)
        manifest.metaModels = [...(bindings.metaModels ?? [])]
        if (offersLibraries) manifest.libraries = [...(bindings.libraries ?? [])]
        await op.Storage.WriteText(PROJECT_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))
        await this.provider.get(LiveValidationKey)?.RefreshBases(op.Storage)
        this.host.SetStatus(ReferenceEditingService.UpdatedStatusPrefix + op.Name + '.')
        await this.host.RaiseReferencesChanged(op.Storage)
        this.fire(affected)
    }

    private mutateList(bindings: BaseBindings, kind: ProjectType, fn: (list: readonly BaseRef[]) => readonly BaseRef[]): void
    {
        if (kind === ProjectType.Library) bindings.libraries = [...fn(bindings.libraries ?? [])]
        else bindings.metaModels = [...fn(bindings.metaModels ?? [])]
    }

    private async classify(kind: ProjectType, refs: readonly BaseRef[]): Promise<DeclaredReference[]>
    {
        const producerIds = new Set((await this.producers(kind)).map((p) => p.id))
        const publishedKeys = new Set((await this.published(kind)).map(ReferenceEditingService.key))
        return refs.map((ref) =>
        {
            let resolution: ReferenceResolution
            if (producerIds.has(ref.id)) resolution = ReferenceResolution.LiveWorkspace
            else if (publishedKeys.has(ReferenceEditingService.key(ref))) resolution = ReferenceResolution.Published
            else resolution = ReferenceResolution.Unresolved
            return { Ref: { id: ref.id, version: ref.version }, Resolution: resolution }
        })
    }

    private async published(kind: ProjectType): Promise<readonly BaseRef[]>
    {
        const bases = this.provider.get(PublishedBasesKey)
        if (bases === undefined) return []
        return kind === ProjectType.Library ? bases.ListLibraries() : bases.ListMetaModels()
    }

    private async producers(kind: ProjectType): Promise<readonly BaseRef[]>
    {
        return (await this.provider.get(BaseResolverKey)?.WorkspaceProducers(kind)) ?? []
    }

    private listOf(manifest: ManifestReferences, kind: ProjectType): readonly BaseRef[]
    {
        return (kind === ProjectType.Library ? manifest.libraries : manifest.metaModels) ?? []
    }

    private async readManifest(storage: IStorage): Promise<ManifestReferences>
    {
        return JSON.parse(await storage.ReadText(PROJECT_MANIFEST_FILENAME)) as ManifestReferences
    }

    private ensureStaleSubscription(): void
    {
        if (this.staleSubscribed) return
        this.staleSubscribed = true
        const resolver = this.provider.get(SolutionBaseResolver.Key)
        if (resolver === undefined) return
        this.staleOff = resolver.PropertyChanged(ReferenceEditingService.StaleMemberIdsProperty).subscribe(() => this.fire(undefined))
    }

    private fire(affected: SolutionMember | undefined): void
    {
        for (const handler of this.handlers) handler(affected)
    }

    private static key(ref: BaseRef): string { return `${ref.id}@${ref.version}` }

    private static compareVersionsDesc(a: string, b: string): number
    {
        const pa = a.split('.').map((n) => Number.parseInt(n, 10))
        const pb = b.split('.').map((n) => Number.parseInt(n, 10))
        for (let i = 0; i < Math.max(pa.length, pb.length); i++)
        {
            const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
            if (diff !== 0) return diff
        }
        return 0
    }
}

// The subset of the manifest this service reads/writes; other fields are preserved verbatim.
interface ManifestReferences
{
    metaModels?: BaseRef[]
    libraries?: BaseRef[]
    [key: string]: unknown
}
