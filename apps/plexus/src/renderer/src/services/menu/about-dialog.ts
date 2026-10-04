import { Observable } from '@pragmatic-tech-ai/mural/runtime'
import { OperatingSystem, type IEnvironment } from '@pragmatic-tech-ai/todl-runtime'

// About-dialog body: app name + host version info (EnvironmentService's
// one-time startup snapshot). Read-only — no commands, no mutable state.
//
// Extends Observable (the VM default): DialogService.Show accepts any Observable as Content (mural 0.61.3+).
export class AboutDialogVm extends Observable
{
    private static readonly PlexusAppName = 'Plexus'
    private static readonly VersionLabelPrefix = 'Version '
    private static readonly ElectronLabelPrefix = 'Electron '
    private static readonly ChromeLabelPrefix = 'Chromium '
    private static readonly NodeLabelPrefix = 'Node '
    private static readonly PlatformLabelPrefix = 'Platform '
    private static readonly ArchitectureLabelPrefix = 'Architecture '

    private readonly _environment: IEnvironment

    public constructor(environment: IEnvironment)
    {
        super()
        this._environment = environment
    }

    public get AppName(): string { return AboutDialogVm.PlexusAppName }
    public get AppVersion(): string { return this._environment.AppVersion }
    public get ElectronVersion(): string { return this._environment.ElectronVersion }
    public get ChromeVersion(): string { return this._environment.ChromeVersion }
    public get NodeVersion(): string { return this._environment.NodeVersion }
    public get Platform(): OperatingSystem { return this._environment.Platform }
    public get Architecture(): string { return this._environment.Architecture }

    // Template-facing, pre-labeled display strings — keeps the "Label value"
    // concatenation (and its literal prefixes) out of the .mu template, per
    // the no-inline-string-literals convention.
    public get AppVersionLabel(): string { return `${AboutDialogVm.VersionLabelPrefix}${this.AppVersion}` }
    public get ElectronVersionLabel(): string { return `${AboutDialogVm.ElectronLabelPrefix}${this.ElectronVersion}` }
    public get ChromeVersionLabel(): string { return `${AboutDialogVm.ChromeLabelPrefix}${this.ChromeVersion}` }
    public get NodeVersionLabel(): string { return `${AboutDialogVm.NodeLabelPrefix}${this.NodeVersion}` }
    public get PlatformLabel(): string { return `${AboutDialogVm.PlatformLabelPrefix}${this.Platform}` }
    public get ArchitectureLabel(): string { return `${AboutDialogVm.ArchitectureLabelPrefix}${this.Architecture}` }
}

export default AboutDialogVm
