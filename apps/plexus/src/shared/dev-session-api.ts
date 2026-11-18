// Wire contract for the held develop session: the renderer<->main IPC channel names. The bridge shape
// (exposed on window.api.devSession by the preload) is IDevSessionBridge, declared in plexus-core next
// to the renderer IpcDevSession that consumes it. Calls run on the session main holds open for the
// target; no credential crosses the bridge.
import type { IDevSessionBridge } from '@pragmatic-tech-ai/plexus-core/renderer/modules/dev-session'

export type { IDevSessionBridge }

export enum DevSessionChannel
{
    Open = 'dev-session:open',
    Close = 'dev-session:close',
    ReadText = 'dev-session:read-text',
    ReadBytes = 'dev-session:read-bytes',
    WriteText = 'dev-session:write-text',
    WriteBytes = 'dev-session:write-bytes',
    Exists = 'dev-session:exists',
    Delete = 'dev-session:delete',
    CreateDirectory = 'dev-session:create-directory',
    Rename = 'dev-session:rename',
    List = 'dev-session:list',
    // Pushed main to renderer for every storage change the held session reports.
    Changed = 'dev-session:changed',
}
