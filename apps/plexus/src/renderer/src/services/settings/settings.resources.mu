// settings.resources.mu — view resources for the settings PAGE (the center
// content region). Merged app-global by app.mu (`merge SettingsResources`).
//
// The activity-bar footer gear is NO LONGER declared here: the framework rail
// renders NavigationService.FooterActions, and Plexus contributes the settings
// gear as a footer RailAction via PlexusSettingsContribution (see
// settings-contribution.ts + app.mu). This file keeps only the page/row
// DataTemplates the framework SettingsLauncherService presents in the content
// host — @VerticalStackPanel and theme tokens resolve from the merged resources.

import SettingsPage from "./settings-page.js"
import SettingsCategory from "./settings-page.js"
import BooleanSettingRow from "./settings-page.js"
import NumberSettingRow from "./settings-page.js"
import StringSettingRow from "./settings-page.js"
import ColorSettingRow from "./settings-page.js"
import ChoiceSettingRow from "./settings-page.js"
import FilePathSettingRow from "./settings-page.js"

resources SettingsResources {
    // ── Settings page (center content region) ───────────────────────────
    // Rendered when the gear Views a SettingsPage: a titled column of category
    // sections.
    // Shown as the body of the modal settings dialog (DialogService). The dialog
    // surface supplies the @Surface background, padding, and the "Settings"
    // headline, so the body is just the scrollable category list — the
    // ScrollViewer keeps a long settings list bounded within the dialog's
    // MaxHeight (HorizontalScrollEnabled = false so rows measure to the dialog
    // width and wrap/scroll only vertically).
    DataTemplate [ DataType = SettingsPage ] {
        ScrollViewer [ HorizontalScrollEnabled = false ] {
            ItemsControl [ ItemsSource = $Categories, ItemsPanel = @VerticalStackPanel ]
        }
    }

    // A category section — title over its rows.
    DataTemplate [ DataType = SettingsCategory ] {
        StackPanel [ Orientation = Vertical, Margin = (0,0,0,28) ] {
            TextBlock [ Style = @TitleMedium, Text = $Name, Foreground = @OnSurface, Margin = (0,0,0,10) ]
            ItemsControl [ ItemsSource = $Rows, ItemsPanel = @VerticalStackPanel ]
        }
    }

    // ── Per-Kind setting rows ────────────────────────────────────────────
    // Each binds its editor TwoWay to $Setting.Value; the label column shows the
    // setting's Label + Description.

    DataTemplate [ DataType = BooleanSettingRow ] {
        DockPanel [ LastChildFill = true, Margin = (0,7,0,7) ] {
            Switch [ DockPanel.Dock = Right, IsChecked = $Setting.Value, VerticalAlignment = Center ]
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Style = @BodyLarge,  Text = $Label,       Foreground = @OnSurface ]
                TextBlock [ Style = @BodySmall,  Text = $Description, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    DataTemplate [ DataType = NumberSettingRow ] {
        DockPanel [ LastChildFill = true, Margin = (0,7,0,7) ] {
            SpinEdit [ DockPanel.Dock = Right, Width = 130, Height = 32,
                       Value = $Setting.Value, Minimum = $Minimum, Maximum = $Maximum,
                       VerticalAlignment = Center ]
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Style = @BodyLarge,  Text = $Label,       Foreground = @OnSurface ]
                TextBlock [ Style = @BodySmall,  Text = $Description, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    DataTemplate [ DataType = StringSettingRow ] {
        StackPanel [ Orientation = Vertical, Margin = (0,7,0,7) ] {
            TextBlock [ Style = @BodyLarge,  Text = $Label,       Foreground = @OnSurface ]
            TextBlock [ Style = @BodySmall,  Text = $Description, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            TextBox   [ Text = $Setting.Value, Margin = (0,4,0,0) ]
        }
    }

    DataTemplate [ DataType = ColorSettingRow ] {
        DockPanel [ LastChildFill = true, Margin = (0,7,0,7) ] {
            BrushPicker [ DockPanel.Dock = Right, Width = 220, Brush = $Setting.Value, VerticalAlignment = Center ]
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Style = @BodyLarge,  Text = $Label,       Foreground = @OnSurface ]
                TextBlock [ Style = @BodySmall,  Text = $Description, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    DataTemplate [ DataType = ChoiceSettingRow ] {
        DockPanel [ LastChildFill = true, Margin = (0,7,0,7) ] {
            ComboBox [ DockPanel.Dock = Right, Width = 200,
                       ItemsSource = $Choices, SelectedItem = $Setting.Value,
                       VerticalAlignment = Center ]
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Style = @BodyLarge,  Text = $Label,       Foreground = @OnSurface ]
                TextBlock [ Style = @BodySmall,  Text = $Description, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    DataTemplate [ DataType = FilePathSettingRow ] {
        StackPanel [ Orientation = Vertical, Margin = (0,7,0,7) ] {
            TextBlock [ Style = @BodyLarge,  Text = $Label,       Foreground = @OnSurface ]
            TextBlock [ Style = @BodySmall,  Text = $Description, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            DockPanel [ LastChildFill = true, Margin = (0,4,0,0) ] {
                Button  [ DockPanel.Dock = Right, Variant = Outlined, Command = $BrowseCommand, Margin = (8,0,0,0) ] {
                    TextBlock [ Text = "Browse…" ]
                }
                TextBox [ Text = $Setting.Value ]
            }
        }
    }
}
