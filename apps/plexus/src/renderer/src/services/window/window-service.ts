import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { type IWindowApi } from '@pragmatic-tech-ai/plexus-core/shared/window-api.js'

// The host-chrome action HelpCommandsService.QuitCommand needs — quitting the
// app. Kept as a real interface (not just the concrete class) so tests can
// inject a fake without touching `window.api`, mirroring how EnvironmentService
// wraps window.api.environment rather than letting call sites reach into it.
export interface IWindowService
{
    Quit(): void
}

// Renderer-side seam over the preload's window.api.titlebar bridge (IWindowApi,
// plexus-core/shared/window-api.ts). `Quit()` is fire-and-forget: main calls
// app.quit(), which re-enters the window's existing close flow (confirmCloseDocs)
// so unsaved-work prompts still guard a menu-driven Quit.
export class WindowService extends ServiceBase implements IWindowService
{
    public static readonly Key = new ServiceKey<IWindowService>('WindowService')

    private readonly bridge: IWindowApi

    public constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { titlebar?: IWindowApi } }).api?.titlebar
        if (bridge === undefined)
        {
            throw new Error(
                'WindowService: window.api.titlebar is unavailable — the Electron preload ' +
                    'bridge did not load. This service requires the Plexus desktop host.',
            )
        }
        this.bridge = bridge
    }

    public Quit(): void
    {
        this.bridge.quit()
    }
}

export default WindowService
