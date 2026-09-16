import { describe, it, expect } from 'vitest'
import { Border, DataTemplate } from '@pragmatic-tech-ai/mural/basic'
import { VisualContext, VisualContextScope } from '@pragmatic-tech-ai/mural/framework'

import { TodlVisualSelector } from '../todl-visual-selector.js'

// The selector no longer builds templates — it is handed the two context templates
// (compiled in diagram.resources.mu, injected by the register site). These sentinels
// stand in for them so the test isolates the context-pick logic.
const tileTemplate = new DataTemplate(() => new Border())
const figureTemplate = new DataTemplate(() => new Border())

describe('TodlVisualSelector', () => {
    it('picks the tile template for a Tile-context container and the figure template otherwise', () => {
        const selector = new TodlVisualSelector(tileTemplate, figureTemplate)

        const tileHost = new Border()
        VisualContextScope.SetContext(tileHost, VisualContext.Tile)
        expect(selector.SelectTemplate({ IconKey: 'x' }, tileHost)).toBe(tileTemplate)

        const figureHost = new Border()
        VisualContextScope.SetContext(figureHost, VisualContext.Figure)
        expect(selector.SelectTemplate({ IconKey: 'x' }, figureHost)).toBe(figureTemplate)
    })

    it('defaults to the figure template when the container carries no explicit context', () => {
        const selector = new TodlVisualSelector(tileTemplate, figureTemplate)

        // No SetContext → GetContext returns the default (Figure) → figure template.
        const plainHost = new Border()
        expect(selector.SelectTemplate({ IconKey: 'x' }, plainHost)).toBe(figureTemplate)
    })
})
