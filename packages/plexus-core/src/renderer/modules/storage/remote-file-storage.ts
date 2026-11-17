import { FileChangeKind } from '@pragmatic-tech-ai/todl-runtime'
import type { FileChange, IStorage, IWatchableStorage, StorageEntry } from '@pragmatic-tech-ai/todl-runtime'
import type { StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'

// The typed seam a held develop session exposes for remote storage. Speaks
// IStorage-native types (bytes are Uint8Array; base64 is hidden in the client
// layer below the session). Defined here, implemented by the develop session.
export interface IDevStorageSession
{
    ReadText(path: string): Promise<string>
    ReadBytes(path: string): Promise<Uint8Array>
    WriteText(path: string, content: string): Promise<void>
    WriteBytes(path: string, bytes: Uint8Array): Promise<void>
    Exists(path: string): Promise<boolean>
    Delete(path: string): Promise<void>
    CreateDirectory(path: string): Promise<void>
    Rename(from: string, to: string): Promise<void>
    List(path: string): Promise<readonly StorageEntry[]>
    OnStorageChanged(handler: (change: StorageChangedPayload) => void): () => void
}

// RemoteFileStorage — IStorage over a dev environment's source, driven through a
// held develop session. A thin adapter: every verb delegates to the session.
// Watch observes one directory level (direct children), matching the local
// IWatchableStorage contract.
export class RemoteFileStorage implements IStorage, IWatchableStorage
{
    private static readonly KindMap: Readonly<Record<StorageChangedPayload['Kind'], FileChangeKind>> = {
        added: FileChangeKind.Added,
        removed: FileChangeKind.Removed,
        changed: FileChangeKind.Changed,
    }

    constructor(
        private readonly session: IDevStorageSession,
        private readonly root: string,
    )
    {}

    public get Root(): string
    {
        return this.root
    }

    public ReadText(path: string): Promise<string>
    {
        return this.session.ReadText(path)
    }

    public ReadBytes(path: string): Promise<Uint8Array>
    {
        return this.session.ReadBytes(path)
    }

    public WriteText(path: string, content: string): Promise<void>
    {
        return this.session.WriteText(path, content)
    }

    public WriteBytes(path: string, bytes: Uint8Array): Promise<void>
    {
        return this.session.WriteBytes(path, bytes)
    }

    public Exists(path: string): Promise<boolean>
    {
        return this.session.Exists(path)
    }

    public Delete(path: string): Promise<void>
    {
        return this.session.Delete(path)
    }

    public CreateDirectory(path: string): Promise<void>
    {
        return this.session.CreateDirectory(path)
    }

    public Rename(from: string, to: string): Promise<void>
    {
        return this.session.Rename(from, to)
    }

    public List(path: string): Promise<readonly StorageEntry[]>
    {
        return this.session.List(path)
    }

    public Watch(path: string, sink: (change: FileChange) => void): () => void
    {
        const dir = RemoteFileStorage.Normalize(path)
        return this.session.OnStorageChanged(payload =>
        {
            const changed = RemoteFileStorage.Normalize(payload.Path)
            if (RemoteFileStorage.ParentOf(changed) !== dir) return
            sink({ Kind: RemoteFileStorage.KindMap[payload.Kind], Path: changed, IsDirectory: payload.IsDirectory })
        })
    }

    private static Normalize(path: string): string
    {
        return path.split(/[\/]/).filter(s => s.length > 0).join('/')
    }

    private static ParentOf(normalized: string): string
    {
        const slash = normalized.lastIndexOf('/')
        return slash === -1 ? '' : normalized.slice(0, slash)
    }
}
