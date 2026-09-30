import { describe, it, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectType, type SolutionMember } from '@pragmatic-tech-ai/todl'
import { PublishedBasesKey, LiveValidationKey, BaseResolverKey } from '../../../../projects/index.js'
import type { OpenProject } from '../../../../projects/open-project.js'
import { ReferenceEditingService, type IReferenceHost } from '../reference-editing-service.js'
import { ReferenceResolution } from '../../../solution-explorer/services/reference-view.js'

const Manifest = 'project.plexus'
const member = {} as SolutionMember

interface HarnessOpts
{
    requiresMetaModel?: boolean
    offersLibraries?: boolean
    manifest?: Record<string, unknown>
    published?: { metaModels?: { id: string; version: string }[]; libraries?: { id: string; version: string }[] }
    workspaceProducers?: Partial<Record<ProjectType, { id: string; version: string }[]>>
}

async function harnessWith(opts: HarnessOpts)
{
    const storage = new FakeStorage('mem://p')
    await storage.WriteText(Manifest, JSON.stringify(opts.manifest ?? { type: 'architecture', name: 'a', metaModels: [] }))
    const refreshedBases: unknown[] = []
    const raisedFor: unknown[] = []
    const provider = new ServiceProvider()
    provider.registerInstance(PublishedBasesKey, {
        ListMetaModels: async () => opts.published?.metaModels ?? [],
        ListLibraries: async () => opts.published?.libraries ?? [],
    } as never)
    provider.registerInstance(BaseResolverKey, {
        WorkspaceProducers: async (kind: ProjectType) => opts.workspaceProducers?.[kind] ?? [],
    } as never)
    provider.registerInstance(LiveValidationKey, { RefreshBases: async (s: unknown) => { refreshedBases.push(s) } } as never)

    const op = { Storage: storage, Name: 'a', Factory: { requiresMetaModel: opts.requiresMetaModel ?? true, offersLibraries: opts.offersLibraries ?? true } } as unknown as OpenProject
    let status = ''
    const host: IReferenceHost = {
        ProjectFor: (m) => (m === member ? op : undefined),
        SetStatus: (s) => { status = s },
        RaiseReferencesChanged: async (s) => { raisedFor.push(s) },
    }
    const service = new ReferenceEditingService(provider, host)
    return { service, member, storage, refreshedBases, raisedFor, get status() { return status } }
}

describe('ReferenceEditingService', () =>
{
    it('ReferencesViewFor returns undefined for a non-consumer project', async () =>
    {
        const { service, member } = await harnessWith({ requiresMetaModel: false })
        expect(await service.ReferencesViewFor(member)).toBeUndefined()
    })

    it('IsConsumer follows the factory requiresMetaModel gate (drives whether a References node shows)', async () =>
    {
        expect((await harnessWith({ requiresMetaModel: true })).service.IsConsumer(member)).toBe(true)
        expect((await harnessWith({ requiresMetaModel: false })).service.IsConsumer(member)).toBe(false)
    })

    it('ReferencesViewFor omits Libraries and classifies resolution for a library project', async () =>
    {
        const { service, member } = await harnessWith({
            requiresMetaModel: true, offersLibraries: false,
            manifest: { type: 'library', id: 'l', packageVersion: '1.0.0', metaModels: [{ id: 'core', version: '1.2.0' }] },
            published: { metaModels: [{ id: 'core', version: '1.2.0' }] },
            workspaceProducers: { [ProjectType.MetaModel]: [] },
        })
        const view = (await service.ReferencesViewFor(member))!
        expect(view.OffersLibraries).toBe(false)
        expect(view.Libraries).toEqual([])
        expect(view.MetaModels[0]!.Resolution).toBe(ReferenceResolution.Published)
    })

    it('a version-drift pin resolves LiveWorkspace against an open producer, else Unresolved against published', async () =>
    {
        const live = await harnessWith({
            manifest: { type: 'architecture', name: 'a', metaModels: [{ id: 'core', version: '9.9.9' }] },
            published: { metaModels: [{ id: 'core', version: '1.0.0' }] },
            workspaceProducers: { [ProjectType.MetaModel]: [{ id: 'core', version: '1.0.0' }] },
        })
        expect((await live.service.ReferencesViewFor(live.member))!.MetaModels[0]!.Resolution).toBe(ReferenceResolution.LiveWorkspace)

        const drift = await harnessWith({
            manifest: { type: 'architecture', name: 'a', metaModels: [{ id: 'core', version: '9.9.9' }] },
            published: { metaModels: [{ id: 'core', version: '1.0.0' }] },
            workspaceProducers: { [ProjectType.MetaModel]: [] },
        })
        expect((await drift.service.ReferencesViewFor(drift.member))!.MetaModels[0]!.Resolution).toBe(ReferenceResolution.Unresolved)
    })

    it('AddMemberReference writes the manifest preserving other fields, refreshes bases, fires the signal', async () =>
    {
        const { service, member, storage, refreshedBases, raisedFor } = await harnessWith({
            manifest: { type: 'architecture', name: 'a', someOtherField: 42, metaModels: [] },
        })
        let firedFor: unknown = 'unset'
        service.OnReferencesViewChanged((m) => { firedFor = m })
        await service.AddMemberReference(member, ProjectType.MetaModel, { id: 'core', version: '1.0.0' })
        const written = JSON.parse(await storage.ReadText(Manifest))
        expect(written.metaModels).toEqual([{ id: 'core', version: '1.0.0' }])
        expect(written.someOtherField).toBe(42)
        expect(refreshedBases).toContain(storage)
        expect(raisedFor).toContain(storage)   // ReferencesChanged raised via the host
        expect(firedFor).toBe(member)
    })

    it('RemoveMemberReference and SetMemberReferenceVersion edit the correct list', async () =>
    {
        const { service, member, storage } = await harnessWith({
            manifest: { type: 'architecture', name: 'a', metaModels: [{ id: 'core', version: '1.0.0' }, { id: 'x', version: '2.0.0' }], libraries: [] },
        })
        await service.SetMemberReferenceVersion(member, ProjectType.MetaModel, 'core', '1.5.0')
        await service.RemoveMemberReference(member, ProjectType.MetaModel, { id: 'x', version: '2.0.0' })
        const written = JSON.parse(await storage.ReadText(Manifest))
        expect(written.metaModels).toEqual([{ id: 'core', version: '1.5.0' }])
    })

    it('AvailableReferencesFor excludes every version of an already-declared id and dedupes; AvailableVersionsFor merges published + live, newest first', async () =>
    {
        const { service, member } = await harnessWith({
            manifest: { type: 'architecture', name: 'a', metaModels: [{ id: 'core', version: '1.0.0' }] },
            published: { metaModels: [{ id: 'core', version: '1.0.0' }, { id: 'core', version: '1.1.0' }, { id: 'other', version: '2.0.0' }] },
            workspaceProducers: { [ProjectType.MetaModel]: [{ id: 'other', version: '2.0.0' }] },
        })
        const avail = (await service.AvailableReferencesFor(member, ProjectType.MetaModel)).map((r) => `${r.id}@${r.version}`)
        expect(avail).not.toContain('core@1.0.0')   // declared (exact)
        expect(avail).not.toContain('core@1.1.0')   // #6: no other version of an already-declared id (use Set Version)
        expect(avail.filter((k) => k === 'other@2.0.0').length).toBe(1)   // deduped across published+live
        // Set Version still offers every published version of a declared id.
        expect(await service.AvailableVersionsFor(member, ProjectType.MetaModel, 'core')).toEqual(['1.1.0', '1.0.0'])
    })

    it('AvailableVersionsFor orders a release above its prerelease and tolerates non-numeric segments', async () =>
    {
        const { service, member } = await harnessWith({
            manifest: { type: 'architecture', name: 'a', metaModels: [] },
            published: { metaModels: [
                { id: 'core', version: '1.0.0' },
                { id: 'core', version: '2.0.0-rc.1' },
                { id: 'core', version: '2.0.0' },
                { id: 'core', version: '1.0.0-beta' },
            ] },
        })
        expect(await service.AvailableVersionsFor(member, ProjectType.MetaModel, 'core'))
            .toEqual(['2.0.0', '2.0.0-rc.1', '1.0.0', '1.0.0-beta'])
    })
})
