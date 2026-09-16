import type { ISettingsStore } from '@pragmatic-tech-ai/mural/framework'
import type { ISettingsBridge } from '../../../../shared/settings-api.js'

// ElectronSettingsStore — the Plexus host's ISettingsStore, adapting the preload
// settings bridge (window.api.settings) to the framework contract the
// ApplicationSettings service resolves (under SettingsStoreKey). This is the
// host seam that keeps the framework host-agnostic: the framework knows only
// Load()/Save(); the Electron IPC + settings.json path live here and in main.
//
// Registered as a root service in app.mu's `.services:` block (bound to
// SettingsStoreKey). Load() is synchronous — the preload already snapshotted the
// file at startup — so ApplicationSettings has real persisted values the moment
// it is constructed; Save() write-throughs asynchronously.
export class ElectronSettingsStore implements ISettingsStore
{
    private readonly bridge: ISettingsBridge;

    constructor()
    {
        const bridge = (globalThis as unknown as { api?: { settings?: ISettingsBridge } }).api?.settings;
        if (bridge === undefined)
        {
            throw new Error(
                'ElectronSettingsStore: window.api.settings is unavailable — the Electron '
                + 'preload bridge did not load. This store requires the Plexus desktop host.',
            );
        }
        this.bridge = bridge;
    }

    public Load(): Record<string, unknown>
    {
        return this.bridge.snapshot;
    }

    public Save(values: Record<string, unknown>): void
    {
        this.bridge.save(values);
    }
}
