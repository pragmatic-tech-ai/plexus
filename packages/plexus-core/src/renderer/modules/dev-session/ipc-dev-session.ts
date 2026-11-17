import type { StorageEntry } from '@pragmatic-tech-ai/todl-runtime'
import type { StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import { RelayWire, type TargetRef } from '../../../shared/account-api.js'
import type { IDevStorageSession } from '../storage/remote-file-storage.js'
import type { IDevSessionBridge } from './dev-session-bridge.js'

// The renderer end of the held develop session: IDevStorageSession over the preload bridge. The relay
// connection and credentials stay in main; each call unwraps its RelayReply so a failure rejects with
// its sentence.
export class IpcDevSession implements IDevStorageSession
{
    public constructor(private readonly bridge: IDevSessionBridge)
    {
    }

    public async Open(target: TargetRef): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.Open({ Name: target.Name, Source: target.Source }))
    }

    public async Close(): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.Close())
    }

    public async ReadText(path: string): Promise<string>
    {
        return RelayWire.Unwrap(await this.bridge.ReadText(path))
    }

    public async ReadBytes(path: string): Promise<Uint8Array>
    {
        return RelayWire.Unwrap(await this.bridge.ReadBytes(path))
    }

    public async WriteText(path: string, content: string): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.WriteText(path, content))
    }

    public async WriteBytes(path: string, bytes: Uint8Array): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.WriteBytes(path, bytes))
    }

    public async Exists(path: string): Promise<boolean>
    {
        return RelayWire.Unwrap(await this.bridge.Exists(path))
    }

    public async Delete(path: string): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.Delete(path))
    }

    public async CreateDirectory(path: string): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.CreateDirectory(path))
    }

    public async Rename(from: string, to: string): Promise<void>
    {
        RelayWire.Unwrap(await this.bridge.Rename(from, to))
    }

    public async List(path: string): Promise<readonly StorageEntry[]>
    {
        return RelayWire.Unwrap(await this.bridge.List(path))
    }

    public OnStorageChanged(handler: (change: StorageChangedPayload) => void): () => void
    {
        return this.bridge.OnChanged(handler)
    }
}
