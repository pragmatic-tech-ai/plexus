import { PreviewServerKey, type IPreviewServer } from '@pragmatic-tech-ai/plexus-core/renderer/modules/preview-server'
import type { IPreviewServerApi } from '../../../../shared/preview-server-api.js'

// The renderer-side preview server: the concrete IPreviewServer plexus-core's HtmlAppContributor
// resolves (through PreviewServerKey). A thin wrapper over the preload bridge
// (window.api.previewServer) — the same pattern as ConnectionsClient over window.api.connections —
// so plexus-core stays host-agnostic. It maps the wire shape ({ url, port }) to the capability's
// { Url } shape.
export class IpcPreviewServer implements IPreviewServer
{
    public static readonly Key = PreviewServerKey

    private readonly api: IPreviewServerApi

    constructor()
    {
        const bridge = (globalThis as unknown as { api?: { previewServer?: IPreviewServerApi } }).api
        if (bridge?.previewServer === undefined)
        {
            throw new Error(
                'IpcPreviewServer: window.api.previewServer is unavailable — the Electron preload '
                + 'bridge did not load. This service requires a desktop host.',
            )
        }
        this.api = bridge.previewServer
    }

    public async Start(root: string): Promise<{ Url: string }>
    {
        const info = await this.api.Start(root)
        return { Url: info.url }
    }

    public Stop(root: string): Promise<void>
    {
        return this.api.Stop(root)
    }
}

export default IpcPreviewServer
