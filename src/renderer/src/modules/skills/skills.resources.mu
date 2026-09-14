// skills.resources.mu — the skill input form, shown by DialogService as modal
// content (#3). SkillInputDialogVm wraps the reusable SkillInputFormVm; its
// Confirm/Cancel commands close the dialog with the collected inputs (or
// undefined). Each input renders the control that fits its type: a Checkbox for
// Bool, a ComboBox over $Options for Enum/Selection, a TextBox otherwise. The Run
// button auto-disables via ConfirmCommand.CanExecute until every required input
// is valid.

import SkillInputDialogVm from "./services/skill-input-dialog.js"
import SkillInputVm from "./services/skill-input.js"

resources SkillsResources {

    // One input row: label + the type-appropriate control (mutually exclusive via
    // Visibility). Two-way binds $Value.
    DataTemplate [ DataType = SkillInputVm ] {
        StackPanel [ Orientation = Vertical, Margin = (0,4,0,4) ] {
            TextBlock [ Text = $Label, Style = @LabelMedium, Foreground = @OnSurfaceVariant, Margin = (0,0,0,2) ]
            Checkbox [ IsChecked = $Value, Visibility = $IsBool << ToVisibility ]
            ComboBox [ ItemsSource = $Options, SelectedItem = $Value, HorizontalAlignment = Stretch, Visibility = $IsChoice << ToVisibility ]
            TextBox [ Text = $Value, HorizontalAlignment = Stretch, Visibility = $IsPlain << ToVisibility ]
        }
    }

    // The dialog body: the generated input list + Cancel / Run.
    DataTemplate [ DataType = SkillInputDialogVm ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            ItemsControl [ ItemsSource = $Inputs, ItemsPanel = @VerticalStackPanel ]
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,14,0,0) ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand ] { TextBlock [ Text = "Run" ] }
            }
        }
    }
}
