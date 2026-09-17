import ConnectionsManagerVM from "./connections-manager-vm.ts"
import ConnectionVM from "./connection-vm.ts"

resources ConnectionsResources {
    // The Connections capability's side panel — a New-connection toolbar + status
    // over the connection list (SelectedItem two-way-binds the picked ConnectionVM).
    // The selected connection's editor is NOT here: it is pushed into the central
    // content host and rendered there by DataTemplate[ConnectionVM] below.
    DataTemplate [DataType = ConnectionsManagerVM] {
        DockPanel [ LastChildFill = true ] {
            ToolBar [ DockPanel.Dock = Top ] {
                ToolBarButton [ Command = $New, Text = "New connection", ShowText = true ]
            }
            TextBlock [ DockPanel.Dock = Top, Margin = (8,4,8,4), Text = $Status, TextWrapping = Wrap ]
            ListBox [ ItemsSource = $Connections, SelectedItem = $Selected, ItemTemplate = @ConnectionRow ]
        }
    }

    // One connection row in the master list — its one-line summary (name + default
    // marker + token state).
    DataTemplate x:key="ConnectionRow" [DataType = ConnectionVM] {
        TextBlock [ Text = $Summary, Margin = (4,2,4,2) ]
    }

    // The selected connection's editor (detail pane). The registry settings, then
    // an authentication section (a write-only token OR an env-var name), then Test.
    DataTemplate [DataType = ConnectionVM] {
        ScrollViewer {
            StackPanel [ Orientation = Vertical, Margin = (4) ] {
                TextBlock [ Text = "Name", Margin = (0,0,0,2) ]
                TextBox   [ Text = $Name, Margin = (0,0,0,8) ]
                TextBlock [ Text = "Registry URL", Margin = (0,0,0,2) ]
                TextBox   [ Text = $Registry, Margin = (0,0,0,8) ]
                TextBlock [ Text = "Scope", Margin = (0,0,0,2) ]
                TextBox   [ Text = $Scope, Margin = (0,0,0,8) ]
                TextBlock [ Text = "Organization", Margin = (0,0,0,2) ]
                TextBox   [ Text = $Org, Margin = (0,0,0,8) ]
                TextBlock [ Text = "GitHub API", Margin = (0,0,0,2) ]
                TextBox   [ Text = $GithubApi, Margin = (0,0,0,12) ]

                StackPanel [ Orientation = Horizontal, Margin = (0,0,0,12) ] {
                    Button [ Command = $Save,        Content = "Save",        Margin = (0,0,6,0) ]
                    Button [ Command = $MakeDefault, Content = "Set default", Margin = (0,0,6,0) ]
                    Button [ Command = $Remove,      Content = "Remove" ]
                }

                TextBlock [ Text = "Authentication", FontWeight = Bold, Margin = (0,0,0,6) ]
                // Pick how this connection authenticates; only the chosen block shows.
                RadioButtonGroup [ ItemsSource = $AuthModes, SelectedItem = $AuthMode, Margin = (0,0,0,10) ]

                // Token value: paste a token, stored encrypted.
                StackPanel [ Orientation = Vertical, Visibility = $IsTokenMode << ToVisibility, Margin = (0,0,0,4) ] {
                    TextBlock [ Text = "Token (paste to store, encrypted)", Margin = (0,0,0,2) ]
                    TextBox   [ Text = $Token, Margin = (0,0,0,4) ]
                    Button    [ Command = $SaveToken, Content = "Save token" ]
                }

                // Environment variable holding the token.
                StackPanel [ Orientation = Vertical, Visibility = $IsEnvMode << ToVisibility, Margin = (0,0,0,4) ] {
                    TextBlock [ Text = "Environment variable name", Margin = (0,0,0,2) ]
                    ComboBox  [ ItemsSource = $EnvVars, SelectedItem = $TokenEnvVar, HorizontalAlignment = Stretch, Margin = (0,0,0,4) ]
                    Button    [ Command = $UseEnv, Content = "Use env var" ]
                }

                Button    [ Command = $Test, Content = "Test connection", Margin = (0,0,0,6) ]
                TextBlock [ Text = $Status, TextWrapping = Wrap ]
            }
        }
    }
}
