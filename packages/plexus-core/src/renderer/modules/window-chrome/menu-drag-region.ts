// MenuDragRegion — keeps the HTML OS-drag "hole" synced to the mural-painted
// menu bar's actual width.
//
// The window runs with a hidden OS title bar; mural paints the title strip into
// the SVG under #app, and a transparent `-webkit-app-region: drag` strip in
// index.html (#drag-strip) sits over the header so the OS can move the window.
// A drag region swallows clicks, so the strip must START past the menu bar —
// otherwise File/Edit/View/Help render under it and their clicks never reach
// mural. Hardcoding that offset is brittle: it drifts the moment a menu is added
// or the label metrics change.
//
// This measures the rendered menu region (the @PragmaticTitleBar template's
// PART_WindowMenuHost ContentControl, found in the mural visual tree) and sets
// `#drag-strip.style.left` to its right edge + a small pad, re-measuring on
// resize and theme change. The title bar carries no transform/scaling, so the
// sum of ArrangedRect.X up the visual parent chain is the region's left edge in
// CSS px (the SVG surface maps 1:1 to CSS px and #app is inset:0). A static
// fallback is applied if the region can't be measured (e.g. not yet laid out).
import { Application, ThemeManager } from '@pragmatic-tech-ai/mural/runtime'
import type { Visual } from '@pragmatic-tech-ai/mural/visual-engine'

export class MenuDragRegion
{
    private static readonly DragStripElementId = 'drag-strip'
    private static readonly MenuHostName = 'PART_WindowMenuHost'
    // Pad past the menu's right edge so the hole clears the last menu button's
    // hit area without eating into the title-drag span.
    private static readonly HolePadPx = 8
    // Applied when the live measure is unavailable — wide enough to clear all
    // four menus (File/Edit/View/Help) at the default label metrics.
    private static readonly FallbackLeftPx = 260
    // The menu buttons instantiate lazily when the theme applies; retry across a
    // few frames until the region has a non-zero arranged width.
    private static readonly MaxMeasureAttempts = 20

    private readonly app: Application
    private readonly strip: HTMLElement | undefined

    public constructor(app: Application)
    {
        this.app = app
        const el = document.getElementById(MenuDragRegion.DragStripElementId)
        this.strip = el === null ? undefined : el
    }

    // Wire the measure to the app and start keeping the hole in sync.
    public static Attach(app: Application): MenuDragRegion
    {
        const region = new MenuDragRegion(app)
        region.Start()
        return region
    }

    public Start(): void
    {
        if (this.strip === undefined) return
        this.SyncWithRetry(MenuDragRegion.MaxMeasureAttempts)
        window.addEventListener('resize', () => this.Sync())
        ThemeManager.AddActivatedListener(() => this.Sync())
    }

    // One-shot measure: apply the live edge, or the static fallback if unmeasurable.
    public Sync(): void
    {
        if (this.strip === undefined) return
        this.ApplyLeft(this.MeasureMenuRight() ?? MenuDragRegion.FallbackLeftPx)
    }

    // Measure on the next frames until the menu region reports a width, then
    // apply; fall back after the attempt budget is spent.
    private SyncWithRetry(attemptsLeft: number): void
    {
        const right = this.MeasureMenuRight()
        if (right !== undefined)
        {
            this.ApplyLeft(right)
            return
        }
        if (attemptsLeft <= 0)
        {
            this.ApplyLeft(MenuDragRegion.FallbackLeftPx)
            return
        }
        requestAnimationFrame(() => this.SyncWithRetry(attemptsLeft - 1))
    }

    private ApplyLeft(leftPx: number): void
    {
        if (this.strip === undefined) return
        this.strip.style.left = `${Math.round(leftPx)}px`
    }

    // The menu region's right edge in CSS px, or undefined if it isn't laid out
    // yet. Sums ArrangedRect.X up the parent chain (no transforms in the strip)
    // and adds the region's arranged width plus the hole pad.
    private MeasureMenuRight(): number | undefined
    {
        const root = this.app.Resources.Root
        if (root === undefined) return undefined
        const menu = MenuDragRegion.FindByName(root, MenuDragRegion.MenuHostName)
        if (menu === undefined) return undefined
        const width = menu.ArrangedRect.Width
        if (width <= 0) return undefined
        let left = 0
        let visual: Visual | undefined = menu
        while (visual !== undefined)
        {
            left += visual.ArrangedRect.X
            visual = visual.GetVisualParent()
        }
        return left + width + MenuDragRegion.HolePadPx
    }

    // Depth-first search for the visual whose x:name matches, across template
    // name-scope boundaries (raw visual children).
    private static FindByName(visual: Visual, name: string): Visual | undefined
    {
        if (visual.Name === name) return visual
        for (const child of visual.visualChildren)
        {
            const hit = MenuDragRegion.FindByName(child, name)
            if (hit !== undefined) return hit
        }
        return undefined
    }
}
