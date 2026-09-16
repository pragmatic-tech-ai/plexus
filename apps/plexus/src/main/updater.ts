import { autoUpdater } from 'electron-updater'
import { shouldAutoUpdate } from './updater-guard'

// Called once after the first window is ready. On non-Linux-AppImage runs this
// is a no-op; on a Linux AppImage it checks the GitHub Release feed and notifies
// the user when an update is downloaded. Errors (offline, no release yet) are
// swallowed — a failed update check must never block startup.
export function initAutoUpdate(): void {
  if (!shouldAutoUpdate(process.platform, process.env)) return
  void autoUpdater.checkForUpdatesAndNotify().catch(() => { /* offline / no release */ })
}
