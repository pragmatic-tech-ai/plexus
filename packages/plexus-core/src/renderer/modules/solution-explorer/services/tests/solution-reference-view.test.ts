import { describe, it, expect } from 'vitest'
import { Observable, ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import {
    ProjectEventsKey, ProjectType, Solution, SolutionLanguageService, SolutionMemberStatus,
} from '@pragmatic-tech-ai/todl'
import { PublishedBasesKey, LiveValidationKey } from '../../../../projects/index.js'
import { ProjectFactoryRegistryKey } from '../../../../projects/project-factory.js'
import { SolutionReferenceView } from '../solution-reference-view.js'
import { ReferenceResolution } from '../reference-view.js'

const Manifest = 'project.plexus'

interface HarnessOpts
{
    requiresMetaModel?: boolean
    offersLibraries?: boolean
    manifest?: Record<string, unknown>
    published?: { metaModels?: { id: string; version: string }[]; libraries?: { id: string; version: string }[] }
    workspaceProducers?: Partial<Record<ProjectType, { id: string; version: string }[]>>
}

// A stand-in SolutionLanguageService: an Observable (StaleMembers signal) with the three
// members the engine ReferenceEditor calls.
class FakeResolver extends Observable
{
    public readonly invalidated: string[] = []
    constructor(private readonly producers: HarnessOpts['workspaceProducers']) { super() }
    public async WorkspaceProducers(kind: ProjectType): Promise<{ id: string; version: string }[]> { return this.producers?.[kind] ?? [] }
    public async ConsumerIdOf(): Promise<string | undefined> { return 'consumer' }
    public Invalidate(id: string): void { this.invalidated.push(id) }
    public RaiseStale(): void { this.RaisePropertyChanged('StaleMembers', undefined, undefined) }
}

async function harnessWith(opts: HarnessOpts)
{
    const storage = new FakeStorage('mem://p')
    await storage.WriteText(Manifest, JSON.stringify(opts.manifest ?? { type: 'architecture', name: 'a', metaModels: [] }))
    const refreshedBases: unknown[] = []
    const raised: unknown[] = []
    const resolver = new FakeResolver(opts.workspaceProducers)
    const provider = new ServiceProvider()
    provider.registerInstance(PublishedBasesKey, {
        ListMetaModels: async () => opts.published?.metaModels ?? [],
        ListLibraries: async () => opts.published?.libraries ?? [],
    } as never)
    provider.registerInstance(SolutionLanguageService.Key, resolver as unknown as SolutionLanguageService)
    provider.registerInstance(LiveValidationKey, { RefreshBases: async (s: unknown) => { refreshedBases.push(s) } } as never)
    provider.registerInstance(ProjectEventsKey, { Raise: async (e: unknown) => { raised.push(e) } } as never)
    provider.registerInstance(ProjectFactoryRegistryKey, {
        factoryFor: () => ({ requiresMetaModel: opts.requiresMetaModel ?? true, offersLibraries: opts.offersLibraries ?? true }),
    } as never)
    const sol = new Solution('S')
    const member = sol.AddMember('./p', 'architecture')
    member.Status = SolutionMemberStatus.Resolved
    member.Storage = storage
    return { view: new SolutionReferenceView(provider), member, storage, refreshedBases, raised, resolver }
}

describe('SolutionReferenceView', () =>
{
    it('ReferencesViewFor returns undefined for a non-consumer project', async () =>
    {
        const { view, member } = await harnessWith({ requiresMetaModel: false })
        expect(view.IsConsumer(member)).toBe(false)
        expect(await view.ReferencesViewFor(member)).toBeUndefined()
    })

    it('keeps the offersLibraries gate: a library project omits Libraries; resolution is classified', async () =>
    {
        const { view, member } = await harnessWith({
            offersLibraries: false,
            manifest: { type: 'library', id: 'l', packageVersion: '1.0.0', metaModels: [{ id: 'core', version: '1.2.0' }], libraries: [{ id: 'x', version: '1.0.0' }] },
            published: { metaModels: [{ id: 'core', version: '1.2.0' }] },
        })
        const refs = (await view.ReferencesViewFor(member))!
        expect(refs.OffersLibraries).toBe(false)
        expect(refs.Libraries).toEqual([])
        expect(refs.MetaModels[0]!.Resolution).toBe(ReferenceResolution.Published)
    })

    it('a live workspace producer wins over published; neither is Unresolved', async () =>
    {
        const live = await harnessWith({
            manifest: { type: 'architecture', name: 'a', metaModels: [{ id: 'core', version: '9.9.9' }] },
            workspaceProducers: { [ProjectType.MetaModel]: [{ id: 'core', version: '1.0.0' }] },
        })
        expect((await live.view.ReferencesViewFor(live.member))!.MetaModels[0]!.Resolution).toBe(ReferenceResolution.LiveWorkspace)
        const none = await harnessWith({ manifest: { type: 'architecture', name: 'a', metaModels: [{ id: 'core', version: '9.9.9' }] } })
        expect((await none.view.ReferencesViewFor(none.member))!.MetaModels[0]!.Resolution).toBe(ReferenceResolution.Unresolved)
    })

    it('AddMemberReference writes through the engine, refreshes bases, raises ReferencesChanged and fires the signal', async () =>
    {
        const { view, member, storage, refreshedBases, raised, resolver } = await harnessWith({
            manifest: { type: 'architecture', name: 'a', someOtherField: 42, metaModels: [] },
        })
        let firedFor: unknown = 'unset'
        view.OnReferencesViewChanged((m) => { firedFor = m })
        await view.AddMemberReference(member, ProjectType.MetaModel, { id: 'core', version: '1.0.0' })
        const written = JSON.parse(await storage.ReadText(Manifest))
        expect(written.metaModels).toEqual([{ id: 'core', version: '1.0.0' }])
        expect(written.someOtherField).toBe(42)
        expect(resolver.invalidated).toEqual(['consumer'])
        expect(raised).toHaveLength(1)
        expect(refreshedBases).toContain(storage)
        expect(firedFor).toBe(member)
    })

    it('a library project never gains a libraries list from an edit', async () =>
    {
        const { view, member, storage } = await harnessWith({
            offersLibraries: false,
            manifest: { type: 'library', id: 'l', packageVersion: '1.0.0', metaModels: [] },
        })
        await view.AddMemberReference(member, ProjectType.MetaModel, { id: 'core', version: '1.0.0' })
        const written = JSON.parse(await storage.ReadText(Manifest))
        expect(written.libraries).toBeUndefined()
    })

    it('Remove / SetVersion edit the right list; Available* merge published + live, newest first', async () =>
    {
        const { view, member, storage } = await harnessWith({
            manifest: { type: 'architecture', name: 'a', metaModels: [{ id: 'core', version: '1.0.0' }, { id: 'x', version: '2.0.0' }], libraries: [] },
            published: { metaModels: [{ id: 'core', version: '1.0.0' }, { id: 'core', version: '1.1.0' }, { id: 'other', version: '2.0.0' }] },
            workspaceProducers: { [ProjectType.MetaModel]: [{ id: 'other', version: '2.0.0' }] },
        })
        expect(await view.AvailableVersionsFor(member, ProjectType.MetaModel, 'core')).toEqual(['1.1.0', '1.0.0'])
        const avail = (await view.AvailableReferencesFor(member, ProjectType.MetaModel)).map((r) => `${r.id}@${r.version}`)
        expect(avail).toEqual(['other@2.0.0'])
        await view.SetMemberReferenceVersion(member, ProjectType.MetaModel, 'core', '1.1.0')
        await view.RemoveMemberReference(member, ProjectType.MetaModel, { id: 'x', version: '2.0.0' })
        expect(JSON.parse(await storage.ReadText(Manifest)).metaModels).toEqual([{ id: 'core', version: '1.1.0' }])
    })

    it('a resolver stale signal re-fires the view-changed handlers (affected undefined)', async () =>
    {
        const { view, resolver } = await harnessWith({})
        const seen: unknown[] = []
        view.OnReferencesViewChanged((m) => { seen.push(m) })
        resolver.RaiseStale()
        expect(seen).toEqual([undefined])
        view.dispose()
        resolver.RaiseStale()
        expect(seen).toHaveLength(1)
    })
})
