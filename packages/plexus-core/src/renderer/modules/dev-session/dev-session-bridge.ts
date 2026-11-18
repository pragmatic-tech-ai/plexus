import type { StorageEntry } from '@pragmatic-tech-ai/todl-runtime'
import type { StorageChangedPayload } from '@pragmatic-tech-ai/pragmatic-protocol'
import type { RelayReply, TargetRef } from '../../../shared/account-api.js'
import type { DevSessionReplies, IDevSessionPushes } from './dev-session-surface.js'

// What the preload exposes on window.api.devSession: each call resolves to its RelayReply envelope
// (unwrap with RelayWire.Unwrap). Open binds the held develop session to a target; the storage verbs
// then act on it, as do the language / model / solution requests. OnChanged and the OnGraphChanged /
// OnBuildStateChanged / OnDiagnostics pushes subscribe and return their disposer.
export interface IDevSessionBridge extends DevSessionReplies, IDevSessionPushes
{
    Open(target: TargetRef): Promise<RelayReply<void>>;
    Close(): Promise<RelayReply<void>>;
    ReadText(path: string): Promise<RelayReply<string>>;
    ReadBytes(path: string): Promise<RelayReply<Uint8Array>>;
    WriteText(path: string, content: string): Promise<RelayReply<void>>;
    WriteBytes(path: string, bytes: Uint8Array): Promise<RelayReply<void>>;
    Exists(path: string): Promise<RelayReply<boolean>>;
    Delete(path: string): Promise<RelayReply<void>>;
    CreateDirectory(path: string): Promise<RelayReply<void>>;
    Rename(from: string, to: string): Promise<RelayReply<void>>;
    List(path: string): Promise<RelayReply<StorageEntry[]>>;
    OnChanged(handler: (change: StorageChangedPayload) => void): () => void;
}
