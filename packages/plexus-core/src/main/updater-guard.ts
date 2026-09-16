// Auto-update is wired for the Linux AppImage only (Windows ships MSI, which has
// no electron-updater feed; macOS is out of scope for v1). electron-builder sets
// the APPIMAGE env var when the app runs from an AppImage bundle, so this is how
// we detect an updatable run. Kept as a pure predicate (no electron import) so it
// is unit-testable off the main process.
export function shouldAutoUpdate(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): boolean {
  return platform === 'linux' && Boolean(env.APPIMAGE)
}
