import { DataTemplateSelector, type DataTemplate } from '@pragmatic-tech-ai/mural/basic'
import { VisualContext, VisualContextScope } from '@pragmatic-tech-ai/mural/framework'
import type { Visual } from '@pragmatic-tech-ai/mural/runtime'

// Picks the icon DataTemplate for a bound EntityIconVM by the container's
// VisualContext (an inheritable attached property, default Figure): the Tile
// context draws a @SurfaceContainerHigh chip behind the icon (toolbox tiles +
// library preview) and is non-hit-testable drag chrome; the Figure context draws
// the icon transparently (canvas nodes). This replaces the bespoke
// TodlVisualResolver's per-context branch — the selector only PICKS the template;
// the bound item's EntityIconVM owns the data ($Icon.IconKey). Registered as a
// resource keyed `TodlVisualSelector` so `@TodlVisualSelector` resolves in the
// diagram / library markup (the P3 ContentControl.ContentTemplateSelector binding).
//
// The two templates are compiled at build time as @TodlIconTileTemplate /
// @TodlIconFigureTemplate (diagram.resources.mu) and injected here by the single
// register site (registerArchToolboxAdapters), which resolves them from the merged
// app resources. (Previously the selector built them at runtime from markup strings
// via visual-library.ts + instantiate(); that module is gone.)
export class TodlVisualSelector extends DataTemplateSelector
{
    constructor(
        private readonly tileTemplate: DataTemplate,
        private readonly figureTemplate: DataTemplate,
    )
    {
        super()
    }

    public SelectTemplate(_item: unknown, container: Visual): DataTemplate
    {
        return VisualContextScope.GetContext(container) === VisualContext.Tile
            ? this.tileTemplate
            : this.figureTemplate
    }
}
