// Shared contract between Plexus's three Electron layers:
//   • main     — owns node:fs + native dialogs behind ipcMain handlers
//   • preload  — exposes them on window.api.fs across the context bridge
//   • renderer — FileSystemService (a mural service) wraps window.api.fs
//
// Types are erased at build; both the node (main/preload) and web (renderer)
// tsconfig projects include this file, so all three layers share one shape.

// One IPC channel per operation. Namespaced (`fs:`) so the channel ids stay
// clear of any future api surface. An enum, not bare literals, per the repo's
// enums-over-string-unions rule — main + preload key their handlers/invokes
// off these members.
export enum FileSystemChannel
{
    OpenFile      = 'fs:open-file',
    OpenFiles     = 'fs:open-files',
    OpenFolder    = 'fs:open-folder',
    SaveFileAs    = 'fs:save-file-as',
    ReadText      = 'fs:read-text',
    ReadBytes     = 'fs:read-bytes',
    WriteText     = 'fs:write-text',
    WriteBytes    = 'fs:write-bytes',
    Exists        = 'fs:exists',
    Delete        = 'fs:delete',
    CreateDirectory = 'fs:create-directory',
    Rename        = 'fs:rename',
    ListDirectory = 'fs:list-directory',
    OpenExternal  = 'fs:open-external',
}

// A name/extensions pair for the native open/save dialog filter list.
// Extensions carry NO leading dot ("plexus", not ".plexus").
export interface FileFilter
{
    Name:       string;
    Extensions: readonly string[];
}

export interface OpenFileOptions
{
    Title?:   string;
    Filters?: readonly FileFilter[];
}

export interface OpenFolderOptions
{
    Title?:       string;
    DefaultPath?: string;
}

export interface SaveFileOptions
{
    Title?:       string;
    DefaultPath?: string;
    Filters?:     readonly FileFilter[];
}

// A file opened through the dialog: its absolute path plus UTF-8 text.
export interface OpenFileResult
{
    Path:    string;
    Content: string;
}

// A file picked for import: its absolute source path plus raw bytes (so binary
// files — images, archives — survive the copy uncorrupted, unlike the text-only
// OpenFileResult). Uint8Array rides the Electron structured clone directly.
export interface ImportedFile
{
    Path:  string;
    Bytes: Uint8Array;
}

// One entry in a directory listing.
export interface FileEntry
{
    Name:        string;
    IsDirectory: boolean;
}

// The low-level bridge exposed on `window.api.fs`. camelCase verbs mark this
// as the raw IPC surface; the renderer's FileSystemService is the PascalCase,
// app-facing wrapper. Every call is async (an IPC round-trip); the dialog
// calls resolve to null when the user cancels.
export interface IFileSystemApi
{
    openFile(options?: OpenFileOptions): Promise<OpenFileResult | null>;
    // Native multi-select open dialog → each picked file's path + raw bytes, or
    // null on cancel. For importing existing files into a project.
    openFiles(options?: OpenFileOptions): Promise<ImportedFile[] | null>;
    // Native folder picker → the chosen directory's absolute path, or null on cancel.
    openFolder(options?: OpenFolderOptions): Promise<string | null>;
    saveFileAs(content: string, options?: SaveFileOptions): Promise<string | null>;
    readText(path: string): Promise<string>;
    // Read raw bytes from an absolute path (binary-safe counterpart of readText).
    readBytes(path: string): Promise<Uint8Array>;
    writeText(path: string, content: string): Promise<void>;
    // Write raw bytes to an absolute path (binary-safe counterpart of writeText).
    writeBytes(path: string, bytes: Uint8Array): Promise<void>;
    exists(path: string): Promise<boolean>;
    delete(path: string): Promise<void>;
    // Create a directory (and any missing parents) at an absolute path.
    createDirectory(path: string): Promise<void>;
    // Rename/move a file or directory (with contents) from one absolute path to
    // another.
    rename(from: string, to: string): Promise<void>;
    listDirectory(path: string): Promise<readonly FileEntry[]>;
    // Open a path with the OS default application (for non-diagram attachments).
    openExternal(path: string): Promise<void>;
}
