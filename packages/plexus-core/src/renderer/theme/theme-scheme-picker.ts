import type { Application } from '@pragmatic-tech-ai/mural/runtime'
import { DataTemplate } from '@pragmatic-tech-ai/mural/basic'
import {
    ShellControlAlignment,
    ShellControlDefinition,
    ShellModule,
    ShellRegion,
    ThemeSelector,
} from '@pragmatic-tech-ai/mural/framework'

// ThemeSchemePicker — contributes the framework ThemeSelector (theme + scheme
// picker, incl. the "Custom…" base-colour flow) as a right-aligned status-bar
// shell control, via the universal ShellControlDefinition path. ThemeSelector
// talks to the global ThemeManager directly, so it needs no DataContext; the shell
// only has to place it (StatusBar, End). It persists its choice through the app's
// ApplicationSettings (an app-registered settings store) and re-applies it on the
// next launch.
//
// Shared by both apps so the colour-scheme picker looks and behaves the same. The
// template is built in code (a DataTemplate whose factory news up the control) so
// no markup/resource wiring is needed.
export class ThemeSchemePicker
{
    // Add the picker to the app's first composed ShellModule's ShellControls. Call
    // after `app.initialize` and BEFORE the first document opens, so the
    // ToolbarService picks it up on the document-open rebuild.
    public static register(app: Application): void
    {
        const def = new ShellControlDefinition()
        def.Template  = new DataTemplate(() => new ThemeSelector())
        def.Region    = ShellRegion.StatusBar
        def.Alignment = ShellControlAlignment.End

        if (app.Modules.Count === 0) return
        const module = app.Modules.Get(0)
        if (module instanceof ShellModule) module.ShellControls.Add(def)
    }
}
