import { describe, it, expect, vi } from 'vitest'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { Cardinality, WikiLocator, WikiOriginKind } from '@pragmatic-tech-ai/todl'
import type { WikiOrigin } from '@pragmatic-tech-ai/todl'
import { RemoteLanguageService } from '../remote-language-service.js'
import type { ILocalBaseResolution, IRemoteLanguageSession } from '../remote-language-service.js'
import fixture from './fixtures/server-model-view-page.json'

// The fixture is a page exactly as the server's DevModelView.Page emitted it (captured from the server's
// dev-model-view test: shop.eu1 and shop.eu2 owned by the open member, shop.us2 from a package).
class Parity
{
    public static readonly MemberStorage = {} as IStorage
    public static readonly OtherStorage = {} as IStorage
    public static readonly OwnedByMember = ['shop.eu1', 'shop.eu2']
    public static readonly PackageNode = 'shop.us2'
    public static readonly Concept = 'shop.Customer'

    // The LOCAL view's origin map for the same model: what SolutionLanguageService.ModelView yields.
    public static LocalOrigins(): ReadonlyMap<string, WikiOrigin>
    {
        const origins = new Map<string, WikiOrigin>()
        for (const id of Parity.OwnedByMember) origins.set(id, WikiLocator.OpenProjectOrigin(Parity.MemberStorage))
        origins.set(Parity.PackageNode, WikiLocator.PackageOrigin('acme.pkg', '1.2.3'))
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
            StorageOfMember: () => undefined,
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
        expect(Parity.OwnIds(remote, Parity.MemberStorage)).toEqual(Parity.OwnIds(local, Parity.MemberStorage))
        expect(Parity.OwnIds(remote, Parity.OtherStorage)).toEqual(Parity.OwnIds(local, Parity.OtherStorage))
        expect(remote.originOf.get(Parity.PackageNode)).toEqual(local.originOf.get(Parity.PackageNode))
    })

    it('the server-produced nodes materialize with their concept fields', async () =>
    {
        const remote = (await Parity.Service().ModelView(Parity.MemberStorage))!
        const concept = remote.model.resolve(Parity.Concept)!
        expect(concept.fields.map(f => f.name).sort()).toEqual(['region', 'secret'])
        expect(concept.fields.every(f => Cardinality[f.cardinality] !== undefined)).toBe(true)
    })
})
