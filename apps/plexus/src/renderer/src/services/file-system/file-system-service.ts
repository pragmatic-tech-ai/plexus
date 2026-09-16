import { ServiceBase, ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type {
  FileEntry,
  IFileSystemApi,
  ImportedFile,
  OpenFileOptions,
  OpenFileResult,
  OpenFolderOptions,
  SaveFileOptions,
} from '../../../../shared/file-system-api.js'

// FileSystemService — the renderer-side, app-facing wrapper over the native
// file-system capability the main process owns. This is the injected seam the
// shell's comments call out: VMs / commands resolve it (FileSystemService.Key)
// and call PascalCase methods; they never touch `window.api`, ipcRenderer, or
// node:fs, so the app stays host-agnostic and portable to a non-Electron host
// (a different bootstrap swaps the bridge, this surface is unchanged).
//
// Registered as a root singleton via app.mu's `.services:` block. It reads the
// preload bridge (`window.api.fs`) once at construction and delegates each
// call; every method is async (an IPC round-trip to the main process), and the
// dialog calls resolve to null when the user cancels.
export class FileSystemService extends ServiceBase
{
    public static readonly Key = new ServiceKey<FileSystemService>('FileSystemService');

    private readonly api: IFileSystemApi;

    constructor(provider: IServiceProvider)
    {
        super(provider);
        const bridge = (globalThis as unknown as { api?: { fs?: IFileSystemApi } }).api;
        if (bridge?.fs === undefined)
        {
            throw new Error(
                'FileSystemService: window.api.fs is unavailable — the Electron preload '
                + 'bridge did not load. This service requires the Plexus desktop host.',
            );
        }
        this.api = bridge.fs;
    }

    // Native open dialog → the picked file's path + UTF-8 text, or null if the
    // user cancelled.
    public OpenFile(options?: OpenFileOptions): Promise<OpenFileResult | null>
    {
        return this.api.openFile(options);
    }

    // Native multi-select open dialog → each picked file's path + raw bytes, or
    // null if the user cancelled. Binary-safe, for importing existing files.
    public OpenFiles(options?: OpenFileOptions): Promise<ImportedFile[] | null>
    {
        return this.api.openFiles(options);
    }

    // Native folder picker → the chosen directory's absolute path, or null if
    // the user cancelled.
    public OpenFolder(options?: OpenFolderOptions): Promise<string | null>
    {
        return this.api.openFolder(options);
    }

    // Native save-as dialog → writes `content` to the chosen path and returns
    // it, or null if the user cancelled.
    public SaveFileAs(content: string, options?: SaveFileOptions): Promise<string | null>
    {
        return this.api.saveFileAs(content, options);
    }

    public ReadText(path: string): Promise<string>
    {
        return this.api.readText(path);
    }

    // Read raw bytes from a path — the binary-safe counterpart of ReadText.
    public ReadBytes(path: string): Promise<Uint8Array>
    {
        return this.api.readBytes(path);
    }

    public WriteText(path: string, content: string): Promise<void>
    {
        return this.api.writeText(path, content);
    }

    // Write raw bytes to a path — the binary-safe counterpart of WriteText.
    public WriteBytes(path: string, bytes: Uint8Array): Promise<void>
    {
        return this.api.writeBytes(path, bytes);
    }

    public Exists(path: string): Promise<boolean>
    {
        return this.api.exists(path);
    }

    public Delete(path: string): Promise<void>
    {
        return this.api.delete(path);
    }

    // Create a directory (and any missing parents) at the given path.
    public CreateDirectory(path: string): Promise<void>
    {
        return this.api.createDirectory(path);
    }

    // Rename/move a file or directory (with contents) to a new path.
    public Rename(from: string, to: string): Promise<void>
    {
        return this.api.rename(from, to);
    }

    public ListDirectory(path: string): Promise<readonly FileEntry[]>
    {
        return this.api.listDirectory(path);
    }

    // Open a path with the OS default application (non-diagram attachments).
    public OpenExternal(path: string): Promise<void>
    {
        return this.api.openExternal(path);
    }
}
