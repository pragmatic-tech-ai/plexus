import { IpcDevSession } from '@pragmatic-tech-ai/plexus-core/renderer/modules/dev-session'
import type { IDevSessionBridge } from '@pragmatic-tech-ai/plexus-core/renderer/modules/dev-session'
import { DevStorageSessionKeys } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/dev-storage-session-key.js'

// The renderer-registered held dev session: the IpcDevSession over the preload bridge (window.api.devSession),
// filed under DevStorageSessionKeys.Session so the dev-environment storage backend and the Remote solution
// services resolve the one session.
export class PlexusDevSession extends IpcDevSession
{
    public static readonly Key = DevStorageSessionKeys.Session

    private static readonly BridgeUnavailable =
        'PlexusDevSession: window.api.devSession is unavailable — the Electron preload '
        + 'bridge did not load. This service requires a desktop host.'

    constructor()
    {
        super(PlexusDevSession.Bridge())
    }

    private static Bridge(): IDevSessionBridge
    {
        const api = (globalThis as unknown as { api?: { devSession?: IDevSessionBridge } }).api
        if (api?.devSession === undefined)
        {
            throw new Error(PlexusDevSession.BridgeUnavailable)
        }
        return api.devSession
    }
}

export default PlexusDevSession
