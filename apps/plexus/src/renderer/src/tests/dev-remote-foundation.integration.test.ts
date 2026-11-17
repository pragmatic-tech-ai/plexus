import { describe, test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { FileChangeKind } from '@pragmatic-tech-ai/todl-runtime'
import type { FileChange, StorageEntry } from '@pragmatic-tech-ai/todl-runtime'
import type { StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import { StorageService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/storage-service.js'
import { RemoteFileStorage } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/remote-file-storage.js'
import { DevStorageSessionKeys } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/dev-storage-session-key.js'
import { DevEnvironmentLocation } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/dev-environment-location.js'
import { DevelopSession } from '../../../main/account/develop-session.js'
import type { RelayClient } from '../../../main/account/relay-connector.js'

type DevelopSurface = Pick<RelayClient, 'StorageReadText' | 'StorageReadBytes' | 'StorageWriteText' | 'StorageWriteBytes' | 'StorageExists'
    | 'StorageDelete' | 'StorageCreateDirectory' | 'StorageRename' | 'StorageList' | 'OnStorageChanged' | 'DisposeAsync' | 'CloseCode'>

// Only the transport is faked: an in-memory source behind the develop surface of a relay client.
// Everything above it (DevelopSession, RemoteFileStorage, StorageService) is the real code.
class FakeRelayClient implements DevelopSurface
{
    private static readonly Missing = 'missing: '
    private static readonly Root = ''

    private readonly files = new Map<string, Uint8Array>()
    private readonly directories = new Set<string>()
    private readonly handlers = new Set<(change: StorageChangedPayload) => void>()

    public StorageReadText(path: string): Promise<string>
    {
        return this.StorageReadBytes(path).then(bytes => new TextDecoder().decode(bytes))
    }

    public async StorageReadBytes(path: string): Promise<Uint8Array>
    {
        const bytes = this.files.get(path)
        if (bytes === undefined) throw new Error(FakeRelayClient.Missing + path)
        return bytes.slice()
    }

    public async StorageWriteText(path: string, content: string): Promise<void>
    {
        await this.StorageWriteBytes(path, new TextEncoder().encode(content))
    }

    public async StorageWriteBytes(path: string, bytes: Uint8Array): Promise<void>
    {
        this.files.set(path, bytes.slice())
    }

    public async StorageExists(path: string): Promise<boolean>
    {
        return this.files.has(path) || this.directories.has(path)
    }

    public async StorageDelete(path: string): Promise<void>
    {
        this.files.delete(path)
        this.directories.delete(path)
    }

    public async StorageCreateDirectory(path: string): Promise<void>
    {
        this.directories.add(path)
    }

    public async StorageRename(from: string, to: string): Promise<void>
    {
        const bytes = this.files.get(from)
        if (bytes === undefined) throw new Error(FakeRelayClient.Missing + from)
        this.files.delete(from)
        this.files.set(to, bytes)
    }

    public async StorageList(path: string): Promise<StorageEntry[]>
    {
        const prefix = path === FakeRelayClient.Root ? FakeRelayClient.Root : path + Fixture.Slash
        const entries = new Map<string, boolean>()
        for (const file of this.files.keys())
        {
            if (!file.startsWith(prefix)) continue
            const rest = file.slice(prefix.length)
            const cut = rest.indexOf(Fixture.Slash)
            if (cut < 0) entries.set(rest, false)
            else entries.set(rest.slice(0, cut), true)
        }
        for (const dir of this.directories)
        {
            const rest = dir.slice(prefix.length)
            if (dir.startsWith(prefix) && rest.length > 0 && !rest.includes(Fixture.Slash)) entries.set(rest, true)
        }
        return [...entries].map(([Name, IsDirectory]) => ({ Name, IsDirectory }))
    }

    public OnStorageChanged(handler: (change: StorageChangedPayload) => void): { dispose(): void }
    {
        this.handlers.add(handler)
        return { dispose: () => { this.handlers.delete(handler) } }
    }

    public async DisposeAsync(): Promise<void>
    {
    }

    public CloseCode(): number | undefined
    {
        return undefined
    }

    // The test's way to play a server push.
    public Push(change: StorageChangedPayload): void
    {
        for (const handler of [...this.handlers]) handler(change)
    }

    public HandlerCount(): number
    {
        return this.handlers.size
    }

    public AsRelayClient(): RelayClient
    {
        return this as unknown as RelayClient
    }
}

class Fixture
{
    public static readonly Environment = 'dev env'
    public static readonly Solution = 'my solution'
    public static readonly Project = 'proj'
    public static readonly SourceDir = 'src/proj'
    public static readonly File = 'src/proj/a.bin'
    public static readonly TextName = 'notes.txt'
    public static readonly TextFile = 'src/proj/notes.txt'
    public static readonly Text = 'héllo — wörld'
    public static readonly OtherFile = 'src/other/b.txt'
    public static readonly Nested = 'src/proj/sub/deep.txt'
    public static readonly SubName = 'sub'
    public static readonly SubDir = 'src/proj/sub'
    public static readonly Added = 'src/proj/new.txt'
    public static readonly Outside = 'src/other/new.txt'
    public static readonly Slash = '/'
    public static readonly KindAdded: StorageChangedPayload['Kind'] = 'added'
    public static readonly KindRemoved: StorageChangedPayload['Kind'] = 'removed'
    public static readonly KindChanged: StorageChangedPayload['Kind'] = 'changed'

    public static readonly Bytes = new Uint8Array([0, 1, 127, 128, 200, 254, 255, 0, 42])
}

describe('dev-environment remote foundation: client seam', () =>
{
    test('bytes round-trip byte-exact through session, client and store', async () =>
    {
        const client = new FakeRelayClient()
        const storage = new RemoteFileStorage(new DevelopSession(client.AsRelayClient()), Fixture.SourceDir)
        await storage.WriteBytes(Fixture.File, Fixture.Bytes)
        const back = await storage.ReadBytes(Fixture.File)
        expect(Array.from(back)).toEqual(Array.from(Fixture.Bytes))
        expect(await storage.Exists(Fixture.File)).toBe(true)
    })

    test('text round-trips and List reports directories', async () =>
    {
        const client = new FakeRelayClient()
        const storage = new RemoteFileStorage(new DevelopSession(client.AsRelayClient()), Fixture.SourceDir)
        await storage.WriteText(Fixture.TextFile, Fixture.Text)
        await storage.WriteText(Fixture.Nested, Fixture.Text)
        expect(await storage.ReadText(Fixture.TextFile)).toBe(Fixture.Text)
        const entries = [...await storage.List(Fixture.SourceDir)].sort((a, b) => a.Name.localeCompare(b.Name))
        expect(entries).toEqual([
            { Name: Fixture.TextName, IsDirectory: false },
            { Name: Fixture.SubName, IsDirectory: true },
        ])
    })

    test('a pushed storage/changed in the watched directory reaches the Watch sink, mapped', () =>
    {
        const client = new FakeRelayClient()
        const storage = new RemoteFileStorage(new DevelopSession(client.AsRelayClient()), Fixture.SourceDir)
        const seen: FileChange[] = []
        const stop = storage.Watch(Fixture.SourceDir, change => seen.push(change))
        client.Push({ Kind: Fixture.KindAdded, Path: Fixture.Added, IsDirectory: false })
        client.Push({ Kind: Fixture.KindRemoved, Path: Fixture.SubDir, IsDirectory: true })
        client.Push({ Kind: Fixture.KindChanged, Path: Fixture.Outside, IsDirectory: false })
        client.Push({ Kind: Fixture.KindChanged, Path: Fixture.Nested, IsDirectory: false })
        expect(seen).toEqual([
            { Kind: FileChangeKind.Added, Path: Fixture.Added, IsDirectory: false },
            { Kind: FileChangeKind.Removed, Path: Fixture.SubDir, IsDirectory: true },
        ])
        stop()
        expect(client.HandlerCount()).toBe(0)
        client.Push({ Kind: Fixture.KindAdded, Path: Fixture.Added, IsDirectory: false })
        expect(seen).toHaveLength(2)
    })

    test('StorageService routes a dev-environment location to RemoteFileStorage over the registered session', async () =>
    {
        const client = new FakeRelayClient()
        const provider = new ServiceProvider()
        provider.registerInstance(DevStorageSessionKeys.Session, new DevelopSession(client.AsRelayClient()))
        const service = new StorageService(provider)
        const location = DevEnvironmentLocation.Build(Fixture.Environment, Fixture.Solution) + Fixture.Slash + Fixture.Project
        const storage = service.CreateStorage(location)
        expect(storage).toBeInstanceOf(RemoteFileStorage)
        expect(storage.Root).toBe(Fixture.Solution + Fixture.Slash + Fixture.Project)

        await storage.WriteBytes(Fixture.File, Fixture.Bytes)
        // The write reached the fake store through the real session, not a local copy.
        expect(Array.from(await client.StorageReadBytes(Fixture.File))).toEqual(Array.from(Fixture.Bytes))
        // RemoteFileStorage passes paths through without enforcing Root, so a path outside Root still reaches the store (expected for this seam test).
        await client.StorageWriteText(Fixture.OtherFile, Fixture.Text)
        expect(await storage.ReadText(Fixture.OtherFile)).toBe(Fixture.Text)
    })
})
