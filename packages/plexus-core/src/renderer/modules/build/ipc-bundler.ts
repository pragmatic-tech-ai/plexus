import type { IBundler, BundleAppRequest, BundleAppResult } from '@pragmatic-tech-ai/todl/build-system-core'

/** Renderer IBundler: forwards the bundle request to the Electron main process over IPC. */
export class IpcBundler implements IBundler
{
    private static readonly MissingApiMessage = 'window.api.bundle is unavailable — the Electron preload bridge did not load'

    public BundleApp(request: BundleAppRequest): Promise<BundleAppResult>
    {
        const api = (globalThis as unknown as { api?: { bundle?: { Bundle(r: BundleAppRequest): Promise<BundleAppResult> } } }).api
        if (api?.bundle === undefined)
        {
            throw new Error(IpcBundler.MissingApiMessage)
        }
        return api.bundle.Bundle(request)
    }
}
