// save-prompt.resources.mu — the "unsaved changes" dialog body.
//
// Renders SavePromptModel as DialogService modal content (DialogService supplies
// the surface, title, and padding). A wrapped message over a right-aligned
// Cancel / Don't Save / Save row. Save is Filled as the primary affordance; the
// Save/Don't-Save labels come from the VM so the one template serves both the
// tab-close ("Save" / "Don't Save") and quit ("Save All" / "Discard All") cases.
// Mirrors the ConfirmDialogModel template in project-explorer.resources.mu.

import SavePromptModel from "./save-prompt-model.js"

resources SavePromptResources {

    DataTemplate [ DataType = SavePromptModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodyLarge, Text = $Message, Foreground = @OnSurface, TextWrapping = Wrap, Margin = (0,0,0,16) ]
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Text, Command = $DontSaveCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = $DontSaveLabel ] }
                Button [ Variant = Filled, Command = $SaveCommand ] { TextBlock [ Text = $SaveLabel ] }
            }
        }
    }
}
