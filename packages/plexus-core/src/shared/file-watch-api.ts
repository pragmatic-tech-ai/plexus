// Shared contract for the external file-change watcher across Plexus's three
// Electron layers (main owns chokidar; preload bridges; renderer FileWatchService
// wraps it). Mirrors the fs-api / agent-api shape.
export enum FileWatchChannel
{
    Watch   = 'fs-watch:watch',
    Unwatch = 'fs-watch:unwatch',
    Changed = 'fs-watch:changed',
}

export enum FileChangeKind
{
    Added   = 'add',
    Changed = 'change',
    Removed = 'unlink',
}

export interface FileChangeEvent
{
    path: string;      // absolute OS path of the changed file
    kind: FileChangeKind;
}

export interface IFileWatchApi
{
    watch(root: string): Promise<void>;
    unwatch(root: string): Promise<void>;
    onChanged(cb: (e: FileChangeEvent) => void): () => void;
}
