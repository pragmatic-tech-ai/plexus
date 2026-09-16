import { BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import {
  FileSystemChannel,
  type FileEntry,
  type FileFilter,
  type ImportedFile,
  type OpenFileOptions,
  type OpenFileResult,
  type OpenFolderOptions,
  type SaveFileOptions,
} from '../shared/file-system-api.js'
import { noteInternalWrite } from './file-watcher-core.js'

// Main-process file-system capability. Owns node:fs and the native open/save
// dialogs, exposed to the renderer as ipcMain handlers keyed by
// FileSystemChannel. The renderer never touches fs directly — the path is
// preload bridge → these handlers → disk. Register once from app.whenReady().

// The window to parent dialogs on — the focused one, falling back to the
// first (there's a single window today, but this stays correct if more open).
function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

// Map our PascalCase FileFilter to Electron's dialog filter shape.
function toDialogFilters(filters?: readonly FileFilter[]): Electron.FileFilter[] | undefined {
  return filters?.map((f) => ({ name: f.Name, extensions: [...f.Extensions] }))
}

export function registerFileSystemHandlers(): void {
  ipcMain.handle(
    FileSystemChannel.OpenFile,
    async (_e, options?: OpenFileOptions): Promise<OpenFileResult | null> => {
      const win = focusedWindow()
      const dialogOptions: OpenDialogOptions = {
        title: options?.Title,
        filters: toDialogFilters(options?.Filters),
        properties: ['openFile'],
      }
      const result = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (result.canceled || result.filePaths.length === 0) return null
      const path = result.filePaths[0]
      const content = await readFile(path, 'utf8')
      return { Path: path, Content: content }
    },
  )

  ipcMain.handle(
    FileSystemChannel.OpenFiles,
    async (_e, options?: OpenFileOptions): Promise<ImportedFile[] | null> => {
      const win = focusedWindow()
      const dialogOptions: OpenDialogOptions = {
        title: options?.Title,
        filters: toDialogFilters(options?.Filters),
        properties: ['openFile', 'multiSelections'],
      }
      const result = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (result.canceled || result.filePaths.length === 0) return null
      return Promise.all(
        result.filePaths.map(async (path) => ({ Path: path, Bytes: await readFile(path) })),
      )
    },
  )

  ipcMain.handle(
    FileSystemChannel.OpenFolder,
    async (_e, options?: OpenFolderOptions): Promise<string | null> => {
      const win = focusedWindow()
      const dialogOptions: OpenDialogOptions = {
        title: options?.Title,
        defaultPath: options?.DefaultPath,
        properties: ['openDirectory', 'createDirectory'],
      }
      const result = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    },
  )

  ipcMain.handle(
    FileSystemChannel.SaveFileAs,
    async (_e, content: string, options?: SaveFileOptions): Promise<string | null> => {
      const win = focusedWindow()
      const dialogOptions: SaveDialogOptions = {
        title: options?.Title,
        defaultPath: options?.DefaultPath,
        filters: toDialogFilters(options?.Filters),
      }
      const result = win
        ? await dialog.showSaveDialog(win, dialogOptions)
        : await dialog.showSaveDialog(dialogOptions)
      if (result.canceled || !result.filePath) return null
      noteInternalWrite(result.filePath)
      await writeFile(result.filePath, content, 'utf8')
      return result.filePath
    },
  )

  ipcMain.handle(
    FileSystemChannel.ReadText,
    (_e, path: string): Promise<string> => readFile(path, 'utf8'),
  )

  ipcMain.handle(
    FileSystemChannel.ReadBytes,
    async (_e, path: string): Promise<Uint8Array> => new Uint8Array(await readFile(path)),
  )

  ipcMain.handle(
    FileSystemChannel.WriteText,
    async (_e, path: string, content: string): Promise<void> => {
      noteInternalWrite(path)
      await writeFile(path, content, 'utf8')
    },
  )

  ipcMain.handle(
    FileSystemChannel.WriteBytes,
    async (_e, path: string, bytes: Uint8Array): Promise<void> => {
      noteInternalWrite(path)
      await writeFile(path, Buffer.from(bytes))
    },
  )

  ipcMain.handle(FileSystemChannel.Exists, async (_e, path: string): Promise<boolean> => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(FileSystemChannel.Delete, async (_e, path: string): Promise<void> => {
    // recursive so deleting a project folder removes its contents too (rm on a
    // non-empty directory throws otherwise); force ignores a missing path.
    noteInternalWrite(path)
    await rm(path, { force: true, recursive: true })
  })

  ipcMain.handle(FileSystemChannel.CreateDirectory, async (_e, path: string): Promise<void> => {
    await mkdir(path, { recursive: true })
  })

  ipcMain.handle(FileSystemChannel.Rename, async (_e, from: string, to: string): Promise<void> => {
    noteInternalWrite(to)
    await rename(from, to)
  })

  ipcMain.handle(
    FileSystemChannel.ListDirectory,
    async (_e, path: string): Promise<FileEntry[]> => {
      try {
        const entries = await readdir(path, { withFileTypes: true })
        return entries.map((d) => ({ Name: d.name, IsDirectory: d.isDirectory() }))
      } catch (err) {
        // A missing directory lists as empty — the convention every caller
        // already assumes (e.g. the layout-preset stores read `.plexus/…` before
        // it's ever created). Swallowing ENOENT here also silences the
        // `ipcMain.handle` error Electron logs on a rejected handler. Any other
        // failure (EACCES, ENOTDIR, …) still propagates to the renderer.
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
      }
    },
  )

  ipcMain.handle(FileSystemChannel.OpenExternal, async (_e, path: string): Promise<void> => {
    // openPath opens a file/folder with the OS default handler; the returned
    // string is a non-empty error message on failure.
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
}
