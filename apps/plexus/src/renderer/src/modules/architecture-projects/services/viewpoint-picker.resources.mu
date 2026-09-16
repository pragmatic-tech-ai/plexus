// viewpoint-picker.resources.mu — the diagram-viewpoints picker dialog. Shown by
// DialogService as modal content (it supplies the surface/title/padding); the
// VM's Confirm/Cancel commands close it with the chosen ids (or undefined). A
// checkbox list over $Rows makes the "which viewpoints govern this diagram"
// choice, used both at diagram creation and when editing the scope.

import ViewpointPickerModel from "./viewpoint-picker.js"
import PickerRow from "./viewpoint-picker.js"

resources ViewpointPickerResources {

    // One viewpoint row: a checkbox two-waying PickerRow.IsSelected + its label.
    // DockPanel/LastChildFill gives the label the remaining width so it wraps.
    DataTemplate [ DataType = PickerRow ] {
        DockPanel [ LastChildFill = true, Margin = (0,3,0,3) ] {
            Checkbox [ DockPanel.Dock = Left, IsChecked = $IsSelected, VerticalAlignment = Top, Margin = (0,2,8,0) ]
            TextBlock [ Text = $Label, Style = @BodyMedium, Foreground = @OnSurface, TextWrapping = Wrap ]
        }
    }

    // The dialog body: the checklist + Cancel / Confirm. Confirm stays disabled
    // until at least one viewpoint is checked (CanConfirm enforces the ≥1 rule).
    DataTemplate [ DataType = ViewpointPickerModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodySmall, TextWrapping = Wrap, Foreground = @OnSurfaceVariant, Margin = (0,0,0,10),
                        Text = "Choose the viewpoints that govern what can be added to this diagram." ]
            ItemsControl [ ItemsSource = $Rows, ItemsPanel = @VerticalStackPanel ]
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,14,0,0) ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand, IsEnabled = $CanConfirm ] { TextBlock [ Text = "Confirm" ] }
            }
        }
    }
}
