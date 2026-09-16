import { app, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { sep } from 'node:path'
import { EnvironmentChannel, OperatingSystem, type EnvironmentInfo } from '../shared/environment-api.js'

// Main-process environment snapshot. Owns the host facts (app paths, platform,
// versions) and answers a single synchronous IPC with a frozen EnvironmentInfo.
// The renderer reads it once through the preload bridge → EnvironmentService.
// Register once from app.whenReady() (after which app paths/version resolve).

// app.getPath throws when a well-known dir can't be resolved (rare — e.g.
// 'downloads' on a stripped environment). Fall back to '' rather than crash.
function safePath(name: Parameters<typeof app.getPath>[0]): string {
  try {
    return app.getPath(name)
  } catch {
    return ''
  }
}

function toOperatingSystem(platform: NodeJS.Platform): OperatingSystem {
  switch (platform) {
    case 'win32':
      return OperatingSystem.Windows
    case 'darwin':
      return OperatingSystem.MacOS
    case 'linux':
      return OperatingSystem.Linux
    default:
      return OperatingSystem.Other
  }
}

export function buildEnvironmentInfo(): EnvironmentInfo {
  return {
    CurrentDirectory: process.cwd(),
    HomeDirectory: safePath('home'),
    TempDirectory: safePath('temp'),
    UserDataDirectory: safePath('userData'),
    DocumentsDirectory: safePath('documents'),
    DownloadsDirectory: safePath('downloads'),

    Platform: toOperatingSystem(process.platform),
    Architecture: process.arch,
    PathSeparator: sep,

    AppVersion: app.getVersion(),
    ElectronVersion: process.versions.electron,
    ChromeVersion: process.versions.chrome,
    NodeVersion: process.versions.node,

    IsDevelopment: is.dev,
    IsPackaged: app.isPackaged,
  }
}

export function registerEnvironmentHandlers(): void {
  // Snapshot once — the facts are constant for the process lifetime.
  const snapshot = buildEnvironmentInfo()
  // Synchronous one-shot: the preload reads this at load time via
  // ipcRenderer.sendSync and exposes the result as window.api.environment.
  ipcMain.on(EnvironmentChannel.GetSnapshot, (event) => {
    event.returnValue = snapshot
  })
}
