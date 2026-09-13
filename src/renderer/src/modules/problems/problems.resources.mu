// problems.resources.mu — the Problems dock (Status-region) view.
//
// The dock is a MenuButton in the StatusBar region. Its face and its popup rows
// deliberately match the document-content-host ⋯ extended-commands dropdown
// (services/document-tabs/document-tabs.resources.mu):
//
//   * the FACE is a regular Button restyled with @ProblemsTriggerChrome — the
//     same pill @SurfaceContainerHigh surface + @OnSurfaceVariant hover/press
//     state layers as that dropdown's @TabOverflowTrigger, but hosting the
//     problem summary ($SummaryText) instead of a three-dots glyph;
//   * each popup ROW reuses @TabMenuRowButton verbatim — the same left-aligned,
//     full-width transparent hit surface the dropdown's rows use. Both keys are
//     app-global (merged by app.mu), so this cross-module reference resolves.
//
// Clicking the face opens a FLOATING popup (MenuPopupHost) that overlays the
// content above the bar rather than growing the status bar. IsOpen binds the
// service's IsOpen so a failed publish can force the popup open (Expand()).
//
// The ShellControlDefinition in problems.module.mu references @ProblemsDock.

import ProblemsService from "./problems-service.js"
import ProblemsRow from "./problems-service.js"

resources ProblemsResources {
    DataTemplate x:key="ProblemsDock" [ DataType = ProblemsService ] {
        MenuButton
            [ Header              = $SummaryText,
              IsOpen              = $IsOpen,
              Template            = @ProblemsPopup,
              TriggerTemplate     = @ProblemsDockTrigger,
              HorizontalAlignment = Left ]
    }

    // The MenuButton trigger: root PART_Trigger is a Button (MenuButton's
    // trigger contract), PART_TriggerStack + PART_HeaderText are the parts its
    // ctor keeps in sync with the Header DP. The Button wears @ProblemsTriggerChrome
    // for the dropdown-face look.
    Template x:key="ProblemsDockTrigger" [ TargetType = MenuButton ] {
        Button x:name="PART_Trigger" [ Template = @ProblemsTriggerChrome ] {
            StackPanel x:name="PART_TriggerStack" [ Orientation = Horizontal, VerticalAlignment = Center ] {
                TextBlock x:name="PART_HeaderText"
                    [ Style = @LabelMedium, Foreground = @OnSurfaceVariant, VerticalAlignment = Center ]
            }
        }
    }

    // Face chrome — mirrors document-tabs' @TabOverflowTrigger (pill
    // @SurfaceContainerHigh surface, @OnSurfaceVariant state layers), sized for a
    // text summary rather than a single glyph. ContentPresenter shows the
    // trigger's PART_TriggerStack.
    Template x:key="ProblemsTriggerChrome" [ TargetType = Button ] {
        Border x:name="PART_Primary" [ Fill = @SurfaceContainerHigh, CornerRadius = @ShapeFull ] {
            Border x:name="PART_PrimaryState" [ Fill = #00000000, CornerRadius = @ShapeFull, Padding = (10,3,10,3) ] {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { PART_PrimaryState.Fill = @OnSurfaceVariantHoverLayer; }
        when ( IsPressed ) { PART_PrimaryState.Fill = @OnSurfaceVariantPressLayer; }
        when ( IsEnabled = false ) { PART_Primary.Opacity = @DisabledContentOpacity; }
    }

    // The list's virtualizing panel — a fixed row height keeps virtualization
    // cheap (rows are single-line).
    ItemsPanelTemplate x:key="ProblemsListPanel" {
        VirtualizingStackPanel [ Orientation = Vertical, ItemHeight = 28 ]
    }

    // Panel-consistent chrome for the severity toggles: the same transparent
    // surface + hover/press state layers a PanelButton uses, but as a ToggleButton
    // hosting its count. A checked (filter-on) toggle fills with @SecondaryContainer;
    // unchecked (filter hidden) dims so the "off" state reads at a glance.
    Template x:key="PanelToggle" [ TargetType = ToggleButton ] {
        Border x:name="PART_Border" [ Fill = #00000000, CornerRadius = @ShapeSmall ] {
            Border x:name="PART_StateLayer" [ Fill = #00000000, CornerRadius = @ShapeSmall, Padding = (8,3,8,3) ] {
                ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsChecked = true ) { PART_StateLayer.Fill = @SecondaryContainer; }
        when ( IsChecked = false ) { PART_Border.Opacity = @DisabledContentOpacity; }
        when ( IsMouseOver ) { PART_StateLayer.Fill = @OnSurfaceVariantHoverLayer; }
        when ( IsPressed ) { PART_StateLayer.Fill = @OnSurfaceVariantPressLayer; }
    }

    // The popup control template. Preserves the MenuButton popup contract (root
    // MenuPopupHost = PART_PopupHost, a PART_Scrim ClickAwayScrim, a
    // PART_PopupContainer Border) and adds a header/toolbar above a height-capped,
    // virtualized ItemsControl bound to $Rows. Data bindings ($Rows, $ListMaxHeight,
    // $ShowErrors, …) resolve against the templated MenuButton's DataContext, which
    // is the ProblemsService (from the @ProblemsDock DataTemplate).
    Template x:key="ProblemsPopup" [ TargetType = MenuButton ] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Width = $PopupWidth,
                  Fill = @SurfaceContainerHigh, Stroke = Pen [ Brush = @OutlineVariant ],
                  CornerRadius = @ShapeExtraSmall, Effect = @Elevation2, Padding = (0) ] {
                DockPanel [ LastChildFill = true ] {
                    // Header + toolbar (docked Top).
                    DockPanel [ DockPanel.Dock = Top, LastChildFill = true, Margin = (8,6,8,6) ] {
                        // Right cluster: copy-all + clear (panel buttons).
                        StackPanel [ DockPanel.Dock = Right, Orientation = Horizontal, VerticalAlignment = Center ] {
                            PanelButton [ Command = $CopyAllCommand, Margin = (4,0,0,0) ] {
                                Shape [ Geometry = @Copy, Fill = @OnSurfaceVariant, Width = 16, Height = 16 ]
                            }
                            PanelButton [ Command = $ClearFiltersCommand, Margin = (4,0,0,0) ] {
                                Shape [ Geometry = @FilterOff, Fill = @OnSurfaceVariant, Width = 16, Height = 16 ]
                            }
                        }
                        // Left cluster: title + severity toggles + filter box.
                        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                            TextBlock [ Text = "Problems", Style = @TitleMedium, Foreground = @OnSurface, VerticalAlignment = Center, Margin = (0,0,12,0) ]
                            ToggleButton [ Template = @PanelToggle, IsChecked = $ShowErrors, VerticalAlignment = Center, Margin = (0,0,4,0) ] {
                                TextBlock [ Text = $ErrorCount, Style = @LabelMedium, Foreground = @OnSurfaceVariant ]
                            }
                            ToggleButton [ Template = @PanelToggle, IsChecked = $ShowWarnings, VerticalAlignment = Center, Margin = (0,0,12,0) ] {
                                TextBlock [ Text = $WarningCount, Style = @LabelMedium, Foreground = @OnSurfaceVariant ]
                            }
                            TextBox [ Text = $FilterText, Variant = Plain, MinWidth = 120, VerticalAlignment = Center ]
                        }
                    }
                    // Hairline separating the header/toolbar from the list.
                    Border [ DockPanel.Dock = Top, Height = 1, Fill = @OutlineVariant ]
                    // Capped, virtualized list (fills the remainder).
                    ScrollViewer [ MaxHeight = $ListMaxHeight, HorizontalScrollEnabled = false ] {
                        ItemsControl [ ItemsSource = $Rows, ItemsPanel = @ProblemsListPanel ]
                    }
                }
            }
        }
    }

    // One row: copy button (docked left) + activate button (fills). Siblings, not
    // nested — clicking copy never triggers navigation. Project-header rows carry no
    // command, so both buttons are inert for them. The activate button reuses the
    // same @TabMenuRowButton chrome the document-host ⋯ dropdown uses.
    DataTemplate [ DataType = ProblemsRow ] {
        DockPanel [ LastChildFill = true ] {
            PanelButton [ DockPanel.Dock = Left, Command = $CopyCommand, VerticalAlignment = Center, Margin = (4,0,8,0) ] {
                Shape [ Geometry = @Copy, Fill = @OnSurfaceVariant, Width = 14, Height = 14 ]
            }
            Button [ Template = @TabMenuRowButton, Command = $ActivateCommand, HorizontalAlignment = Stretch, MinWidth = 240 ] {
                DockPanel [ LastChildFill = true ] {
                    TextBlock [ DockPanel.Dock = Right, Text = $Detail, Foreground = @OnSurfaceVariant, VerticalAlignment = Center, Margin = (12,0,0,0) ]
                    TextBlock [ Text = $Label, Foreground = @OnSurface, VerticalAlignment = Center ]
                }
            }
        }
    }
}
