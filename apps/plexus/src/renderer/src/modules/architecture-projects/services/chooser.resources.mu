// chooser.resources.mu — the drop-candidate chooser popup. A hidden MenuButton
// whose floating popup lists the candidate (X,m) actions for an ambiguous
// term-drop. IsOpen / Rows bind the DropCandidateChooserService (the host's
// DataContext at the mount site — the diagram canvas overlay). Mirrors the
// Problems dock popup contract (MenuPopupHost + ClickAwayScrim + container).

import DropCandidateChooserService from "./drop-candidate-chooser-service.js"
import ChooserRow from "./drop-candidate-chooser-service.js"

resources ChooserResources {

    ItemsPanelTemplate x:key="ChooserListPanel" {
        VirtualizingStackPanel [ Orientation = Vertical, ItemHeight = 28 ]
    }

    // A candidate row: a full-width button that invokes its pick Command.
    DataTemplate [ DataType = ChooserRow ] {
        Button [ Command = $Command, HorizontalAlignment = Stretch, MinWidth = 220 ] {
            TextBlock [ Text = $Label, HorizontalAlignment = Left, Margin = (10,4,10,4) ]
        }
    }

    // The popup control template: preserves the MenuButton popup contract.
    Template x:key="ChooserPopup" [ TargetType = MenuButton ] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill = @SurfaceContainerHigh, Stroke = Pen [ Brush = @OutlineVariant ],
                  CornerRadius = @ShapeSmall, MinWidth = 240 ] {
                ScrollViewer [ MaxHeight = 320, HorizontalScrollEnabled = false ] {
                    ItemsControl [ ItemsSource = $Rows, ItemsPanel = @ChooserListPanel ]
                }
            }
        }
    }

    // A near-invisible trigger; the popup floats from here. IsOpen is driven by
    // the service, not by clicking the trigger.
    Template x:key="ChooserTrigger" [ TargetType = MenuButton ] {
        Button x:name="PART_Trigger" [ Width = 1, Height = 1, Opacity = 0 ]
    }

    // Implicit host template for the service: a MenuButton overlay bound to it.
    DataTemplate [ DataType = DropCandidateChooserService ] {
        MenuButton
            [ IsOpen          = $IsOpen,
              Template        = @ChooserPopup,
              TriggerTemplate = @ChooserTrigger,
              HorizontalAlignment = Left, VerticalAlignment = Top ]
    }
}
