// Storage — the consolidated storage module. Compose the `Storage` module (registers
// FileSystemService + StorageService as root singletons); resolve StorageService
// (StorageService.Key) as the universal front door and ask it for rooted IStorage —
// CreateStorage(location) for the default local-FS provider, Create(id, location)
// for a named backend. Resolve FileSystemService for raw native IO, or new a
// LocalFileStorage(root, fs) directly for a one-off rooted store. The main-side
// handlers (registerFileSystemHandlers, plexus-core/main) and the preload bridge
// (createFileSystemBridge, plexus-core/preload/file-system) complete the seam.
export { StorageService } from './storage-service.js'
export type { StorageProviderFactory } from './storage-service.js'
export { FileSystemService } from './file-system-service.js'
export { LocalFileStorage } from './local-file-storage.js'
export { Storage } from './storage.module.mu.js'
