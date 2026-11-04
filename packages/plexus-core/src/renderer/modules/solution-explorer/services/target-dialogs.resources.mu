// target-dialogs.resources.mu -- the environment pickers shown by DialogService.
//
// DataTemplate[ContributeTargetDialog]: Contribute to graph -- a Development environment and one
// of its graphs. DataTemplate[PublishTargetDialog]: Publish to tenant -- a Runtime environment.
// One template per picker, its parts shown by the VM's flags through ToVisibility (as the account
// dialog). Signed out, only the Message sentence and a Sign in button (which asks the account
// module to open its dialog) are shown; signed in, the choosers and the confirm button. The
// Message line carries the one sentence that explains why the action cannot go ahead. The
// environment ComboBox items are EnvironmentChoice VMs: mural's ComboBox shows an item's Label
// ("dev", "qa (stopped)") in both the selection box and the drop-down rows. The confirm buttons
// follow ConfirmCommand's CanExecute (mural >= 0.66.2: a Button is disabled while its command
// cannot execute), so they are enabled only once the picker is ready.
//
// Merged app-global by app.mu (`merge TargetDialogsResources`).

import ContributeTargetDialog from "./contribute-target-dialog.js"
import PublishTargetDialog from "./publish-target-dialog.js"

resources TargetDialogsResources {
    DataTemplate [ DataType = ContributeTargetDialog ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            StackPanel [ Orientation = Vertical, Visibility = $HasEnvironments << ToVisibility ] {
                TextBlock [ Text = "Environment", Style = @BodySm, Foreground = @Fg2 ]
                ComboBox [ ItemsSource = $Environments, SelectedItem = $SelectedEnvironment, HorizontalAlignment = Stretch, Margin = (0,0,0,8) ]
            }
            StackPanel [ Orientation = Vertical, Visibility = $HasGraphs << ToVisibility ] {
                TextBlock [ Text = "Graph", Style = @BodySm, Foreground = @Fg2 ]
                ComboBox [ ItemsSource = $Graphs, SelectedItem = $SelectedGraph, HorizontalAlignment = Stretch, Margin = (0,0,0,8) ]
            }

            TextBlock [ Text = $Message, Style = @Body, Foreground = @Fg1, TextWrapping = Wrap,
                        Visibility = $HasMessage << ToVisibility ]

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,12,0,0),
                         Visibility = $NeedsSignIn << ToVisibility ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $SignInCommand ] { TextBlock [ Text = "Sign in" ] }
            }
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,12,0,0),
                         Visibility = $IsSignedIn << ToVisibility ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand ] { TextBlock [ Text = "Contribute" ] }
            }
        }
    }

    DataTemplate [ DataType = PublishTargetDialog ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            StackPanel [ Orientation = Vertical, Visibility = $HasEnvironments << ToVisibility ] {
                TextBlock [ Text = "Environment", Style = @BodySm, Foreground = @Fg2 ]
                ComboBox [ ItemsSource = $Environments, SelectedItem = $SelectedEnvironment, HorizontalAlignment = Stretch, Margin = (0,0,0,8) ]
            }

            TextBlock [ Text = $Message, Style = @Body, Foreground = @Fg1, TextWrapping = Wrap,
                        Visibility = $HasMessage << ToVisibility ]

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,12,0,0),
                         Visibility = $NeedsSignIn << ToVisibility ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $SignInCommand ] { TextBlock [ Text = "Sign in" ] }
            }
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,12,0,0),
                         Visibility = $IsSignedIn << ToVisibility ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand ] { TextBlock [ Text = "Publish" ] }
            }
        }
    }
}
