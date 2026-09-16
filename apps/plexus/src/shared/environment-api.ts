// Shared contract for Plexus's environment snapshot — the static host facts
// (directories, platform, versions, runtime flags) the app reads at startup.
// Same three-layer seam as the file-system api: main computes it, preload
// bridges it (synchronously, once), the renderer's EnvironmentService wraps it.
// Included by both the node (main/preload) and web (renderer) tsconfig
// projects, so all three layers share one shape.

// The renderer fetches the snapshot once, synchronously, over this channel
// (ipcRenderer.sendSync ↔ ipcMain.on + event.returnValue). The data is static,
// so a one-shot blocking read at preload time is simpler and cheaper than the
// async invoke plumbing the file-system api needs.
export enum EnvironmentChannel
{
    GetSnapshot = 'environment:get-snapshot',
}

// The operating system, normalised from Node's process.platform to a named
// set — an enum, not the raw string union, so app code branches on a member
// (`env.Platform === OperatingSystem.MacOS`) per the enums-over-literals rule.
// Anything outside the desktop trio maps to Other.
export enum OperatingSystem
{
    Windows = 'win32',
    MacOS   = 'darwin',
    Linux   = 'linux',
    Other   = 'other',
}

// A snapshot of host environment facts, captured once at startup. Every field
// is constant for the process lifetime.
export interface EnvironmentInfo
{
    // ── Directories ──
    CurrentDirectory:   string;   // process.cwd()
    HomeDirectory:      string;   // the user's home
    TempDirectory:      string;   // OS temp
    UserDataDirectory:  string;   // per-app config/data (app.getPath('userData'))
    DocumentsDirectory: string;   // the user's Documents
    DownloadsDirectory: string;   // the user's Downloads

    // ── Platform ──
    Platform:      OperatingSystem;
    Architecture:  string;   // process.arch (x64, arm64, …) — reported passthrough
    PathSeparator: string;   // path.sep ('\\' on Windows, '/' elsewhere)

    // ── Versions ──
    AppVersion:      string;
    ElectronVersion: string;
    ChromeVersion:   string;
    NodeVersion:     string;

    // ── Runtime flags ──
    IsDevelopment: boolean;   // dev server (HMR) vs packaged
    IsPackaged:    boolean;   // running from a packaged (asar) build
}
