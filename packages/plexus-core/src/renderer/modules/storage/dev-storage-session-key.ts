import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IDevStorageSession } from './remote-file-storage.js'

// The DI token the held dev session (IpcDevSession) is registered under, so the
// 'dev-environment' storage backend can resolve it lazily. Registered by the
// open-from-environment path (Phase 4).
export class DevStorageSessionKeys
{
    public static readonly Session = new ServiceKey<IDevStorageSession>('DevStorageSession')
}
