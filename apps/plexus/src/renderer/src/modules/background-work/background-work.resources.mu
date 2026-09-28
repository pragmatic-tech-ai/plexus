// background-work.resources.mu — the Background Work dock (StatusBar region) view.
//
// A MenuButton in the status bar, mirroring the Problems dock (problems.resources.mu):
//   * the FACE (TriggerTemplate) is a pill Button showing $SummaryText
//     ("2 running, 1 queued" / "No background tasks");
//   * clicking it opens a floating popup (MenuPopupHost) listing the tasks, each
//     with a progress bar, a status note, and a cancel button; a "Clear completed"
//     action sits in the header.
// Row click opens the task's output as a document tab (OpenOutputCommand).
//
// The ShellControlDefinition in background-work.module.mu references @BackgroundWorkDock.

import BackgroundWorkService from "./services/background-work-service.js"
import TaskHandle from "./services/task-handle.js"
import TaskOutputDocument from "./services/task-output-document.js"

resources BackgroundWorkResources {
    DataTemplate x:key="BackgroundWorkDock" [ DataType = BackgroundWorkService ] {
        MenuButton
            [ Header              = $SummaryText,
              IsOpen              = $IsOpen,
              Template            = @BackgroundWorkPopup,
              TriggerTemplate     = @BackgroundWorkTrigger,
              HorizontalAlignment = Left ]
    }

    // The MenuButton trigger: PART_Trigger (Button) + PART_TriggerStack +
    // PART_HeaderText are the parts the MenuButton ctor keeps in sync with Header.
    Template x:key="BackgroundWorkTrigger" [ TargetType = MenuButton ] {
        Button x:name="PART_Trigger" [ Template = @BackgroundWorkTriggerChrome ] {
            StackPanel x:name="PART_TriggerStack" [ Orientation = Horizontal, VerticalAlignment = Center ] {
                TextBlock x:name="PART_HeaderText"
                    [ Style = @UiCaption, Foreground = @Fg2, VerticalAlignment = Center ]
            }
        }
    }

    // Face chrome — a pill @Bg2 surface with @Fg2
    // hover/press state layers (same shape as the Problems dock trigger).
    Template x:key="BackgroundWorkTriggerChrome" [ TargetType = Button ] {
        Border x:name="PART_Primary" [ Fill = @Bg2, CornerRadius = @RadiusPill ] {
            Border x:name="PART_PrimaryState" [ Fill = #00000000, CornerRadius = @RadiusPill, Padding = (10,3,10,3) ] {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_PrimaryState.Fill = @OnSurfaceVariantHoverLayer; }
        when ( IsPressed ) { PART_PrimaryState.Fill = @OnSurfaceVariantPressLayer; }
        when ( IsEnabled = false ) { PART_Primary.Opacity = @DisabledContentOpacity; }
    }

    // The popup: preserves the MenuButton popup contract (MenuPopupHost = PART_PopupHost,
    // a PART_Scrim ClickAwayScrim, a PART_PopupContainer Border). Bindings resolve
    // against the templated MenuButton's DataContext = the BackgroundWorkService.
    Template x:key="BackgroundWorkPopup" [ TargetType = MenuButton ] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Width = 420,
                  Fill = @Bg2, Stroke = Pen [ Brush = @Border ],
                  CornerRadius = @RadiusLg, Effect = @ShadowMd, Padding = (0) ] {
                DockPanel [ LastChildFill = true ] {
                    // Header: title + Clear-completed.
                    DockPanel [ DockPanel.Dock = Top, LastChildFill = true, Margin = (8,6,8,6) ] {
                        // A normal Text button (sizes to its label; PanelButton is a
                        // fixed-size IconButton that clipped "Clear completed").
                        Button [ DockPanel.Dock = Right, Variant = Text, Command = $ClearCompletedCommand, VerticalAlignment = Center ] {
                            TextBlock [ Text = "Clear completed", Style = @UiCaption, Foreground = @Fg2 ]
                        }
                        TextBlock [ Text = "Background Tasks", Style = @UiLabel, Foreground = @ControlAccent, VerticalAlignment = Center ]
                    }
                    // Hairline separating the header from the list.
                    Border [ DockPanel.Dock = Top, Height = 1, Fill = @Border ]
                    // The task list (fills the remainder), capped in height.
                    ScrollViewer [ MaxHeight = 320, HorizontalScrollEnabled = false ] {
                        ItemsControl [ ItemsSource = $Tasks, ItemsPanel = @VerticalStackPanel ]
                    }
                }
            }
        }
    }

    // One task row: title (opens output) over a progress bar + note/error, with a
    // cancel button docked right (disabled once the task is done via CanExecute).
    DataTemplate [ DataType = TaskHandle ] {
        DockPanel [ LastChildFill = true, Margin = (4,4,4,4) ] {
            PanelButton [ DockPanel.Dock = Right, Command = $CancelCommand, VerticalAlignment = Top, Margin = (6,0,0,0) ] {
                Shape [ Geometry = @Close, Fill = @Fg2, Width = 12, Height = 12 ]
            }
            StackPanel [ Orientation = Vertical ] {
                Button [ Template = @TabMenuRowButton, Command = $OpenOutputCommand, HorizontalAlignment = Stretch, MinWidth = 320 ] {
                    TextBlock [ Text = $Title, Foreground = @Fg1, VerticalAlignment = Center ]
                }
                ProgressIndicator [ Value = $Progress, IsIndeterminate = $IsIndeterminate, Height = 4,
                                    Margin = (0,2,0,2), Visibility = $IsRunning << ToVisibility ]
                TextBlock [ Text = $Note, Foreground = @Fg2, Style = @UiCaption ]
                TextBlock [ Text = $Error, Foreground = @StateDanger, Style = @UiCaption,
                            Visibility = $Error << ToVisibility ]
                // Re-run affordance for skill runs (Skills #4): re-opens the input
                // form prefilled with this run's inputs.
                Button [ Template = @TabMenuRowButton, Command = $RerunCommand, HorizontalAlignment = Left,
                         Margin = (0,2,0,0), Visibility = $HasRerun << ToVisibility ] {
                    TextBlock [ Text = "Re-run", Foreground = @ControlAccent, Style = @UiCaption ]
                }
            }
        }
    }

    // The output document view: a scrolling, read-only monospace log bound to the
    // task's live Output buffer (two-hop through the constant Handle).
    DataTemplate [ DataType = TaskOutputDocument ] {
        ScrollViewer {
            TextBlock [ Text = $Handle.Output, FontFamily = "monospace", FontSize = 12,
                        Foreground = @Fg1, Margin = (8,8,8,8) ]
        }
    }
}
