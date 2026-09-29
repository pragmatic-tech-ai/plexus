import { test, expect, afterEach } from 'vitest'
import { Application, Color } from '@pragmatic-tech-ai/mural/runtime'
import { SolidColorBrush } from '@pragmatic-tech-ai/mural/visual-engine'

import { DiagramCanvasService } from '../diagram-canvas-service.js'

// PageBackgroundColor() drives BOTH the grid pattern's paper and the colour its
// grid lines are derived from. It must read the theme's @CanvasBg token — the
// Pragmatic name for the diagram paper (framework PART_CanvasBg fills the same
// token). The retired Material theme called it @DiagramCanvas; reading that stale
// name resolved nothing, so the grid painted on the hardcoded fallback instead of
// the themed paper — the washed-out white canvas this guards against.

// The token the service must read, and the light-paper fallback it uses before a
// theme is registered (kept in sync with the constants in the service).
const CanvasBgToken = 'CanvasBg'
const RetiredToken = 'DiagramCanvas'
const FallbackHex = '#F4F4F1'
const ThemePaperHex = '#1E1E22'

let priorApp: Application | null = null

function withApp(register: (app: Application) => void): void
{
    priorApp = Application.current
    const app = new Application()
    Application.current = app
    register(app)
}

afterEach(() => { Application.current = priorApp })

test('PageBackgroundColor reads the theme @CanvasBg token', () =>
{
    withApp((app) => app.Resources.Set(CanvasBgToken, new SolidColorBrush(Color.FromHex(ThemePaperHex))))

    expect(DiagramCanvasService.PageBackgroundColor().ToHex()).toBe(Color.FromHex(ThemePaperHex).ToHex())
})

test('PageBackgroundColor ignores the retired @DiagramCanvas token (theme-migration regression)', () =>
{
    // Only the OLD Material name is registered — the service must NOT pick it up,
    // falling back to the light paper rather than the stale token's colour.
    withApp((app) => app.Resources.Set(RetiredToken, new SolidColorBrush(Color.FromHex(ThemePaperHex))))

    expect(DiagramCanvasService.PageBackgroundColor().ToHex()).toBe(Color.FromHex(FallbackHex).ToHex())
})

test('PageBackgroundColor falls back to the light paper before a theme is registered', () =>
{
    withApp(() => { /* no theme resources */ })

    expect(DiagramCanvasService.PageBackgroundColor().ToHex()).toBe(Color.FromHex(FallbackHex).ToHex())
})
