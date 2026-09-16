// Shared contract for Plexus's settings persistence — the host side of the
// framework's ISettingsStore. Same three-layer seam as the file-system and
// environment apis: main owns the settings.json file, preload bridges it, the
// renderer's ElectronSettingsStore adapts it to the framework's ISettingsStore
// so ApplicationSettings can load/persist user values.
//
// The values are a flat key → value map (SettingDefinition.Key → current value),
// exactly what ApplicationSettings.persist() produces and Load() consumes.

// Sync snapshot read once at startup (ipcRenderer.sendSync ↔ ipcMain.on) so
// ApplicationSettings has real values at construction; async write-through
// (ipcRenderer.invoke ↔ ipcMain.handle) — the same sync-load / async-write split
// the environment snapshot uses.
export enum SettingsChannel
{
    GetSnapshot = 'settings:get-snapshot',
    Save        = 'settings:save',
}

// Exposed on window.api.settings. `snapshot` is the persisted values read once
// at preload load; `save` write-throughs the full value set (fire-and-forget,
// debounced by the framework's caller as needed).
export interface ISettingsBridge
{
    readonly snapshot: Record<string, unknown>;
    save(values: Record<string, unknown>): void;
}
