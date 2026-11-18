import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IDevStorageSession } from './remote-file-storage.js'
import type { DevSessionRequests, IDevSessionPushes } from '../dev-session/dev-session-surface.js'

// The held session's full surface (the IRemoteLanguageSession shape): the storage verbs plus the
// language/model requests and pushes, so one session serves the storage and Remote language seams.
export type HeldDevSession = IDevStorageSession & DevSessionRequests & IDevSessionPushes

// The DI token the held dev session (IpcDevSession) is registered under, so the
// 'dev-environment' storage backend can resolve it lazily. Registered by the
// open-from-environment path (Phase 4).
export class DevStorageSessionKeys
{
    public static readonly Session: ServiceKey<HeldDevSession> = new ServiceKey<HeldDevSession>('DevStorageSession')
}
