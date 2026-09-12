import { describe, it, expect, afterEach } from 'vitest'
import { Border } from '@pragmatic-tech-ai/mural/basic'
import { VisualContext, VisualContextScope } from '@pragmatic-tech-ai/mural/framework'

import { TodlVisualSelector } from '../todl-visual-selector.js'
import { setIconResourceResolver } from '../icon-key-converter.js'

// The selector builds its two templates at construction (via visual-library), which
// compile Icon fragments; keep the icon resolver stubbed so nothing reaches into a
// real asset dictionary, and reset it after each test.
afterEach(() => setIconResourceResolver(undefined))

describe('TodlVisualSelector', () => {
    it('picks the tile template for a Tile-context container and the figure template otherwise', () => {
        setIconResourceResolver(() => ({ ViewBoxWidth: 24, ViewBoxHeight: 24, Shapes: [] }))
        const selector = new TodlVisualSelector()

        const tileHost = new Border()
        VisualContextScope.SetContext(tileHost, VisualContext.Tile)
        const tile = selector.SelectTemplate({ IconKey: 'x' }, tileHost)

        // A Figure-context host (VisualContextScope defaults to Figure) picks the other.
        const figureHost = new Border()
        VisualContextScope.SetContext(figureHost, VisualContext.Figure)
        const figure = selector.SelectTemplate({ IconKey: 'x' }, figureHost)

        expect(tile).toBeDefined()
        expect(figure).toBeDefined()
        expect(tile).not.toBe(figure)   // two distinct template instances (tile vs figure)
    })

    it('defaults to the figure template when the container carries no explicit context', () => {
        setIconResourceResolver(() => ({ ViewBoxWidth: 24, ViewBoxHeight: 24, Shapes: [] }))
        const selector = new TodlVisualSelector()

        const tileHost = new Border()
        VisualContextScope.SetContext(tileHost, VisualContext.Tile)
        const tile = selector.SelectTemplate({ IconKey: 'x' }, tileHost)

        // No SetContext → GetContext returns the default (Figure), so the figure
        // template is chosen — the same instance a Figure-context host gets.
        const plainHost = new Border()
        const figure = selector.SelectTemplate({ IconKey: 'x' }, plainHost)

        expect(figure).not.toBe(tile)
    })
})
