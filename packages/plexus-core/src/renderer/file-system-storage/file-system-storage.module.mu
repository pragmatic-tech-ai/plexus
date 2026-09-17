// FileSystemStorage — the shared IO module. Its `.services:` registers the
// FileSystemService (the renderer wrapper over the native `window.api.fs` bridge)
// as a root singleton, so an app gets file IO by adding one line to its
// `.modules:` block instead of registering the service itself. Pair it with
// LocalFileStorage (this module's barrel) for a rooted IStorage over the service —
// each app's StorageProviderRegistry news one per location.
//
// The two host-specific halves live outside mural: the app's main process calls
// registerFileSystemHandlers() (plexus-core/main) and its preload exposes
// window.api.fs via createFileSystemBridge (plexus-core/preload/file-system).
import FileSystemService from "./file-system-service.js"

module FileSystemStorage {
    .services: {
        FileSystemService
    }
}
