// connection-inspection.resources.mu — the read-only connection-inspection dialog's view (merged in app.mu).
// A DataTemplate over ConnectionInspectionViewModel: a header row (the GitHub mark for a GitHub store,
// the reachability banner, and the signed-in identity, all on one line), then the token's scopes and
// the packages it can see. The lists hold bare strings, which ItemsControl renders as TextBlocks by
// default (tinted via the attached TextBlock.Foreground). Scopes and Packages each get their own capped
// ScrollViewer, so both sections stay visible at once — a token with many scopes would otherwise push
// Packages off-screen. The OK button stays pinned below. The per-section notes explain an empty list
// and are shown only when non-empty.

import ConnectionInspectionViewModel from "./connection-inspection-dialog-model.js"

resources ConnectionInspectionResources {
    DataTemplate [ DataType = ConnectionInspectionViewModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            // Header row: the GitHub mark (only for a GitHub Packages store) leads the reachability
            // banner — the message with a check mark only when the registry answered (no negation
            // converter, so failure is the message without the mark) — and the signed-in identity
            // sits on the SAME line, separated by a dot.
            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center, Margin = (0,0,0,12) ] {
                Shape [ Geometry = @Github, Fill = @Fg1, Width = 22, Height = 22, VerticalAlignment = Center, Visibility = $IsGitHub << ToVisibility, Margin = (0,0,8,0) ]
                TextBlock [ Text = "✓", Foreground = @ControlAccent, VerticalAlignment = Center, Visibility = $Ok << ToVisibility, Margin = (0,0,6,0) ]
                TextBlock [ Text = $Message, Foreground = @Fg1, VerticalAlignment = Center ]
                StackPanel [ Orientation = Horizontal, VerticalAlignment = Center, Visibility = $HasIdentity << ToVisibility ] {
                    TextBlock [ Text = " · ", Foreground = @Fg2 ]
                    TextBlock [ Text = "Signed in as ", Foreground = @Fg2 ]
                    TextBlock [ Text = $Identity, Foreground = @Fg1 ]
                }
            }

            StackPanel [ Orientation = Vertical, Visibility = $Ok << ToVisibility ] {
                TextBlock [ Style = @H4, Text = "Scopes", Foreground = @Fg1, Margin = (0,0,0,4) ]
                ScrollViewer [ MaxHeight = 200, HorizontalScrollEnabled = false ] {
                    ItemsControl [ ItemsSource = $Scopes, ItemsPanel = @VerticalStackPanel, TextBlock.Foreground = @Fg1 ]
                }
                TextBlock [ Style = @BodySm, Text = $ScopesNote, Foreground = @Fg2, Visibility = $ScopesNote << ToVisibility, Margin = (0,0,0,10) ]
            }

            StackPanel [ Orientation = Vertical, Visibility = $Ok << ToVisibility ] {
                TextBlock [ Style = @H4, Text = "Packages", Foreground = @Fg1, Margin = (0,10,0,4) ]
                ScrollViewer [ MaxHeight = 200, HorizontalScrollEnabled = false ] {
                    ItemsControl [ ItemsSource = $Packages, ItemsPanel = @VerticalStackPanel, TextBlock.Foreground = @Fg1 ]
                }
                TextBlock [ Style = @BodySm, Text = $PackagesNote, Foreground = @Fg2, Visibility = $PackagesNote << ToVisibility ]
            }

            // Dismiss: always shown (not gated by Ok), so a failed test can still be closed.
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,8,0,0) ] {
                Button [ Variant = Filled, Command = $OkCommand ] { TextBlock [ Text = "OK" ] }
            }
        }
    }
}
