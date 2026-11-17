import { describe, test, expect } from 'vitest'
import { HostKind, ShellCompositionRoot } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { TodlProjectSystemModule, SolutionServicesEngine, SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import {
    SolutionSeams,
    SolutionServices,
    IntegratedSolutionServices,
} from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-seams'

// Mirrors solution-manager-wiring's composition, then registers the facade the way
// app.mu's `.services:` does (a class filed under its static Key).
class FacadeWiringFixture
{
    public static readonly Host = new HostKind('plexus-facade-test')

    public Compose(): ShellCompositionRoot
    {
        const root = new ShellCompositionRoot(FacadeWiringFixture.Host)
        root.AddModule(TodlProjectSystemModule)
        root.AddModule(SolutionServicesEngine)
        const services = root.Provider
        const storages = new StorageService(services)
        storages.Register(StorageService.DefaultBackendId, (location) => new FakeStorage(location))
        services.registerInstance(StorageService.Key, storages)
        services.registerInstance(DialogService.Key, {} as unknown as DialogService)
        SolutionSeams.Register(services)
        services.register(SolutionManagerService.PackageSourceKey, (p) => new RendererPackageSource(p))
        services.register(IntegratedSolutionServices.Key, (p) => new IntegratedSolutionServices(p))
        return root
    }
}

import { RendererPackageSource } from '../services/projects/renderer-package-source.js'

describe('ISolutionServices facade wiring', () =>
{
    test('resolves the same singletons as the legacy keys, from root and child scope', () =>
    {
        const provider = new FacadeWiringFixture().Compose().Provider
        const facade = provider.getRequired(SolutionServices.Key)
        expect(facade.Manager).toBe(provider.getRequired(SolutionManagerService.Key))
        expect(facade.Storage).toBe(provider.getRequired(StorageService.Key))

        const scoped = provider.createScope().getRequired(SolutionServices.Key)
        expect(scoped).toBe(facade)
        expect(scoped.Manager).toBe(facade.Manager)
    })
})
