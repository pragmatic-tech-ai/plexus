// Native caption-button (Window Controls Overlay) tinting for the custom frame.
//
// The window runs with a hidden OS title bar (titleBarStyle: 'hidden') and mural
// now PAINTS the title strip itself (EditorShell's Header region → the
// @PlexusTitleBar view; the title text comes from TitleService). Two things stay
// outside mural because they're OS/DOM concerns:
//   • window dragging  — a transparent #drag-strip in index.html (CSS app-region).
//   • the min/max/close buttons — drawn by the OS via the Window Controls Overlay.
//
// This module only keeps the WCO buttons in sync with the theme: on every scheme
// change it re-tints them to the header's surface (@SurfaceContainer) / ink
// (@OnSurfaceVariant) so the caption strip and the mural header read as one
// surface. It also tags <body> on macOS (traffic-light insets in index.html).
import { Application, ThemeManager } from '@pragmatic-tech-ai/mural/runtime'
import { SolidColorBrush } from '@pragmatic-tech-ai/mural/visual-engine'

// The header strip paints the shared @Surface chrome tone, inked
// @OnSurfaceVariant — the WCO caption buttons match those so the caption strip
// and the mural header (and the rest of the flat frame) read as one surface.
const BG_TOKEN     = 'Surface'
const SYMBOL_TOKEN = 'OnSurfaceVariant'

// The preload bridge (window.api.titlebar) — untyped here (main.js-style access);
// absent when running outside Electron (e.g. a plain browser preview).
interface TitleBarBridge { setOverlay(colors: { color: string; symbolColor: string }): void }
function bridge(): TitleBarBridge | undefined {
    return (globalThis as unknown as { api?: { titlebar?: TitleBarBridge } }).api?.titlebar
}

// Resolve a colour token to an opaque #rrggbb hex from the active scheme.
function tokenHex(token: string, fallback: string): string {
    const res = Application.current?.Resources.Resolve(token)
    return res instanceof SolidColorBrush ? res.Color.ToHex().slice(0, 7) : fallback
}

export function attachTitleBar(_app: Application): void {
    const platform = (globalThis as unknown as { api?: { environment?: { Platform?: string } } }).api?.environment?.Platform
    if (platform === 'darwin') document.body.classList.add('is-mac')

    const pushOverlay = (): void => {
        const color       = tokenHex(BG_TOKEN, '#1c1b1f')
        const symbolColor = tokenHex(SYMBOL_TOKEN, '#cac4d0')
        bridge()?.setOverlay({ color, symbolColor })
    }
    ThemeManager.AddActivatedListener(pushOverlay)
    pushOverlay()
}
