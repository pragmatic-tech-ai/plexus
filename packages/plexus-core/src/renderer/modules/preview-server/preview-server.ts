import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'

// Host-agnostic preview-server capability: the engine/UX side (HtmlAppContributor's Serve
// command) depends only on this interface + key. A desktop host (apps/plexus) supplies the
// concrete impl over its Electron preload bridge and registers it under PreviewServerKey, so
// plexus-core never imports from the app.
export interface IPreviewServer
{
    Start(root: string): Promise<{ Url: string }>;
    Stop(root: string): Promise<void>;
}

export const PreviewServerKey = new ServiceKey<IPreviewServer>('PreviewServer')
