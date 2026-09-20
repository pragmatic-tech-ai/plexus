import { homedir, tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { OperatingSystem, type EnvironmentInfo } from '../shared/environment-api.js';

// A plain-Node builder for the same EnvironmentInfo snapshot the Electron main
// process produces (see ../main/environment.ts) — for hosts that run without
// Electron (a CLI, a test harness, a server). It derives every field from Node
// built-ins (os / path / process); the app-specific facts Electron reads for
// free (app name, version, dev/packaged flags) are passed in, defaulted.
//
// Two fields are genuinely out of reach without a Chromium/Electron runtime and
// come back empty: ElectronVersion and ChromeVersion. Everything else — and in
// particular every directory — resolves from Node.

export interface NodeEnvironmentOptions {
    // The application name — the leaf of UserDataDirectory (Electron uses the
    // app name the same way). Defaults to 'plexus'.
    readonly appName?: string;
    // The app version reported as AppVersion. Electron reads it from the app's
    // package.json; a Node host passes whatever it knows. Defaults to ''.
    readonly appVersion?: string;
    // Dev vs. release. Defaults to `NODE_ENV !== 'production'`.
    readonly isDevelopment?: boolean;
    // Running from a packaged build. No Electron asar to detect, so defaults to false.
    readonly isPackaged?: boolean;
}

export class NodeEnvironment {
    private readonly appName: string;
    private readonly appVersion: string;
    private readonly isDevelopment: boolean;
    private readonly isPackaged: boolean;
    private readonly home: string;

    constructor(options: NodeEnvironmentOptions = {}) {
        this.appName = options.appName ?? 'plexus';
        this.appVersion = options.appVersion ?? '';
        this.isDevelopment = options.isDevelopment ?? process.env.NODE_ENV !== 'production';
        this.isPackaged = options.isPackaged ?? false;
        this.home = homedir();
    }

    // Build the frozen snapshot — the same shape the renderer's EnvironmentService
    // consumes, so a Node host can feed it wherever an EnvironmentInfo is expected.
    public Build(): EnvironmentInfo {
        return {
            CurrentDirectory: process.cwd(),
            HomeDirectory: this.home,
            TempDirectory: tmpdir(),
            UserDataDirectory: this.UserDataDirectory(),
            DocumentsDirectory: this.UserDir('Documents', 'XDG_DOCUMENTS_DIR'),
            DownloadsDirectory: this.UserDir('Downloads', 'XDG_DOWNLOAD_DIR'),

            Platform: NodeEnvironment.ToOperatingSystem(process.platform),
            Architecture: process.arch,
            PathSeparator: sep,

            AppVersion: this.appVersion,
            // Chromium/Electron-only — undefined under plain Node, reported empty.
            ElectronVersion: process.versions.electron ?? '',
            ChromeVersion: process.versions.chrome ?? '',
            NodeVersion: process.versions.node,

            IsDevelopment: this.isDevelopment,
            IsPackaged: this.isPackaged,
        };
    }

    // The per-app config/data directory, matching Electron's
    // app.getPath('userData') = <config-root>/<appName>. The config root is the
    // platform's roaming-config location:
    //   • Windows — %APPDATA%            (…\AppData\Roaming)
    //   • macOS   — ~/Library/Application Support
    //   • Linux   — $XDG_CONFIG_HOME     (~/.config)
    private UserDataDirectory(): string {
        return join(this.ConfigRoot(), this.appName);
    }

    private ConfigRoot(): string {
        switch (process.platform) {
            case 'win32':
                return process.env.APPDATA ?? join(this.home, 'AppData', 'Roaming');
            case 'darwin':
                return join(this.home, 'Library', 'Application Support');
            default: // linux + anything else follows the XDG base-dir spec
                return this.envDir('XDG_CONFIG_HOME') ?? join(this.home, '.config');
        }
    }

    // Documents / Downloads. Electron resolves the real known folder (which can be
    // localized on Windows or redirected via XDG on Linux); without native APIs we
    // honor the XDG override when the host exports it (Linux), otherwise fall back
    // to ~/<Name>. On Windows/macOS the default location is ~/<Name>.
    private UserDir(name: string, xdgEnv: string): string {
        if (process.platform === 'linux') {
            const fromEnv = this.envDir(xdgEnv);
            if (fromEnv !== undefined) return fromEnv;
        }
        return join(this.home, name);
    }

    // Read a directory-valued env var, treating an empty string as unset.
    private envDir(name: string): string | undefined {
        const value = process.env[name];
        return value !== undefined && value !== '' ? value : undefined;
    }

    private static ToOperatingSystem(platform: NodeJS.Platform): OperatingSystem {
        switch (platform) {
            case 'win32':
                return OperatingSystem.Windows;
            case 'darwin':
                return OperatingSystem.MacOS;
            case 'linux':
                return OperatingSystem.Linux;
            default:
                return OperatingSystem.Other;
        }
    }
}
