import { Application, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ApplicationSettings, type IDocument, type ISettingsContribution } from '@pragmatic-tech-ai/mural/framework'
import type { Geometry } from '@pragmatic-tech-ai/mural/visual-engine'
import { FileSystemService } from '../file-system/file-system-service.js'
import { SettingsPage } from './settings-page.js'

// PlexusSettingsContribution — the app half of the framework's settings seam.
//
// The framework owns the activity-bar gear + the launcher (SettingsLauncherService)
// but ships no icons and no settings page. This supplies both: the rail glyph
// (@Settings from Plexus's icon dictionary) and the settings view the launcher
// presents in the content host (a SettingsPage grouping ApplicationSettings.Settings
// by category, with per-Kind editor rows). Registered under SettingsContributionKey
// in app.mu; EditorShell then pins a footer RailAction wired to the launcher.
export class PlexusSettingsContribution implements ISettingsContribution
{
    public readonly Icon: Geometry | undefined
    public readonly Tooltip = 'Settings'

    private readonly provider: IServiceProvider

    constructor(provider: IServiceProvider)
    {
        this.provider = provider
        // The rail glyph, baked into the app's merged resources (@Settings, from
        // plexus-icons.mu). Resolved once here so the framework — which has no
        // icon of its own — can render the footer gear.
        this.Icon = Application.current?.Resources.Resolve('Settings') as Geometry | undefined
    }

    public CreateView(): IDocument
    {
        // ApplicationSettings is registered at the app root (see app.mu), so it
        // always resolves here — assert rather than widen the return to
        // undefined (the launcher opens the result as a document).
        const settings = this.provider.get(ApplicationSettings.Key)!
        return new SettingsPage(settings, this.provider.get(FileSystemService.Key))
    }
}
