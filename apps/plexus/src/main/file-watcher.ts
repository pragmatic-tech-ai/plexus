// Electron wiring for the file watcher: renderer asks main to Watch/Unwatch a
// project root (ipcMain.handle); main pushes Changed events to the renderer
// (webContents.send), reusing the agent/LSP push pattern.
import { BrowserWindow, ipcMain } from 'electron'
import { FileWatchChannel, type FileChangeEvent } from '../shared/file-watch-api.js'
import { startWatch, stopWatch } from './file-watcher-core.js'

function emitChange(event: FileChangeEvent): void
{
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send(FileWatchChannel.Changed, event)
}

export function registerFileWatchHandlers(): void
{
    ipcMain.handle(FileWatchChannel.Watch, (_e, root: string): void => {
        startWatch(root, emitChange)
    })
    ipcMain.handle(FileWatchChannel.Unwatch, (_e, root: string): void => {
        stopWatch(root)
    })
}
