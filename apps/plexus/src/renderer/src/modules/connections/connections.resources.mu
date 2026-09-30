// connections.resources.mu — the connection editor dialog's view (merged in app.mu).
// A DataTemplate over ConnectionEditorDialogModel: the npm-shaped New/Edit form DialogService
// renders as the dialog body (it supplies the surface + title). Fields two-way bind to the VM;
// the token row toggles between a stored-secret box and an env-var name box. Save is enabled
// only when CanConfirm (name + registry, and an env-var name in env mode).

import ConnectionEditorDialogModel from "./connection-editor-dialog-model.js"

resources ConnectionsResources {
    DataTemplate [ DataType = ConnectionEditorDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodySm, Text = "Display name", Foreground = @Fg2, Margin = (0,0,0,2) ]
            TextBox [ Text = $DisplayName, Margin = (0,0,0,10) ]

            TextBlock [ Style = @BodySm, Text = "Registry URL", Foreground = @Fg2, Margin = (0,0,0,2) ]
            TextBox [ Text = $Registry, Margin = (0,0,0,10) ]

            TextBlock [ Style = @BodySm, Text = "Scope (optional)", Foreground = @Fg2, Margin = (0,0,0,2) ]
            TextBox [ Text = $Scope, Margin = (0,0,0,10) ]

            StackPanel [ Orientation = Horizontal, Margin = (0,0,0,8) ] {
                Checkbox [ IsChecked = $UseEnvToken ]
                TextBlock [ Text = "Use environment variable for token", Foreground = @Fg1, VerticalAlignment = Center, Margin = (6,0,0,0) ]
            }

            Border [ Visibility = $UseEnvToken << ToVisibility ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @BodySm, Text = "Environment variable", Foreground = @Fg2, Margin = (0,0,0,2) ]
                    TextBox [ Text = $EnvVar, Margin = (0,0,0,10) ]
                }
            }
            Border [ Visibility = $UseStoredToken << ToVisibility ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @BodySm, Text = "Token (stored securely; leave blank to keep)", Foreground = @Fg2, Margin = (0,0,0,2) ]
                    TextBox [ Text = $Secret, Margin = (0,0,0,10) ]
                }
            }

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,6,0,0) ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand, IsEnabled = $CanConfirm ] { TextBlock [ Text = "Save" ] }
            }
        }
    }
}
