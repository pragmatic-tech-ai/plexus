import { Application, type ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { DataTemplate } from '@pragmatic-tech-ai/mural/basic'
import { LibraryRegistry } from '../../library/services/library-registry.js'
import { ArchInstanceDropFactory, ArchInstanceDropFactoryKey } from '../../architecture-projects/services/arch-instance-drop-factory.js'
import { ArchModelInstanceDropFactory, ArchModelInstanceDropFactoryKey } from '../../architecture-projects/services/arch-model-instance-drop-factory.js'
import { ArchScenarioDropFactory, ArchScenarioDropFactoryKey } from '../../architecture-projects/services/arch-scenario-drop-factory.js'
import { TodlPresentationRegistry } from './todl-presentation-registry.js'
import { TodlVisualSelector } from './todl-visual-selector.js'
import { LibraryPresentationSource } from '../../library/services/library-presentation-source.js'
import { MetaModelPresentationSource } from '../../meta-model/services/meta-model-presentation-source.js'
import { SolutionGraphPresentationSource } from './solution-graph-presentation-source.js'

// Idempotently register the Plexus toolbox resolver + drop factory into the
// service provider. Safe to call on every reload — existing registrations are
// left as-is; registerSource is idempotent by id so re-registering the same
// sources is harmless.
export function registerArchToolboxAdapters(services: ServiceProvider): void
{
    let registry = services.get(TodlPresentationRegistry.Key)
    if (registry === undefined)
    {
        registry = new TodlPresentationRegistry(services)
        services.registerInstance(TodlPresentationRegistry.Key, registry)
    }
    registry.registerSource(new LibraryPresentationSource(services, () => services.get(LibraryRegistry.Key)?.discover() ?? Promise.resolve([])))
    registry.registerSource(new MetaModelPresentationSource(services))
    // Registered LAST so its live-baked icons take precedence over any stale published copy
    // (the registry merges iconKeys last-wins): when a member is both open and published, the
    // member the user is editing — the solution graph's source member — must win.
    registry.registerSource(new SolutionGraphPresentationSource(services))

    if (!services.has(ArchInstanceDropFactoryKey))
    {
        services.registerInstance(ArchInstanceDropFactoryKey, new ArchInstanceDropFactory(services))
    }
    if (!services.has(ArchModelInstanceDropFactoryKey))
    {
        services.registerInstance(ArchModelInstanceDropFactoryKey, new ArchModelInstanceDropFactory(services))
    }
    if (!services.has(ArchScenarioDropFactoryKey))
    {
        services.registerInstance(ArchScenarioDropFactoryKey, new ArchScenarioDropFactory(services))
    }
    // Register the tile-chip template selector as an app resource keyed
    // `TodlVisualSelector` so `@TodlVisualSelector` resolves in the TILE-context markup
    // (toolbox + library preview tiles). Canvas nodes DON'T use the selector: their icon
    // ContentControl resolves the icon template by implicit DataType dispatch against the
    // compiled `[DataType = EntityIconVM]` figure template — a runtime-registered resource
    // is not reachable from a diagram node's resource scope, but a compiled template (the
    // same path that resolves the node's own DataTemplate) is. The selector only serves the
    // Tile context now, so both of its arms draw the chip tile template.
    const resources = Application.current?.Resources
    if (resources !== undefined && !resources.Has('TodlVisualSelector'))
    {
        const tile = resources.Resolve('TodlIconTileTemplate') as DataTemplate
        resources.Set('TodlVisualSelector', new TodlVisualSelector(tile, tile))
    }
}
