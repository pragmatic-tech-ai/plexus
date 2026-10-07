// Storage — the shared storage module. Its `.services:` registers two root
// singletons: FileSystemService (the renderer wrapper over the native
// `window.api.fs` bridge) and StorageService (the universal storage front door,
// with the local filesystem as its built-in default provider). An app gets all of
// storage by adding one line to its `.modules:` block; consumers resolve
// StorageService.Key and ask it for rooted IStorage.
//
// The two host-specific halves live outside mural: the app's main process calls
// registerFileSystemHandlers() (plexus-core/main) and its preload exposes
// window.api.fs via createFileSystemBridge (plexus-core/preload/file-system).
import FileSystemService from "./file-system-service.js"
import StorageService from "./storage-service.js"

module Storage {
    .services: {
        FileSystemService
        StorageService
    }
}
