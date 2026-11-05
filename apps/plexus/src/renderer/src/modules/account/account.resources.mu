// account.resources.mu -- the account area views.
//
// AccountStatusCell: the StatusBar cell (account.module.mu references it by key) -- a pill
// Button showing $Text ("Sign in" / "<email> (<tenant>)") that opens the account dialog.
//
// DataTemplate[AccountDialog]: the account dialog body, shown by DialogService. One panel per
// step (Email, ChooseTenant, Waiting, SignedIn), each shown by its Is<Step>Step flag through
// ToVisibility (the same per-state switch the connection editor and skill dialogs use). The
// Message line (an AccountError sentence) shows under whichever step is active.
//
// Merged app-global by app.mu (`merge AccountResources`).

import AccountStatusItem from "./account-status-item.js"
import AccountDialog from "./account-dialog.js"

resources AccountResources {
    DataTemplate x:key="AccountStatusCell" [ DataType = AccountStatusItem ] {
        Button [ Template = @AccountStatusChrome, Command = $OpenCommand, HorizontalAlignment = Left ] {
            TextBlock [ Text = $Text, Style = @UiCaption, Foreground = @Fg2, VerticalAlignment = Center ]
        }
    }

    // Face chrome: a pill @Bg2 surface with hover/press state layers (as the Background Work
    // and Problems cells).
    Template x:key="AccountStatusChrome" [ TargetType = Button ] {
        Border x:name="PART_Primary" [ Fill = @Bg2, CornerRadius = @RadiusPill ] {
            Border x:name="PART_PrimaryState" [ Fill = #00000000, CornerRadius = @RadiusPill, Padding = (10,3,10,3) ] {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_PrimaryState.Fill = @RowHoverFill; }
        when ( IsPressed ) { PART_PrimaryState.Fill = @Bg3; }
        when ( IsEnabled = false ) { PART_Primary.Opacity = @OpacityDisabled; }
    }

    DataTemplate [ DataType = AccountDialog ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            // Email: the address Plexus discovers the tenant for.
            StackPanel [ Orientation = Vertical, Visibility = $IsEmailStep << ToVisibility ] {
                TextBlock [ Text = "Sign in with your work email.", Style = @Body, Foreground = @Fg1, Margin = (0,0,0,8) ]
                TextBlock [ Text = "Email", Style = @BodySm, Foreground = @Fg2 ]
                TextBox [ Text = $Email, Margin = (0,0,0,6) ]
                Button [ Variant = Text, Command = $UseConsoleAddressCommand, HorizontalAlignment = Left,
                         Visibility = $ShowsUseConsoleLink << ToVisibility ] {
                    TextBlock [ Text = "Use a specific console address" ]
                }
                StackPanel [ Orientation = Vertical, Visibility = $UseConsoleAddress << ToVisibility ] {
                    TextBlock [ Text = "Console address", Style = @BodySm, Foreground = @Fg2 ]
                    TextBox [ Text = $ConsoleAddress, Margin = (0,0,0,4) ]
                    TextBlock [ Text = "For example https://console-yourcompany.example.com", Style = @BodySm,
                                Foreground = @Fg2, TextWrapping = Wrap, Margin = (0,0,0,4) ]
                    Button [ Variant = Text, Command = $UsePlatformCommand, HorizontalAlignment = Left ] {
                        TextBlock [ Text = "Find my organization from my email instead" ]
                    }
                }
            }

            // ChooseTenant: the email has accounts in several tenants.
            StackPanel [ Orientation = Vertical, Visibility = $IsChooseTenantStep << ToVisibility ] {
                TextBlock [ Text = "Your email has accounts in several organizations. Choose one.", Style = @Body,
                            Foreground = @Fg1, TextWrapping = Wrap, Margin = (0,0,0,8) ]
                TextBlock [ Text = "Organization", Style = @BodySm, Foreground = @Fg2 ]
                ComboBox [ ItemsSource = $Tenants, SelectedItem = $SelectedTenant, HorizontalAlignment = Stretch, Margin = (0,0,0,6) ]
            }

            // Waiting: the system browser is open on the tenant's sign-in page.
            StackPanel [ Orientation = Vertical, Visibility = $IsWaitingStep << ToVisibility ] {
                TextBlock [ Text = "Finish signing in in your browser.", Style = @Body, Foreground = @Fg1, TextWrapping = Wrap ]
            }

            // SignedIn.
            StackPanel [ Orientation = Vertical, Visibility = $IsSignedInStep << ToVisibility ] {
                TextBlock [ Text = $SignedInText, Style = @Body, Foreground = @Fg1, TextWrapping = Wrap ]
            }

            TextBlock [ Text = $Message, Style = @BodySm, Foreground = @StateDanger, TextWrapping = Wrap,
                        Margin = (0,6,0,0), Visibility = $HasMessage << ToVisibility ]

            // Actions per step.
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,12,0,0),
                         Visibility = $IsEmailStep << ToVisibility ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ContinueCommand ] { TextBlock [ Text = "Continue" ] }
            }
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,12,0,0),
                         Visibility = $IsChooseTenantStep << ToVisibility ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ContinueCommand ] { TextBlock [ Text = "Continue" ] }
            }
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,12,0,0),
                         Visibility = $IsWaitingStep << ToVisibility ] {
                Button [ Variant = Text, Command = $CancelCommand ] { TextBlock [ Text = "Cancel" ] }
            }
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,12,0,0),
                         Visibility = $IsSignedInStep << ToVisibility ] {
                Button [ Variant = Text, Command = $SignOutCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Sign out" ] }
                Button [ Variant = Filled, Command = $CancelCommand ] { TextBlock [ Text = "Close" ] }
            }
        }
    }
}
