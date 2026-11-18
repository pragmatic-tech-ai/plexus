import { describe, test, expect, vi } from 'vitest'
import { HostKind, ShellCompositionRoot } from '@pragmatic-tech-ai/mural/runtime'
import { SolutionManagerService, BuildService, SolutionLanguageService } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { StorageService } from '../../../storage/index.js'
import { RemoteSolutionServices } from '../remote-solution-services.js'
import { RemoteLanguageService } from '../remote-language-service.js'
import type { ILocalBaseResolution, IRemoteLanguageSession } from '../remote-language-service.js'
import { SolutionMemberIds } from '../solution-member-ids.js'

class Fixture
{
    public static readonly Host = new HostKind('remote-services-test')
    public readonly StorageA = { Tag: 'a' } as unknown as IStorage
    public readonly StorageB = { Tag: 'b' } as unknown as IStorage
    public readonly Solution = { Members: { ToArray: () => [
        { Ref: { path: 'a/project.todl.json', type: 't' }, Storage: this.StorageA },
        { Ref: { path: 'b/project.todl.json', type: 't' }, Storage: this.StorageB },
        { Ref: { path: 'c/project.todl.json', type: 't' }, Storage: undefined },
    ] } }
    public readonly Manager = { Tag: 'm', ActiveSolution: this.Solution }
    public readonly LangInProc = { Tag: 'in-proc', CompletionsAt: vi.fn() }
    public readonly Session = { OnGraphChanged: () => () => undefined, OnBuildStateChanged: () => () => undefined, OnDiagnostics: () => () => undefined, ActiveSolution: () => Promise.resolve(null), CompletionsAt: vi.fn() }

    public Compose(registerBuild: boolean): RemoteSolutionServices
    {
        const provider = new ShellCompositionRoot(Fixture.Host).Provider
        provider.registerInstance(SolutionManagerService.Key, this.Manager as unknown as SolutionManagerService)
        provider.registerInstance(SolutionLanguageService.Key, this.LangInProc as unknown as SolutionLanguageService)
        provider.registerInstance(StorageService.Key, { Tag: 's' } as unknown as StorageService)
        if (registerBuild) provider.registerInstance(BuildService.Key, { Tag: 'b' } as unknown as BuildService)
        return new RemoteSolutionServices(provider, this.Session as unknown as IRemoteLanguageSession, {} as unknown as ILocalBaseResolution)
    }
}

describe('RemoteSolutionServices', () =>
{
    test('only Language is remote; Manager/Build/Storage are the local singletons', () =>
    {
        const fixture = new Fixture()
        const services = fixture.Compose(true)
        expect(services.Language).toBeInstanceOf(RemoteLanguageService)
        expect(services.Language).not.toBe(fixture.LangInProc)
        expect(services.Manager).toBe(fixture.Manager)
        expect((services.Build as unknown as { Tag: string }).Tag).toBe('b')
        expect((services.Storage as unknown as { Tag: string }).Tag).toBe('s')
    })

    test('Build is undefined when unregistered', () =>
    {
        expect(new Fixture().Compose(false).Build).toBeUndefined()
    })

    test('LSP goes to the session, never the in-proc language service', () =>
    {
        const fixture = new Fixture()
        void fixture.Compose(true).Language.CompletionsAt('u', { line: 0, character: 0 })
        expect(fixture.Session.CompletionsAt).toHaveBeenCalled()
        expect(fixture.LangInProc.CompletionsAt).not.toHaveBeenCalled()
    })
})

describe('SolutionMemberIds', () =>
{
    test('round-trips member id and storage over the active solution', () =>
    {
        const fixture = new Fixture()
        const ids = new SolutionMemberIds(() => fixture.Solution as never)
        expect(ids.MemberIdOf(fixture.StorageA)).toBe('a/project.todl.json')
        expect(ids.StorageOfMember('b/project.todl.json')).toBe(fixture.StorageB)
        expect(ids.StorageOfMember(ids.MemberIdOf(fixture.StorageB) as string)).toBe(fixture.StorageB)
    })

    test('unknown storage/member and no solution give undefined', () =>
    {
        const fixture = new Fixture()
        const ids = new SolutionMemberIds(() => fixture.Solution as never)
        expect(ids.MemberIdOf({} as IStorage)).toBeUndefined()
        expect(ids.StorageOfMember('nope')).toBeUndefined()
        expect(ids.StorageOfMember('c/project.todl.json')).toBeUndefined()
        expect(new SolutionMemberIds(() => undefined).MemberIdOf(fixture.StorageA)).toBeUndefined()
    })
})
