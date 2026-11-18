import { describe, test, expect, vi } from 'vitest'
import { HostKind, ShellCompositionRoot } from '@pragmatic-tech-ai/mural/runtime'
import { SolutionManagerService, SolutionLanguageService } from '@pragmatic-tech-ai/todl'
import type { Solution } from '@pragmatic-tech-ai/todl'
import { StorageService } from '../../storage/index.js'
import { DevStorageSessionKeys } from '../../storage/dev-storage-session-key.js'
import { SolutionOriginRegistry } from '../../solution-explorer/services/solution-origin-registry.js'
import { TargetSource } from '../../../../shared/account-api.js'
import { IntegratedSolutionServices } from '../integrated-solution-services.js'
import { RemoteSolutionServices } from '../remote/remote-solution-services.js'
import type { ILocalBaseResolution } from '../remote/remote-language-service.js'
import { OriginSelectedSolutionServices } from '../origin-selected-solution-services.js'

class SelectionFixture
{
    public static readonly Host = new HostKind('origin-selected-test')

    public readonly Unsub = vi.fn()
    public Active: Solution | undefined
    public readonly Registry = new SolutionOriginRegistry()
    public readonly Provider = new ShellCompositionRoot(SelectionFixture.Host).Provider
    public readonly Services: OriginSelectedSolutionServices

    public constructor()
    {
        const self = this
        this.Provider.registerInstance(SolutionManagerService.Key, { get ActiveSolution() { return self.Active } } as unknown as SolutionManagerService)
        this.Provider.registerInstance(SolutionLanguageService.Key, { Tag: 'l' } as unknown as SolutionLanguageService)
        this.Provider.registerInstance(StorageService.Key, { Tag: 's' } as unknown as StorageService)
        this.Provider.registerInstance(DevStorageSessionKeys.Session, { OnGraphChanged: () => this.Unsub, OnBuildStateChanged: () => this.Unsub, OnDiagnostics: () => this.Unsub, ActiveSolution: () => Promise.resolve(null) } as never)
        this.Provider.registerInstance(SolutionOriginRegistry.Key, this.Registry)
        this.Services = new OriginSelectedSolutionServices(this.Provider)
    }
}

const Ref = { Source: TargetSource.Cloud, Name: 'dev1' } as unknown as Parameters<SolutionOriginRegistry['Register']>[1]

describe('OriginSelectedSolutionServices', () =>
{
    test('is Integrated with no active solution and for a file-system solution', () =>
    {
        const f = new SelectionFixture()
        expect(f.Services.Current).toBeInstanceOf(IntegratedSolutionServices)
        f.Active = {} as unknown as Solution
        expect(f.Services.Current).toBeInstanceOf(IntegratedSolutionServices)
        expect(f.Services.Language).toBe(f.Provider.getRequired(SolutionLanguageService.Key))
    })

    test('is Remote for a solution registered as dev-environment, cached per solution', () =>
    {
        const f = new SelectionFixture()
        const a = {} as unknown as Solution
        f.Registry.Register(a, Ref, 'sol')
        f.Active = a
        const first = f.Services.Current
        expect(first).toBeInstanceOf(RemoteSolutionServices)
        expect(f.Services.Current).toBe(first)
        const b = {} as unknown as Solution
        f.Active = b
        expect(f.Services.Current).toBeInstanceOf(IntegratedSolutionServices)
        f.Registry.Register(b, Ref, 'sol2')
        expect(f.Services.Current).not.toBe(first)
    })

    test('switching away from a Remote disposes it (tears down its 3 session subscriptions)', () =>
    {
        const f = new SelectionFixture()
        const a = {} as unknown as Solution
        f.Registry.Register(a, Ref, 'sol')
        f.Active = a
        expect(f.Services.Current).toBeInstanceOf(RemoteSolutionServices)
        expect(f.Unsub).not.toHaveBeenCalled()
        f.Active = {} as unknown as Solution
        expect(f.Services.Current).toBeInstanceOf(IntegratedSolutionServices)
        expect(f.Unsub).toHaveBeenCalledTimes(3)
        const b = {} as unknown as Solution
        f.Registry.Register(b, Ref, 'sol2')
        f.Active = b
        expect(f.Services.Current).toBeInstanceOf(RemoteSolutionServices)
        f.Registry.Register(a, Ref, 'sol')
        f.Active = a
        expect(f.Services.Current).toBeInstanceOf(RemoteSolutionServices)
        expect(f.Unsub).toHaveBeenCalledTimes(6)
    })

    test('Unregistering the origin releases the Remote push listeners immediately, with no further Current read', () =>
    {
        const f = new SelectionFixture()
        const a = {} as unknown as Solution
        f.Registry.Register(a, Ref, 'sol')
        f.Active = a
        expect(f.Services.Current).toBeInstanceOf(RemoteSolutionServices)
        expect(f.Unsub).not.toHaveBeenCalled()
        f.Registry.Unregister(a)
        expect(f.Unsub).toHaveBeenCalledTimes(3)
    })

    test('dispose() releases the Remote and stops listening to the registry', () =>
    {
        const f = new SelectionFixture()
        const a = {} as unknown as Solution
        f.Registry.Register(a, Ref, 'sol')
        f.Active = a
        void f.Services.Current
        f.Services.dispose()
        expect(f.Unsub).toHaveBeenCalledTimes(3)
        f.Registry.Unregister(a)
        expect(f.Unsub).toHaveBeenCalledTimes(3)
    })

    test('the in-proc SolutionLanguageService satisfies ILocalBaseResolution (compile-time)', () =>
    {
        const check = (l: SolutionLanguageService): ILocalBaseResolution => l
        expect(typeof check).toBe('function')
    })
})
