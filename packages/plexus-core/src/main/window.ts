import { app, BrowserWindow, ipcMain } from 'electron'
import { TITLE_BAR_HEIGHT, WindowChannel, type OverlayColors } from '../shared/window-api.js'

// Main-process window-chrome handler. The renderer pushes WCO colours here on
// every theme/scheme change; we re-tint the sender's window's native caption
// buttons. Only Windows/Linux draw an overlay — on macOS setTitleBarOverlay
// throws (traffic lights aren't customised this way), so guard the call.
// Register once from app.whenReady().
export function registerWindowHandlers(): void
{
  ipcMain.on(WindowChannel.SetOverlay, (event, colors: OverlayColors) => {
    if (process.platform === 'darwin') return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win === null) return
    win.setTitleBarOverlay({
      color:       colors.color,
      symbolColor: colors.symbolColor,
      height:      TITLE_BAR_HEIGHT,
    })
  })
  // app.quit() (NOT a hard window destroy) — this re-enters each window's
  // existing 'close' handler (apps/plexus main/index.ts), which runs
  // confirmCloseDocs before actually closing, so unsaved-work prompts still
  // guard a menu-driven Quit the same way the OS close button does.
  ipcMain.on(WindowChannel.Quit, () => {
    app.quit()
  })
}
