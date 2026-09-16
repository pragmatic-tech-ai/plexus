// PragmaticWindowChrome — the shared, mural-painted app title bar.
//
// The first genuinely shared renderer module: a `module { … }` block whose
// `resources:` merge app-global when the app calls AddModule (@PragmaticTitleBar
// + the menu-bar chrome templates), and whose `.services:` registers the shared
// TitleService. The strip is a full-width 32dp band — a 48dp brand box on the
// left (continuing the rail's top-left corner), a File menu, and the title text
// bound to $service(TitleService).Title — reserving ~140dp on the right so a long
// title never slides under the Window-Controls-Overlay caption buttons.
//
// Each app: mounts @PragmaticTitleBar in its shell's header, registers an
// ITitleSource under TitleSourceKey, and supplies two resource-key slots —
//   • @WindowBrand     — a ControlTemplate drawing the app's brand mark (48×32).
//   • @WindowMenuItems — a ControlTemplate of the app's File-menu items.
// The strip layout, the WCO reserve, and the menu look are shared; only the
// brand mark, the menu items, and the title source are app-specific.
//
// The strip is only PAINTED here; OS window-dragging + the native caption
// buttons stay HTML/OS concerns (a transparent #drag-strip in index.html gives
// the drag affordance, the Window Controls Overlay draws the buttons).
import TitleService from "./title-service.js"

module PragmaticWindowChrome {
    .services: {
        TitleService
    }

    resources: {
        Border x:key="PragmaticTitleBar" [ Height = 32, Fill = @Surface ] {
            DockPanel [ LastChildFill = true ] {
                // Brand box — the app supplies @WindowBrand (its mark), drawn in
                // the 48×32 chrome-toned box.
                Border [ DockPanel.Dock = Left, Width = 48, Fill = @Surface ] {
                    ContentControl [ Template = @WindowBrand ]
                }
                // 1dp divider continuing the rail's right edge up through the strip.
                Line [ DockPanel.Dock = Left, Orientation = Vertical, Stroke = (@OutlineVariant, 1) ]
                // File menu — click-to-open dropdown; items come from the app's
                // @WindowMenuItems slot. MenuButton self-manages open/close.
                MenuButton
                    [ DockPanel.Dock    = Left,
                      Header            = "File",
                      Template          = @FileMenuPopup,
                      TriggerTemplate   = @FileMenuTrigger,
                      VerticalAlignment = Center ]
                // Title — active document / open project / app name. Right margin
                // keeps it clear of the ~138dp caption buttons.
                TextBlock
                    [ Text              = $service(TitleService).Title,
                      Foreground        = @OnSurfaceVariant,
                      FontSize          = 12,
                      VerticalAlignment = Center,
                      Margin            = (12,0,140,0) ]
            }
        }

        // The File trigger: PART_Trigger (Button) + PART_TriggerStack + PART_HeaderText
        // are the parts MenuButton keeps in sync with Header ("File").
        Template x:key="FileMenuTrigger" [ TargetType = MenuButton ] {
            Button x:name="PART_Trigger" [ Template = @FileMenuTriggerChrome ] {
                StackPanel x:name="PART_TriggerStack" [ Orientation = Horizontal, VerticalAlignment = Center ] {
                    TextBlock x:name="PART_HeaderText"
                        [ FontSize = 12, Foreground = @OnSurfaceVariant, VerticalAlignment = Center ]
                }
            }
        }

        // Flat rectangular menu-bar button face with @OnSurfaceVariant hover/press layers.
        Template x:key="FileMenuTriggerChrome" [ TargetType = Button ] {
            Border x:name="PART_Primary" [ Fill = #00000000, CornerRadius = @ShapeExtraSmall ] {
                Border x:name="PART_PrimaryState" [ Fill = #00000000, CornerRadius = @ShapeExtraSmall, Padding = (10,4,10,4) ] {
                    ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
                }
            }
            when ( IsMouseOver ) { PART_PrimaryState.Fill = @OnSurfaceVariantHoverLayer; }
            when ( IsPressed )   { PART_PrimaryState.Fill = @OnSurfaceVariantPressLayer; }
        }

        // Compact menu row for the icon-less File menu: no 24dp leading-icon gutter,
        // no wide min label — a tight padded row with the label filling and the
        // submenu chevron pinned right. Hover/press/disabled use the same
        // OnSurfaceVariant state layers as the File trigger.
        Template x:key="CompactMenuItemRow" [ TargetType = MenuItem ] {
            Border x:name="PART_Row" [ Fill = #00000000, CornerRadius = @ShapeExtraSmall, Padding = (10,4,10,4) ] {
                DockPanel [ LastChildFill = true ] {
                    Shape x:name="PART_Chevron"
                        [ DockPanel.Dock   = Right,
                          Geometry          = @ChevronRight,
                          Fill              = @OnSurfaceVariant,
                          Width             = 5,
                          Height            = 10,
                          Margin            = (12,0,0,0),
                          VerticalAlignment = Center,
                          Visibility        = Collapsed ]
                    TextBlock x:name="PART_Gesture" [ DockPanel.Dock = Right, Foreground = @OnSurfaceVariant ]
                    TextBlock x:name="PART_Label"   [ Foreground = @OnSurface ]
                }
            }
            when ( IsMouseOver )       { PART_Row.Fill = @OnSurfaceVariantHoverLayer; }
            when ( IsSubmenuOpen )     { PART_Row.Fill = @OnSurfaceVariantHoverLayer; }
            when ( IsPressed )         { PART_Row.Fill = @OnSurfaceVariantPressLayer; }
            when ( IsEnabled = false ) { PART_Row.Opacity = @DisabledContentOpacity; }
        }

        // The File dropdown: MenuPopupHost = PART_PopupHost, a PART_Scrim ClickAwayScrim,
        // a PART_PopupContainer Border. The app's items (a ControlTemplate at
        // @WindowMenuItems) are hosted in a ContentControl so the popup structure +
        // look stay shared while each app contributes its own items.
        Template x:key="FileMenuPopup" [ TargetType = MenuButton ] {
            MenuPopupHost x:name="PART_PopupHost" {
                ClickAwayScrim x:name="PART_Scrim"
                Border x:name="PART_PopupContainer"
                    [ Fill = @SurfaceContainerHigh, Stroke = Pen [ Brush = @OutlineVariant ],
                      CornerRadius = @ShapeExtraSmall, Effect = @Elevation2, Padding = (4) ] {
                    ContentControl [ Template = @WindowMenuItems ]
                }
            }
        }
    }
}
