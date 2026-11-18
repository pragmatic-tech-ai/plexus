import { describe, it, expect, vi } from 'vitest'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { Cardinality, WikiLocator, WikiOriginKind } from '@pragmatic-tech-ai/todl'
import type { WikiOrigin } from '@pragmatic-tech-ai/todl'
import { RemoteLanguageService } from '../remote-language-service.js'
import type { ILocalBaseResolution, IRemoteLanguageSession } from '../remote-language-service.js'
import fixture from './fixtures/server-model-view-page.json'

// The fixture is a page exactly as the server's DevModelView.Page emitted it (captured from the server's
// dev-model-view test; shop.eu2's origin is re-pointed at a SECOND member so the member-id mapping is exercised:
// shop.eu1 owned by the open member, shop.eu2 by another member, shop.us2 from a package).
class Parity
{
    public static readonly MemberStorage = {} as IStorage
    public static readonly SecondMemberId = 'models-b'
    public static readonly SecondStorage = {} as IStorage
    public static readonly UnrelatedStorage = {} as IStorage
    public static readonly OwnedByMember = ['shop.eu1']
    public static readonly OwnedBySecond = ['shop.eu2']
    public static readonly PackageId = 'acme.pkg'
    public static readonly PackageVersion = '1.2.3'
    public static readonly FieldNames = ['region', 'secret']
    public static readonly PackageNode = 'shop.us2'
    public static readonly Concept = 'shop.Customer'

    // The LOCAL view's origin map for the same model: what SolutionLanguageService.ModelView yields.
    public static LocalOrigins(): ReadonlyMap<string, WikiOrigin>
    {
        const origins = new Map<string, WikiOrigin>()
        for (const id of Parity.OwnedByMember) origins.set(id, WikiLocator.OpenProjectOrigin(Parity.MemberStorage))
        for (const id of Parity.OwnedBySecond) origins.set(id, WikiLocator.OpenProjectOrigin(Parity.SecondStorage))
        origins.set(Parity.PackageNode, WikiLocator.PackageOrigin(Parity.PackageId, Parity.PackageVersion))
        return origins
    }

    // The diagram's per-member slicing predicate (SolutionGraphPresentationSource.OwnIds), verbatim.
    public static OwnIds(view: { model: { allNodes(): Iterable<{ id: string }> }; originOf: ReadonlyMap<string, WikiOrigin> }, storage: IStorage): Set<string>
    {
        const ids = new Set<string>()
        for (const node of view.model.allNodes())
        {
            const origin = view.originOf.get(node.id)
            if (origin !== undefined && origin.kind === WikiOriginKind.OpenProject && origin.storage === storage) ids.add(node.id)
        }
        return ids
    }

    public static Service(): RemoteLanguageService
    {
        const session = {
            ModelView: vi.fn(async () => fixture.page), ActiveSolution: vi.fn(async () => null),
            OnGraphChanged: vi.fn(() => () => undefined), OnBuildStateChanged: vi.fn(() => () => undefined), OnDiagnostics: vi.fn(() => () => undefined),
        }
        const members = {
            MemberIdOf: (s: IStorage) => (s === Parity.MemberStorage ? fixture.memberId : undefined),
            StorageOfMember: (id: string) => (id === Parity.SecondMemberId ? Parity.SecondStorage : undefined),
        }
        return new RemoteLanguageService(session as unknown as IRemoteLanguageSession, {} as unknown as ILocalBaseResolution, members)
    }
}

describe('remote model view parity with the local view', () =>
{
    it('the per-member slicing predicate yields the same node set on the remote view as on the local view', async () =>
    {
        const remote = (await Parity.Service().ModelView(Parity.MemberStorage))!
        const local = { model: remote.model, originOf: Parity.LocalOrigins() }
        expect([...Parity.OwnIds(remote, Parity.MemberStorage)].sort()).toEqual(Parity.OwnedByMember)
        // a node of the SECOND member is sliced under that member's storage, not the requesting member's
        expect([...Parity.OwnIds(remote, Parity.SecondStorage)].sort()).toEqual(Parity.OwnedBySecond)
        for (const storage of [Parity.MemberStorage, Parity.SecondStorage, Parity.UnrelatedStorage])
        {
            expect(Parity.OwnIds(remote, storage)).toEqual(Parity.OwnIds(local, storage))
        }
        expect(Parity.OwnIds(remote, Parity.UnrelatedStorage).size).toBe(0)
        expect(remote.originOf.get(Parity.PackageNode)).toEqual(local.originOf.get(Parity.PackageNode))
    })

    it('the server-produced nodes materialize with their concept fields', async () =>
    {
        const remote = (await Parity.Service().ModelView(Parity.MemberStorage))!
        const concept = remote.model.resolve(Parity.Concept)!
        expect(concept.fields.map(f => f.name).sort()).toEqual(Parity.FieldNames)
        expect(concept.fields.every(f => Cardinality[f.cardinality] !== undefined)).toBe(true)
    })
})
