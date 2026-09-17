// FileSystemStorage — the shared IO seam. Compose the `FileSystemStorage` module
// (registers FileSystemService); resolve FileSystemService for raw native IO;
// new a LocalFileStorage(root, fs) for a rooted IStorage backend. The main-side
// handlers (registerFileSystemHandlers, plexus-core/main) and the preload bridge
// (createFileSystemBridge, plexus-core/preload/file-system) complete the seam.
export { FileSystemService } from './file-system-service.js'
export { LocalFileStorage } from './local-file-storage.js'
export { FileSystemStorage } from './file-system-storage.module.mu.js'
