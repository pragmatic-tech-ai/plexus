import { ServiceBase } from '@pragmatic-tech-ai/mural/runtime';
import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime';
import {
    EnvironmentKey,
    OperatingSystem,
    type IEnvironment,
} from '@pragmatic-tech-ai/todl-runtime';
import type { EnvironmentInfo } from '../../shared/environment-api.js';

// EnvironmentService — the renderer-side, app-facing view of the static host
// environment (working/app directories, platform, versions, runtime flags).
// The injected seam VMs / commands resolve (EnvironmentService.Key) to read
// where things live without touching `window.api`, process, or navigator, so
// the app stays host-agnostic.
//
// Registered as a root singleton via app.mu's `.services:` block. The values
// are a snapshot captured once at startup (the preload reads them synchronously
// over IPC) and never change for the process lifetime — so the surface is plain
// synchronous getters, not DPs. If a value needs to be data-bound in `.mu`
// markup, promote that field to a DP (a `$path` binding's first segment must be
// a DP); until then these are for imperative reads.
export class EnvironmentService extends ServiceBase implements IEnvironment
{
    // The service registers under and is resolved through the shared, host-agnostic
    // EnvironmentKey (todl-runtime), so consumers can depend on IEnvironment without
    // this concrete class. Kept as EnvironmentService.Key for existing call sites.
    public static readonly Key = EnvironmentKey;

    private readonly info: EnvironmentInfo;

    constructor(provider: IServiceProvider)
    {
        super(provider);
        const env = (globalThis as unknown as { api?: { environment?: EnvironmentInfo } }).api
            ?.environment;
        if (env === undefined)
        {
            throw new Error(
                'EnvironmentService: window.api.environment is unavailable — the Electron ' +
                    'preload bridge did not load. This service requires the Plexus desktop host.',
            );
        }
        this.info = env;
    }

    // ── Directories ──
    public get CurrentDirectory(): string
    {
        return this.info.CurrentDirectory;
    }
    public get HomeDirectory(): string
    {
        return this.info.HomeDirectory;
    }
    public get TempDirectory(): string
    {
        return this.info.TempDirectory;
    }
    public get UserDataDirectory(): string
    {
        return this.info.UserDataDirectory;
    }
    public get DocumentsDirectory(): string
    {
        return this.info.DocumentsDirectory;
    }
    public get DownloadsDirectory(): string
    {
        return this.info.DownloadsDirectory;
    }

    // ── Platform ──
    public get Platform(): OperatingSystem
    {
        return this.info.Platform;
    }
    public get Architecture(): string
    {
        return this.info.Architecture;
    }
    public get PathSeparator(): string
    {
        return this.info.PathSeparator;
    }
    // True on Windows — used for case-insensitive path comparison (Windows
    // filesystems are case-insensitive; POSIX ones are not).
    public get IsWindows(): boolean
    {
        return this.info.Platform === OperatingSystem.Windows;
    }

    // ── Versions ──
    public get AppVersion(): string
    {
        return this.info.AppVersion;
    }
    public get ElectronVersion(): string
    {
        return this.info.ElectronVersion;
    }
    public get ChromeVersion(): string
    {
        return this.info.ChromeVersion;
    }
    public get NodeVersion(): string
    {
        return this.info.NodeVersion;
    }

    // ── Runtime flags ──
    public get IsDevelopment(): boolean
    {
        return this.info.IsDevelopment;
    }
    public get IsPackaged(): boolean
    {
        return this.info.IsPackaged;
    }
}
