import { describe, test, expect } from 'vitest'
import { HostKind, ShellCompositionRoot } from '@pragmatic-tech-ai/mural/runtime'
import {
    TodlProjectSystemModule,
    SolutionServicesEngine,
    ProjectFactoryRegistry,
    ProjectFactoryRegistryKey,
    MetaModelProjectFactory,
    LibraryProjectFactory,
    ArchitectureProjectFactory,
} from '@pragmatic-tech-ai/todl'

// app.mu's `.modules:` head, reproduced on a bare shell root: TodlProjectSystemModule
// (listed by CLASS name — the compiler lowers it to `AddModule(TodlProjectSystemModule)`
// with no `new`) followed by SolutionServicesEngine. The composed registry is the one
// the ProjectExplorer's New-Project gallery (All) + open routing (factoryFor) resolve.
class AppCompositionFixture
{
    public static readonly Host = new HostKind('plexus-test')
    public static readonly UnknownType = 'todl-package'

    public static Compose(): ShellCompositionRoot
    {
        const root = new ShellCompositionRoot(AppCompositionFixture.Host)
        root.AddModule(TodlProjectSystemModule)
        root.AddModule(SolutionServicesEngine)
        return root
    }
}

describe('app project-system composition', () =>
{
    test('the composed ProjectFactoryRegistryKey indexes exactly the three built-in types', () =>
    {
        const factories = AppCompositionFixture.Compose().Provider.getRequired(ProjectFactoryRegistryKey)

        expect(factories.All().map((f) => f.typeId).sort()).toEqual([
            ArchitectureProjectFactory.ProjectType,
            LibraryProjectFactory.ProjectType,
            MetaModelProjectFactory.ProjectType,
        ].sort())
        expect(factories.factoryFor(MetaModelProjectFactory.ProjectType)).toBeInstanceOf(MetaModelProjectFactory)
        expect(factories.factoryFor(LibraryProjectFactory.ProjectType)).toBeInstanceOf(LibraryProjectFactory)
        expect(factories.factoryFor(ArchitectureProjectFactory.ProjectType)).toBeInstanceOf(ArchitectureProjectFactory)
        expect(factories.factoryFor(AppCompositionFixture.UnknownType)).toBeUndefined()
    })

    test('SolutionServicesEngine no longer shadows the registry: the one under the key is the composer\'s', () =>
    {
        const provider = AppCompositionFixture.Compose().Provider
        const registry = provider.getRequired(ProjectFactoryRegistryKey)

        // Exactly the composer's class — a shadowing registrar (e.g. the retired
        // DefaultProjectFactoryRegistry) was a SUBCLASS, so instanceof cannot tell.
        expect(Object.getPrototypeOf(registry)).toBe(ProjectFactoryRegistry.prototype)
        // And it hands out the very factory instances the composer resolved (and seeded
        // its generators from) under their class tokens.
        expect(registry.factoryFor(MetaModelProjectFactory.ProjectType)).toBe(provider.getRequired(MetaModelProjectFactory))
        expect(registry.factoryFor(LibraryProjectFactory.ProjectType)).toBe(provider.getRequired(LibraryProjectFactory))
        expect(registry.factoryFor(ArchitectureProjectFactory.ProjectType)).toBe(provider.getRequired(ArchitectureProjectFactory))
    })
})
