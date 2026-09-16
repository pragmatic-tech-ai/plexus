import type { FileSystemService } from '../file-system/file-system-service.js'
import type { ILocalFileAccess, IStorage, StorageEntry } from '@pragmatic-tech-ai/todl-runtime'

// LocalFileStorage — the one storage backend today. Rooted at an absolute OS
// folder; joins root + project-relative path → absolute and delegates every
// call to FileSystemService (the unchanged Electron seam). It also implements
// ILocalFileAccess, since a disk-backed store can resolve real OS paths and
// open attachments in the OS default app.
//
// Path handling: the interface speaks project-relative paths with `/`; on disk
// we join against the (possibly `\`-separated) root using the same separator
// the root uses, so Windows and POSIX roots both work without node:path.
export class LocalFileStorage implements IStorage, ILocalFileAccess
{
    constructor(
        private readonly root: string,
        private readonly fs: FileSystemService,
    )
    {}

    public get Root(): string { return this.root }

    public ReadText(path: string): Promise<string>
    {
        return this.fs.ReadText(this.abs(path))
    }

    public ReadBytes(path: string): Promise<Uint8Array>
    {
        return this.fs.ReadBytes(this.abs(path))
    }

    public async WriteText(path: string, content: string): Promise<void>
    {
        await this.ensureParent(path)
        return this.fs.WriteText(this.abs(path), content)
    }

    public async WriteBytes(path: string, bytes: Uint8Array): Promise<void>
    {
        await this.ensureParent(path)
        return this.fs.WriteBytes(this.abs(path), bytes)
    }

    public Exists(path: string): Promise<boolean>
    {
        return this.fs.Exists(this.abs(path))
    }

    public Delete(path: string): Promise<void>
    {
        return this.fs.Delete(this.abs(path))
    }

    public CreateDirectory(path: string): Promise<void>
    {
        return this.fs.CreateDirectory(this.abs(path))
    }

    public Rename(from: string, to: string): Promise<void>
    {
        return this.fs.Rename(this.abs(from), this.abs(to))
    }

    public async List(path: string): Promise<readonly StorageEntry[]>
    {
        const abs = this.abs(path)
        try {
            const entries = await this.fs.ListDirectory(abs)
            return entries.map((e) => ({ Name: e.Name, IsDirectory: e.IsDirectory }))
        } catch (e) {
            // A non-existent directory lists as empty — matching the in-memory
            // FakeStorage double and the normal "backend not created yet" state
            // (e.g. <userData>/meta-models before anything is published). Any other
            // failure (permissions, I/O) is genuine and rethrows. Existence is
            // re-checked rather than sniffing the error code, which the IPC bridge
            // can strip off the underlying ENOENT.
            if (!(await this.fs.Exists(abs))) return []
            throw e
        }
    }

    public ResolveOsPath(path: string): string
    {
        return this.abs(path)
    }

    public OpenExternal(path: string): Promise<void>
    {
        return this.fs.OpenExternal(this.abs(path))
    }

    // Ensure a file's parent directory exists before writing it. Node's writeFile
    // (behind fs.WriteText/WriteBytes) ENOENTs on a missing parent, whereas the
    // FakeStorage double this code is written against lets a nested write succeed.
    // Recursive mkdir (idempotent) brings the disk backend in line — so publishing
    // a meta-model to a fresh <id>/<version>/ path just works. A top-level write
    // (no parent segment) relies on the root already existing and skips the mkdir.
    private async ensureParent(path: string): Promise<void>
    {
        const segments = path.split(/[\\/]/).filter((s) => s.length > 0)
        segments.pop()   // drop the file name; what remains is the parent directory
        if (segments.length > 0) await this.fs.CreateDirectory(this.abs(segments.join('/')))
    }

    // Project-relative → absolute OS path. '' (the root) resolves to the root
    // itself; otherwise each relative segment is appended with the root's
    // separator. Leading/trailing slashes in the relative path are tolerated.
    private abs(relative: string): string
    {
        const sep = this.root.includes('\\') && !this.root.includes('/') ? '\\' : '/'
        const segments = relative.split(/[\\/]/).filter((s) => s.length > 0)
        if (segments.length === 0) return this.root
        const base = this.root.endsWith(sep) ? this.root.slice(0, -sep.length) : this.root
        return base + sep + segments.join(sep)
    }
}
