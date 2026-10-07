import { Application, type ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { DataTemplate } from '@pragmatic-tech-ai/mural/basic'
import { ArchInstanceDropFactory, ArchInstanceDropFactoryKey } from '../../architecture-projects/services/arch-instance-drop-factory.js'
import { ArchModelInstanceDropFactory, ArchModelInstanceDropFactoryKey } from '../../architecture-projects/services/arch-model-instance-drop-factory.js'
import { ArchScenarioDropFactory, ArchScenarioDropFactoryKey } from '../../architecture-projects/services/arch-scenario-drop-factory.js'
import { TodlVisualSelector } from './todl-visual-selector.js'

// Idempotently register the Plexus toolbox DROP FACTORIES + the tile-chip template
// selector into the service provider. Safe to call on every reload — existing
// registrations are left as-is. The presentation SOURCES + their refresh lifecycle
// are owned by TodlPresentationRegistry (registered as an app service; see its
// EnsureStarted/Refresh), NOT here — this function is a pure toolbox-adapter concern.
export function registerArchToolboxAdapters(services: ServiceProvider): void
{
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
