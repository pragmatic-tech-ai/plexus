// Shared main-process handlers: app-agnostic native capabilities every mural
// desktop app needs. Each app's main entry calls these, then adds its own
// app-specific handlers (agent, language servers, package registry, …).
export { registerFileSystemHandlers } from './filesystem.js'
export { registerFileWatchHandlers } from './file-watcher.js'
export { registerEnvironmentHandlers } from './environment.js'
export { registerSettingsHandlers } from './settings.js'
export { registerWindowHandlers } from './window.js'
export { initAutoUpdate } from './updater.js'
