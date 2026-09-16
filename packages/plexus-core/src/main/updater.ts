// Auto-update wiring, shared by every mural desktop app in the workspace.
//
// Guarded to the Linux AppImage only: Windows ships an MSI (manual updates, no
// electron-updater feed) and macOS is out of scope for v1. electron-builder sets
// the APPIMAGE env var when the app runs from an AppImage bundle, which is how we
// detect an updatable run. `shouldAutoUpdate` is a pure predicate (no electron
// import) so it stays unit-testable off the main process; `init` lazy-imports
// electron-updater so that native dep loads only in the one environment that
// auto-updates. A failed check (offline, no release yet) is swallowed -- it must
// never block startup.
export class Updater {
    static shouldAutoUpdate(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
        return platform === 'linux' && Boolean(env.APPIMAGE)
    }

    // Called once after the first window is ready.
    static init(): void {
        if (!Updater.shouldAutoUpdate(process.platform, process.env)) return
        void import('electron-updater')
            .then(({ autoUpdater }) => autoUpdater.checkForUpdatesAndNotify())
            .catch(() => { /* offline / no release / dep absent */ })
    }
}
