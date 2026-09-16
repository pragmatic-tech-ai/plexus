import type { Application } from '@pragmatic-tech-ai/mural/runtime'
import { DataTemplate } from '@pragmatic-tech-ai/mural/basic'
import {
    ShellControlAlignment,
    ShellControlDefinition,
    ShellModule,
    ShellRegion,
    ThemeSelector,
} from '@pragmatic-tech-ai/mural/framework'

// Contribute the framework's ThemeSelector (theme + scheme picker, incl. the
// "Custom…" base-colour flow) as a right-aligned status-bar shell control — the
// universal ShellControlDefinition path. ThemeSelector talks to the global
// ThemeManager directly, so it needs no DataContext; the shell only has to place
// it (StatusBar, End). It persists its choice through the app's ApplicationSettings
// (an ElectronSettingsStore is registered) and re-applies it on the next launch.
//
// The template is built in code (a DataTemplate whose factory news up the
// control) so no markup/resource wiring is needed. Added to a composed module's
// ShellControls; call this after app.initialize and BEFORE opening the first
// document, so the ToolbarService picks it up on the document-open rebuild.
export function registerThemeSchemePicker(app: Application): void
{
    const def = new ShellControlDefinition()
    def.Template  = new DataTemplate(() => new ThemeSelector())
    def.Region    = ShellRegion.StatusBar
    def.Alignment = ShellControlAlignment.End

    if (app.Modules.Count === 0) return
    const module = app.Modules.Get(0)
    if (module instanceof ShellModule) module.ShellControls.Add(def)
}
