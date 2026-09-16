// Window-chrome bridge — the custom title bar's native side.
//
// Plexus runs with a hidden OS title bar (titleBarStyle: 'hidden') and, on
// Windows/Linux, the native min/max/close buttons drawn as a Window Controls
// Overlay (WCO). The overlay's colours are set at window creation, but the app
// theme can change at runtime (scheme swap), so the renderer pushes fresh
// colours through this bridge and the main process re-tints the overlay via
// BrowserWindow.setTitleBarOverlay.
//   • main     — registerWindowHandlers() applies the colours (main/window.ts)
//   • preload  — exposes setOverlay on window.api.titlebar
//   • renderer — the theme hook in the bootstrap calls it on every scheme change

// The custom title-bar band height (dp). Shared so the renderer band and the
// native overlay agree on one height.
export const TITLE_BAR_HEIGHT = 32

export enum WindowChannel
{
    SetOverlay = 'window:set-overlay',
}

// A WCO colour pair. `color` fills the caption-button strip background (match the
// app's title-bar surface); `symbolColor` inks the glyphs. Both CSS hex strings.
export interface OverlayColors
{
    color:       string
    symbolColor: string
}

// Exposed on window.api.titlebar. `setOverlay` is fire-and-forget (the main
// process no-ops when the platform draws no overlay, e.g. macOS traffic lights).
export interface IWindowApi
{
    setOverlay(colors: OverlayColors): void
}
