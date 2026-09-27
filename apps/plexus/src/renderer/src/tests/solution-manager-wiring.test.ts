import { describe, test, expect } from 'vitest'
import { HostKind, ShellCompositionRoot } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { TodlProjectSystemModule, SolutionServicesEngine, SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage'
import { SolutionStudioSeams } from '@pragmatic-tech-ai/plexus-core/renderer/modules/solution-studio'

import { RendererPackageSource } from '../services/projects/renderer-package-source.js'

// Mirrors app.mu's SOLUTION-relevant `.modules:` slice (TodlProjectSystemModule +
// SolutionServicesEngine) on a bare shell root, then layers the renderer's OWN
// solution seams exactly as main.js wires them: SolutionStudioSeams.Register
// (prompt service over DialogService, storage-provider registry over StorageService)
// plus the app-specific PackageSourceKey (RendererPackageSource). The 'local'
// storage backend is swapped to a per-folder FakeStorage — the fake storage
// registry a test seeds a project manifest into — so no Electron/FS bridge is
// needed to exercise the real StorageService wiring.
class SolutionWiringFixture
{
    public static readonly Host = new HostKind('plexus-test')
    public static readonly ProjectFolder = '/work/proj'
    public static readonly ManifestFileName = 'project.plexus'
    public static readonly ProjectType = 'architecture'

    public readonly Roots = new Map<string, FakeStorage>()

    public Compose(): ShellCompositionRoot
    {
        const root = new ShellCompositionRoot(SolutionWiringFixture.Host)
        root.AddModule(TodlProjectSystemModule)
        root.AddModule(SolutionServicesEngine)
        const services = root.Provider

        const storages = new StorageService(services)
        storages.Register(StorageService.DefaultBackendId, (location) => this.fakeStorageFor(location))
        services.registerInstance(StorageService.Key, storages)
        services.registerInstance(DialogService.Key, {} as unknown as DialogService)

        SolutionStudioSeams.Register(services)
        services.register(SolutionManagerService.PackageSourceKey, (p) => new RendererPackageSource(p))

        return root
    }

    // One FakeStorage per folder, reused across CreateStorage calls the way a real
    // backend would resolve the same root twice — mirrors todl's own
    // SolutionsTestCompositionRoot-style test doubles.
    private fakeStorageFor(location: string): FakeStorage
    {
        const existing = this.Roots.get(location)
        if (existing !== undefined) return existing
        const storage = new FakeStorage(location)
        this.Roots.set(location, storage)
        return storage
    }

    // Seed a minimal architecture-project manifest at the fake project folder, the
    // way ArchitectureProjectFactory.createProject would have written it.
    public async SeedProject(): Promise<void>
    {
        const storage = this.fakeStorageFor(SolutionWiringFixture.ProjectFolder)
        await storage.WriteText(
            SolutionWiringFixture.ManifestFileName,
            JSON.stringify({ type: SolutionWiringFixture.ProjectType, name: 'proj', version: 1 }),
        )
    }
}

describe('renderer SolutionManagerService wiring', () =>
{
    test('OpenProject opens a loose project as a resolved member of the ambient untitled solution', async () =>
    {
        const fixture = new SolutionWiringFixture()
        await fixture.SeedProject()
        const provider = fixture.Compose().Provider

        const mgr = provider.getRequired(SolutionManagerService.Key)
        const member = await mgr.OpenProject(SolutionWiringFixture.ProjectFolder)

        expect(mgr.ActiveSolution?.HasLocation).toBe(false)
        expect(member.IsResolved).toBe(true)
        expect(mgr.ActiveSolution?.Members.ToArray().length).toBe(1)
    })
})
