// solution-reference-view.ts — the IReferenceView the Solution Explorer's References branch
// reads and mutates through, built over the todl engine's ReferenceEditor (member storage +
// SolutionLanguageService) instead of the legacy OpenProject projection. The engine writes the
// manifest, invalidates the resolver and raises ReferencesChanged; this adapter adds the UI
// concerns the engine stays free of: the factory.offersLibraries / requiresMetaModel gates
// (the engine applies none), the immediate LiveValidation base refresh, and the
// view-changed signal that repaints the tree.
import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { Disposable, type IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import {
    ProjectEventsKey, ProjectType, SolutionLanguageService, type SolutionMember,
} from '@pragmatic-tech-ai/todl'
import { ProjectFactoryRegistryKey, type IProjectFactory } from '../../../projects/project-factory.js'
import { PublishedBasesKey, LiveValidationKey } from '../../../projects/index.js'
import type { BaseRef } from '../../../projects/base-binding.js'
import {
    ReferenceResolution, type IReferenceView, type MemberReferencesView, type DeclaredReference,
} from './reference-view.js'
import {
    ReferenceEditor, ReferenceResolutionKind, type IPublishedBaseCatalog, type ReferenceBindingsInput,
} from './todl-engine-ops.js'

export class SolutionReferenceView implements IReferenceView
{
    private static readonly StaleMembersProperty = 'StaleMembers'

    private readonly handlers = new Set<(affected: SolutionMember | undefined) => void>()
    private staleSubscribed = false
    private staleOff: IDisposable | undefined

    constructor(private readonly provider: IServiceProvider)
    {
    }

    public OnReferencesViewChanged(handler: (affected: SolutionMember | undefined) => void): IDisposable
    {
        this.ensureStaleSubscription()
        this.handlers.add(handler)
        return new Disposable(() => { this.handlers.delete(handler) })
    }

    // Announce an edit made elsewhere (the modal Manage References) so the tree repaints.
    // `affected` undefined means every References provider re-fetches.
    public NotifyChanged(affected: SolutionMember | undefined): void
    {
        for (const handler of this.handlers) handler(affected)
    }

    public IsConsumer(member: SolutionMember): boolean
    {
        return this.factoryOf(member)?.requiresMetaModel === true
    }

    public async ReferencesViewFor(member: SolutionMember): Promise<MemberReferencesView | undefined>
    {
        const factory = this.factoryOf(member)
        const editor = this.editorFor(member)
        if (factory?.requiresMetaModel !== true || editor === undefined) return undefined   // not a references consumer
        const manifest = await editor.ReadManifest()
        const offersLibraries = factory.offersLibraries === true
        const metaModels = await this.classify(editor, ProjectType.MetaModel, manifest.metaModels)
        const libraries = offersLibraries ? await this.classify(editor, ProjectType.Library, manifest.libraries) : []
        return { OffersLibraries: offersLibraries, MetaModels: metaModels, Libraries: libraries }
    }

    public async AvailableReferencesFor(member: SolutionMember, kind: ProjectType): Promise<readonly BaseRef[]>
    {
        const editor = this.editorFor(member)
        if (editor === undefined) return []
        return editor.AvailableReferencesFor(kind)
    }

    public async AvailableVersionsFor(member: SolutionMember, kind: ProjectType, id: string): Promise<readonly string[]>
    {
        const editor = this.editorFor(member)
        if (editor === undefined) return []
        return editor.AvailableVersionsFor(kind, id)
    }

    public async AddMemberReference(member: SolutionMember, kind: ProjectType, ref: BaseRef): Promise<void>
    {
        await this.edit(member, kind, (list) =>
        {
            if (list.some((r) => r.id === ref.id && r.version === ref.version)) return list
            return [...list, { id: ref.id, version: ref.version }]
        })
    }

    public async RemoveMemberReference(member: SolutionMember, kind: ProjectType, ref: BaseRef): Promise<void>
    {
        await this.edit(member, kind, (list) => list.filter((r) => !(r.id === ref.id && r.version === ref.version)))
    }

    public async SetMemberReferenceVersion(member: SolutionMember, kind: ProjectType, id: string, version: string): Promise<void>
    {
        await this.edit(member, kind, (list) => list.map((r) => (r.id === id ? { id, version } : r)))
    }

    public dispose(): void
    {
        this.staleOff?.dispose()
        this.staleOff = undefined
        this.handlers.clear()
    }

    // The single write tail: read the declared lists, mutate one, write through the engine
    // (manifest write preserving other fields + Invalidate + ReferencesChanged), refresh the
    // live-validation bases, then signal the tree. Libraries are written only for a type that
    // offers them, so a library manifest keeps its shape.
    private async edit(member: SolutionMember, kind: ProjectType, fn: (list: readonly BaseRef[]) => readonly BaseRef[]): Promise<void>
    {
        const editor = this.editorFor(member)
        const storage = member.Storage
        if (editor === undefined || storage === undefined) return
        const manifest = await editor.ReadManifest()
        let metaModels: readonly BaseRef[] = manifest.metaModels
        let libraries: readonly BaseRef[] = manifest.libraries
        if (kind === ProjectType.Library) libraries = [...fn(manifest.libraries)]
        else metaModels = [...fn(manifest.metaModels)]
        const offersLibraries = this.factoryOf(member)?.offersLibraries === true
        const input: ReferenceBindingsInput = { metaModels, libraries: offersLibraries ? libraries : undefined }
        await editor.WriteReferences(input)
        await this.provider.get(LiveValidationKey)?.RefreshBases(storage)
        this.NotifyChanged(member)
    }

    private async classify(editor: ReferenceEditor, kind: ProjectType, refs: readonly BaseRef[]): Promise<DeclaredReference[]>
    {
        const out: DeclaredReference[] = []
        for (const ref of refs)
        {
            const resolved = await editor.Classify(kind, ref)
            out.push({ Ref: { id: ref.id, version: ref.version }, Resolution: SolutionReferenceView.resolutionOf(resolved) })
        }
        return out
    }

    private static resolutionOf(kind: ReferenceResolutionKind): ReferenceResolution
    {
        if (kind === ReferenceResolutionKind.LiveWorkspace) return ReferenceResolution.LiveWorkspace
        if (kind === ReferenceResolutionKind.Published) return ReferenceResolution.Published
        return ReferenceResolution.Unresolved
    }

    private factoryOf(member: SolutionMember): IProjectFactory | undefined
    {
        if (!member.IsResolved) return undefined
        return this.provider.getRequired(ProjectFactoryRegistryKey).factoryFor(member.Ref.type)
    }

    private editorFor(member: SolutionMember): ReferenceEditor | undefined
    {
        const storage = member.Storage
        const resolver = this.provider.get(SolutionLanguageService.Key)
        if (storage === undefined || resolver === undefined) return undefined
        return new ReferenceEditor(
            resolver, storage, this.provider.get(PublishedBasesKey) as IPublishedBaseCatalog | undefined, this.provider.get(ProjectEventsKey))
    }

    private ensureStaleSubscription(): void
    {
        if (this.staleSubscribed) return
        this.staleSubscribed = true
        const resolver = this.provider.get(SolutionLanguageService.Key)
        if (resolver === undefined) return
        this.staleOff = resolver.PropertyChanged(SolutionReferenceView.StaleMembersProperty).subscribe(() => this.NotifyChanged(undefined))
    }
}
