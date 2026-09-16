import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerFileSystemHandlers } from './filesystem.js'
import { registerFileWatchHandlers } from './file-watcher.js'
import { registerEnvironmentHandlers } from './environment.js'
import { registerSettingsHandlers } from './settings.js'
import { registerAgentHandlers } from './agent.js'
import { registerTodlServerHandlers } from './todl/register.js'
import { registerWindowHandlers } from './window.js'
import { initAutoUpdate } from './updater.js'
import { TITLE_BAR_HEIGHT } from '../shared/window-api.js'

// Initial WCO colours (Windows/Linux). The app boots on MaterialDark, so seed
// the native caption strip to that scheme's title-bar surface + glyph ink; the
// renderer's theme hook re-tints on the first paint and every scheme swap.
const INITIAL_OVERLAY = { color: '#1c1b1f', symbolColor: '#cac4d0' }

// Dev only: disable the renderer's HTTP cache. mural is served LIVE by Vite as
// a pre-bundle-excluded dep (see electron.vite.config.ts), but Chromium caches
// those dep modules by their immutable `?v=<hash>` URL — and that hash is tied
// to the OTHER optimized deps, so it stays constant across restarts. The net
// effect is a rebuilt framework dist getting silently masked by stale cached
// modules. Turning the HTTP cache off makes every reload re-fetch the live dist.
// Must run before app 'ready' — hence module top-level, not inside whenReady.
if (is.dev) app.commandLine.appendSwitch('disable-http-cache')

// Main process — owns the window and (later) the native capabilities Plexus
// reaches for as a desktop app: file open/save for diagram documents, the
// app menu, recent files. Those land as typed IPC handlers here and are
// consumed in the renderer through an INJECTED mural service (the same seam
// the demo's DiagramStorageKey uses), so no view / view-model code ever
// imports electron directly.
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    // Near-black base so the very first frame (and any reload/resize gap before
    // the renderer paints) is never bare white. Matches the SolariaMark boot
    // splash / #app background; the mural shell paints @Surface over it.
    backgroundColor: '#0A0A0B',
    // Window / taskbar icon. Packaged builds take the icon from the exe
    // (electron-builder → build/icon.ico) and build/ isn't shipped at runtime,
    // so only set it in dev — pointing at the same SolariaMark PNG the installer
    // uses so the running window matches while iterating.
    ...(is.dev ? { icon: join(__dirname, '../../build/icon.png') } : {}),
    autoHideMenuBar: true,
    // Custom title bar (VSCode-style): hide the OS title bar, but keep the
    // native min/max/close buttons as a Window Controls Overlay on Windows/Linux
    // (macOS ignores the overlay and floats its traffic lights top-left). The
    // renderer draws its own draggable title strip of TITLE_BAR_HEIGHT under it.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? {}
      : { titleBarOverlay: { ...INITIAL_OVERLAY, height: TITLE_BAR_HEIGHT } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // Flush open conversations to disk before the window closes. The first close is
  // deferred: we ask the renderer to persist everything (its FlushAll writes back
  // through the file-system IPC while the event loop is still running), then close
  // for real. Guarded by a flag (so the re-issued close proceeds) and a timeout (so
  // a hung/absent renderer never blocks quit).
  let flushed = false
  mainWindow.on('close', (event) => {
    if (flushed || mainWindow.webContents.isDestroyed()) return
    event.preventDefault()
    // First ask the renderer to resolve unsaved documents (Save All / Discard All /
    // Cancel). This is interactive, so it gets NO timeout — the user is at the
    // keyboard. `flushed` is only set once we've committed to closing, so a Cancel
    // (ok === false) leaves the window open and a later close re-runs the flow. A
    // thrown/rejected confirm biases to NOT closing (safer than losing work).
    const proceed = (): void => { flushed = true; if (!mainWindow.isDestroyed()) mainWindow.close() }
    const confirm = mainWindow.webContents
      .executeJavaScript('window.__confirmCloseDocs ? window.__confirmCloseDocs() : true')
      .catch(() => false)
    void confirm.then((ok) => {
      if (ok === false) return
      // Then flush open conversations to disk, bounded so a hung/absent renderer
      // never blocks quit, and close for real.
      const flush = mainWindow.webContents
        .executeJavaScript('window.__flushChats ? window.__flushChats() : null')
        .catch(() => undefined)
      const timeout = new Promise((resolve) => setTimeout(resolve, 2000))
      void Promise.race([flush, timeout]).then(proceed, proceed)
    })
  })

  // Open target=_blank / external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite serves the renderer over HTTP in dev (HMR) and emits a
  // static index.html for the packaged build.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.pragmatic-tech-ai.plexus')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // Native file-system capability (open/save dialogs, read/write, listing),
  // consumed in the renderer through the injected FileSystemService.
  registerFileSystemHandlers()
  registerFileWatchHandlers()
  // Static host environment snapshot (dirs, platform, versions, flags),
  // consumed in the renderer through the injected EnvironmentService.
  registerEnvironmentHandlers()
  // Settings persistence (userData/settings.json), backing the framework's
  // ApplicationSettings via the renderer's ElectronSettingsStore.
  registerSettingsHandlers()
  // Agent runtime — owns the claude CLI child + session + the in-process
  // ask-user-question MCP tool, exposed to the renderer as command handlers plus a
  // pushed event stream (AgentChannel.Event). Awaited so the tool server is
  // listening before the first turn.
  await registerAgentHandlers()
  // TODL language server: fork the vendored stdio server and relay LSP JSON-RPC
  // to the renderer. Registered before the window so the ToServer channel is
  // listening when the renderer builds its connection on load.
  registerTodlServerHandlers()
  // Window chrome: re-tint the native caption buttons (WCO) when the renderer's
  // theme changes.
  registerWindowHandlers()

  createWindow()
  initAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
