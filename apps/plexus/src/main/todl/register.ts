import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { TodlServerHost, type ChildLike } from './todl-server-host.js'
import { TodlLspChannel } from '../../shared/todl-lsp-api.js'

// Production wiring for the relay. NOTE: Electron's utilityProcess cannot carry
// an stdio LSP server — it ignores the child's stdin (its comms are MessagePort
// based) — so the vendored stdio bundle is spawned as a Node child through
// Electron's own binary (ELECTRON_RUN_AS_NODE=1) with stdin/stdout piped. This
// is the same long-lived-stdio-child pattern the Claude CLI provider uses;
// stderr inherits to the main-process log. Events are pushed to whichever window
// is focused (single window today).
export function registerTodlServerHandlers(): void {
  const emit = (channel: string, msg?: unknown): void => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(channel, msg)
  }
  const spawnChild = (): ChildLike => {
    const bundle = join(__dirname, 'todl-language-server.cjs')
    const child = spawn(process.execPath, [bundle], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    return child as unknown as ChildLike
  }
  const host = new TodlServerHost(spawnChild, emit)
  host.start()
  ipcMain.on(TodlLspChannel.ToServer, (_e, msg: unknown) => host.send(msg))
}
