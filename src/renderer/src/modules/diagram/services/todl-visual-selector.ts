import { DataTemplateSelector, type DataTemplate } from '@pragmatic-tech-ai/mural/basic'
import { VisualContext, VisualContextScope } from '@pragmatic-tech-ai/mural/framework'
import type { Visual } from '@pragmatic-tech-ai/mural/runtime'
import { buildCtx, buildDefaultTemplate, buildFigureTemplate } from '../../library/services/visual-library.js'

// Picks the icon DataTemplate for a bound EntityIconVM by the container's
// VisualContext (an inheritable attached property, default Figure): the Tile
// context draws a @SurfaceContainerHigh chip behind the icon (toolbox tiles +
// library preview) and is non-hit-testable drag chrome; the Figure context draws
// the icon transparently (canvas nodes). This replaces the bespoke
// TodlVisualResolver's per-context branch — the selector only PICKS the template;
// the bound item's EntityIconVM owns the data ($Icon.IconKey). Registered as a
// resource keyed `TodlVisualSelector` so `@TodlVisualSelector` resolves in the
// diagram / library markup (the P3 ContentControl.ContentTemplateSelector binding).
export class TodlVisualSelector extends DataTemplateSelector
{
    private readonly tileTemplate: DataTemplate
    private readonly figureTemplate: DataTemplate

    constructor()
    {
        super()
        const ctx = buildCtx()
        this.tileTemplate = buildDefaultTemplate(ctx)
        this.figureTemplate = buildFigureTemplate(ctx)
    }

    public SelectTemplate(_item: unknown, container: Visual): DataTemplate
    {
        return VisualContextScope.GetContext(container) === VisualContext.Tile
            ? this.tileTemplate
            : this.figureTemplate
    }
}
