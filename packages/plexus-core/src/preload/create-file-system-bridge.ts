import type { IpcRenderer } from 'electron'
import {
    FileSystemChannel,
    type FileEntry,
    type IFileSystemApi,
    type ImportedFile,
    type OpenFileOptions,
    type OpenFileResult,
    type OpenFolderOptions,
    type SaveFileOptions,
} from '../shared/file-system-api.js'

// createFileSystemBridge — the shared preload half of the IO seam. Builds the
// `IFileSystemApi` an app exposes as `window.api.fs` (the renderer's
// FileSystemService reads it). Each method is a thin ipcRenderer.invoke to the
// matching main-process handler (registerFileSystemHandlers, plexus-core/main),
// keyed off the shared FileSystemChannel enum so main + preload never drift.
// Both apps call this from their preload instead of hand-rolling the bridge.
export function createFileSystemBridge(ipcRenderer: IpcRenderer): IFileSystemApi
{
    return {
        openFile: (options?: OpenFileOptions): Promise<OpenFileResult | null> =>
            ipcRenderer.invoke(FileSystemChannel.OpenFile, options),
        openFiles: (options?: OpenFileOptions): Promise<ImportedFile[] | null> =>
            ipcRenderer.invoke(FileSystemChannel.OpenFiles, options),
        openFolder: (options?: OpenFolderOptions): Promise<string | null> =>
            ipcRenderer.invoke(FileSystemChannel.OpenFolder, options),
        saveFileAs: (content: string, options?: SaveFileOptions): Promise<string | null> =>
            ipcRenderer.invoke(FileSystemChannel.SaveFileAs, content, options),
        readText: (path: string): Promise<string> =>
            ipcRenderer.invoke(FileSystemChannel.ReadText, path),
        readBytes: (path: string): Promise<Uint8Array> =>
            ipcRenderer.invoke(FileSystemChannel.ReadBytes, path),
        writeText: (path: string, content: string): Promise<void> =>
            ipcRenderer.invoke(FileSystemChannel.WriteText, path, content),
        writeBytes: (path: string, bytes: Uint8Array): Promise<void> =>
            ipcRenderer.invoke(FileSystemChannel.WriteBytes, path, bytes),
        exists: (path: string): Promise<boolean> =>
            ipcRenderer.invoke(FileSystemChannel.Exists, path),
        delete: (path: string): Promise<void> =>
            ipcRenderer.invoke(FileSystemChannel.Delete, path),
        createDirectory: (path: string): Promise<void> =>
            ipcRenderer.invoke(FileSystemChannel.CreateDirectory, path),
        rename: (from: string, to: string): Promise<void> =>
            ipcRenderer.invoke(FileSystemChannel.Rename, from, to),
        listDirectory: (path: string): Promise<readonly FileEntry[]> =>
            ipcRenderer.invoke(FileSystemChannel.ListDirectory, path),
        openExternal: (path: string): Promise<void> =>
            ipcRenderer.invoke(FileSystemChannel.OpenExternal, path),
    }
}
