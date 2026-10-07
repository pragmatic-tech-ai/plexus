// connection-inspection.resources.mu — the read-only connection-inspection dialog's view (merged in app.mu).
// A DataTemplate over ConnectionInspectionViewModel: the reachability banner, the signed-in identity,
// the token's scopes and the packages it can see. The lists hold bare strings, which ItemsControl
// renders as TextBlocks by default (tinted via the attached TextBlock.Foreground). The packages list
// scrolls (capped, no fixed height); the per-section notes explain an empty list and are shown only
// when non-empty.

import ConnectionInspectionViewModel from "./connection-inspection-dialog-model.js"

resources ConnectionInspectionResources {
    DataTemplate [ DataType = ConnectionInspectionViewModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            // Reachability banner: the message, with a check mark only when the registry answered
            // (there is no negation converter, so failure is the message without the mark).
            StackPanel [ Orientation = Horizontal, Margin = (0,0,0,10) ] {
                TextBlock [ Text = "✓", Foreground = @ControlAccent, Visibility = $Ok << ToVisibility, Margin = (0,0,6,0) ]
                TextBlock [ Text = $Message, Foreground = @Fg1 ]
            }

            StackPanel [ Orientation = Horizontal, Visibility = $HasIdentity << ToVisibility, Margin = (0,0,0,10) ] {
                TextBlock [ Text = "Signed in as ", Foreground = @Fg2 ]
                TextBlock [ Text = $Identity, Foreground = @Fg1 ]
            }

            TextBlock [ Style = @BodySm, Text = "Scopes", Foreground = @Fg2, Margin = (0,0,0,2) ]
            ItemsControl [ ItemsSource = $Scopes, ItemsPanel = @VerticalStackPanel, TextBlock.Foreground = @Fg1 ]
            TextBlock [ Style = @BodySm, Text = $ScopesNote, Foreground = @Fg2, Visibility = $ScopesNote << ToVisibility, Margin = (0,0,0,10) ]

            TextBlock [ Style = @BodySm, Text = "Packages", Foreground = @Fg2, Margin = (0,6,0,2) ]
            ScrollViewer [ MaxHeight = 320, HorizontalScrollEnabled = false ] {
                ItemsControl [ ItemsSource = $Packages, ItemsPanel = @VerticalStackPanel, TextBlock.Foreground = @Fg1 ]
            }
            TextBlock [ Style = @BodySm, Text = $PackagesNote, Foreground = @Fg2, Visibility = $PackagesNote << ToVisibility ]
        }
    }
}
