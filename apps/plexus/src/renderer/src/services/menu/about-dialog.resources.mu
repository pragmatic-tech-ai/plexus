// about-dialog.resources.mu — the About Plexus dialog body.
//
// Renders AboutDialogVm as DialogService modal content: the app name as a
// heading, then the host version info (EnvironmentService's startup
// snapshot) as a stack of read-only rows. No commands, no actions row —
// dismissed via the scrim / Escape (DialogOptions.DismissOnScrimClick
// defaults true) or the DialogService.Title bar's own close affordance.
//
// Merged app-global by app.mu (`merge AboutDialogResources`) so
// DialogService.Show({ Content: vm }) resolves this template by data type.

import AboutDialogVm from "./about-dialog.js"

resources AboutDialogResources {

    DataTemplate [ DataType = AboutDialogVm ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @H3, Text = $AppName, Foreground = @Fg1, Margin = (0,0,0,4) ]
            TextBlock [ Style = @Body, Text = $AppVersionLabel, Foreground = @Fg1, Margin = (0,0,0,16) ]
            TextBlock [ Style = @BodySm, Text = $ElectronVersionLabel, Foreground = @Fg2 ]
            TextBlock [ Style = @BodySm, Text = $ChromeVersionLabel, Foreground = @Fg2 ]
            TextBlock [ Style = @BodySm, Text = $NodeVersionLabel, Foreground = @Fg2 ]
            TextBlock [ Style = @BodySm, Text = $PlatformLabel, Foreground = @Fg2 ]
            TextBlock [ Style = @BodySm, Text = $ArchitectureLabel, Foreground = @Fg2 ]
        }
    }
}
