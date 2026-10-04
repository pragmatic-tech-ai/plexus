// project-explorer.resources.mu -- the SHARED Confirm dialog template.
//
// The other dialog bodies (New Project, Manage References, Set Version, Open Project)
// moved to solution-explorer/solution-dialogs.resources.mu. ConfirmDialogModel's
// template stays here because it is shared (save-prompt and every destructive confirm
// resolve it). This whole file is deleted with project-explorer in Task 15, when the
// Confirm template is rehomed.

import ConfirmDialogModel from "../../dialogs/confirm-dialog-model.js"

resources ProjectExplorerResources {

    // -- Confirm dialog -----------------------------------------------------
    // A reusable message + Cancel / confirm pair (DialogService supplies the
    // title/surface). The confirm button's label comes from the VM so it reads
    // as the action ("Delete"); it's Filled to sit as the primary affordance.
    // ShowCancel (default true) hides the Cancel button for an OK-only info dialog.
    DataTemplate [ DataType = ConfirmDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @Body, Text = $Message, Foreground = @Fg1, TextWrapping = Wrap, Margin = (0,0,0,16) ]
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0), Visibility = $ShowCancel << ToVisibility ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand ] { TextBlock [ Text = $ConfirmLabel ] }
            }
        }
    }
}
