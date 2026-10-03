// shortcuts-dialog.resources.mu — the Keyboard Shortcuts dialog body.
//
// Renders ShortcutsDialogVm as DialogService modal content: a scrollable
// list of the app's hand-maintained shortcut entries (ShortcutEntry —
// Gesture + Description), each row via its own nested DataTemplate. No
// commands, no actions row — dismissed via the scrim / Escape.
//
// Merged app-global by app.mu (`merge ShortcutsDialogResources`) so
// DialogService.Show({ Content: vm }) resolves this template by data type.

import ShortcutsDialogVm from "./shortcuts-dialog.js"
import ShortcutEntry from "./shortcuts-dialog.js"

resources ShortcutsDialogResources {

    DataTemplate [ DataType = ShortcutEntry ] {
        DockPanel [ LastChildFill = true, Margin = (0,4,0,4) ] {
            TextBlock [ DockPanel.Dock = Left, Style = @Body, Text = $Gesture, Foreground = @Fg1, Width = 160 ]
            TextBlock [ Style = @Body, Text = $Description, Foreground = @Fg2 ]
        }
    }

    // No explicit width/height here: the dialog's single height cap is the
    // DialogService DialogOptions MaxHeight (HelpCommandsService.showShortcuts),
    // and width composes from the DialogOptions Width + the rows' intrinsic size.
    // The ScrollViewer still scrolls — the capped dialog bounds its height, and
    // the list overflows into the scroller when it exceeds that bound.
    DataTemplate [ DataType = ShortcutsDialogVm ] {
        ScrollViewer [ HorizontalScrollEnabled = false ] {
            ItemsControl [ ItemsSource = $Entries ]
        }
    }
}
