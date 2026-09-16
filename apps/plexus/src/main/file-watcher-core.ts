// Electron-free watcher core: chokidar per root + self-write suppression, so
// Plexus's own saves don't echo back as "external" changes. The electron wiring
// (ipcMain + webContents.send) lives in file-watcher.ts.
import chokidar, { type FSWatcher } from 'chokidar'
import { resolve } from 'node:path'
import { FileChangeKind, type FileChangeEvent } from '../shared/file-watch-api.js'

// Absolute-path normalization used for BOTH suppression keys and event paths so
// the two always compare equal. resolve() collapses separators; lowercase makes
// the compare case-insensitive (Windows filesystems are).
export function normalize(p: string): string
{
    return resolve(p).toLowerCase()
}

const SUPPRESS_WINDOW_MS = 1000
const recentWrites = new Map<string, number>()

export function noteInternalWrite(absPath: string): void
{
    recentWrites.set(normalize(absPath), Date.now())
}

export function isSuppressed(absPath: string): boolean
{
    const key = normalize(absPath)
    const at = recentWrites.get(key)
    if (at === undefined) return false
    recentWrites.delete(key)                         // one-shot
    return Date.now() - at < SUPPRESS_WINDOW_MS
}

const watchers = new Map<string, FSWatcher>()

// chokidar v4+ dropped glob support in `ignored`; use a predicate.
function ignored(path: string): boolean
{
    return /(^|[\\/])(node_modules|\.git|dist)([\\/]|$)/.test(path)
}

export function startWatch(root: string, emit: (e: FileChangeEvent) => void): FSWatcher
{
    const key = normalize(root)
    const existing = watchers.get(key)
    if (existing !== undefined) return existing

    const watcher = chokidar.watch(root, {
        ignoreInitial: true,
        ignored,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
    })
    const onFs = (kind: FileChangeKind) => (path: string): void => {
        if (isSuppressed(path)) return
        emit({ path, kind })
    }
    watcher.on('add', onFs(FileChangeKind.Added))
    watcher.on('change', onFs(FileChangeKind.Changed))
    watcher.on('unlink', onFs(FileChangeKind.Removed))
    watcher.on('error', () => { /* degrade silently — a dead watcher must not crash */ })
    watchers.set(key, watcher)
    return watcher
}

export function stopWatch(root: string): void
{
    const key = normalize(root)
    const w = watchers.get(key)
    if (w === undefined) return
    void w.close()
    watchers.delete(key)
}

export function stopAll(): void
{
    for (const w of watchers.values()) void w.close()
    watchers.clear()
}
