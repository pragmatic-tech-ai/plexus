// Wire contract for the preview-server feature: the renderer<->main IPC channel names and
// the renderer-facing bridge shape (exposed on window.api.previewServer by the preload). The
// renderer's IpcPreviewServer consumes this to back plexus-core's host-agnostic IPreviewServer
// capability; main's registrar binds the channels to the PreviewServerManager.

// IPC channel names (renderer -> main via ipcRenderer.invoke).
export enum PreviewServerChannel
{
    Start = 'preview-server:start',
    Stop = 'preview-server:stop',
}

export interface IPreviewServerApi
{
    Start(root: string): Promise<{ url: string; port: number }>;
    Stop(root: string): Promise<void>;
}
