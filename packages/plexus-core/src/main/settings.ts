import { app, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SettingsChannel } from '../shared/settings-api.js'

// Main-process settings persistence. Owns settings.json under the app's
// userData dir; answers a synchronous snapshot read at startup and async
// write-throughs. The renderer's ElectronSettingsStore is the only client,
// itself the ISettingsStore the framework's ApplicationSettings resolves.
// Register once from app.whenReady() (after which userData resolves).

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

// Read the persisted values. Missing or corrupt file → empty (first run, or a
// hand-edit gone wrong) rather than a crash; ApplicationSettings then falls back
// to each definition's default.
function loadSnapshot(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function registerSettingsHandlers(): void {
  // Synchronous one-shot: the preload reads this at load time via
  // ipcRenderer.sendSync and hands it to ElectronSettingsStore.Load().
  ipcMain.on(SettingsChannel.GetSnapshot, (event) => {
    event.returnValue = loadSnapshot()
  })
  // Async write-through of the full value set.
  ipcMain.handle(SettingsChannel.Save, async (_e, values: Record<string, unknown>): Promise<void> => {
    await writeFile(settingsPath(), JSON.stringify(values, null, 2), 'utf8')
  })
}
