// PragmaticWindowChrome — the shared, mural-painted app title bar.
//
// The first genuinely shared renderer module: a `module { … }` block whose
// `resources:` merge app-global when the app calls AddModule (@PragmaticTitleBar
// + the menu-bar chrome templates), and whose `.services:` registers the shared
// TitleService. The strip is a full-width 32dp band — a 48dp brand box on the
// left (continuing the rail's top-left corner), the app's menu button(s), and the title text
// bound to $service(TitleService).Title — reserving ~140dp on the right so a long
// title never slides under the Window-Controls-Overlay caption buttons.
//
// Each app: mounts @PragmaticTitleBar in its shell's header, registers an
// ITitleSource under TitleSourceKey, and supplies two resource-key slots —
//   • @WindowBrand — a ControlTemplate drawing the app's brand mark (48×32).
//   • @WindowMenu  — a ControlTemplate hosting the app's menu button(s)
//                    (each a MenuButton with its OWN inline MenuItem children —
//                    see @WindowMenuPopup, which hosts those items natively via
//                    an ItemsPresenter, not a hardcoded items slot).
// The strip layout, the WCO reserve, and the menu look are shared; only the
// brand mark, the menu button(s), and the title source are app-specific.
//
// The strip is only PAINTED here; OS window-dragging + the native caption
// buttons stay HTML/OS concerns (a transparent #drag-strip in index.html gives
// the drag affordance, the Window Controls Overlay draws the buttons).
import TitleService from "./title-service.js"

shell module PragmaticWindowChrome {
    .services: {
        TitleService
    }

    resources: {
        // The strip is a ControlTemplate (not a raw Border) so its themed visuals
        // — the MenuButton especially — instantiate LAZILY when the app applies it,
        // after the theme is active. A module's resources are built at module-load
        // (before app.mu sets the theme), so an eager MenuButton here would throw
        // for want of its default style. The app mounts it via
        // `HeaderContent = ContentControl [ Template = @PragmaticTitleBar ]`.
        Template x:key="PragmaticTitleBar" [ TargetType = ContentControl ] {
            Border [ Height = 32, Fill = @Bg1 ] {
                DockPanel [ LastChildFill = true ] {
                    // Brand box — the app supplies @WindowBrand (its mark), drawn in
                    // the 48×32 chrome-toned box.
                    Border [ DockPanel.Dock = Left, Width = 48, Fill = @Bg1 ] {
                        ContentControl [ Template = @WindowBrand ]
                    }
                    // 1dp divider continuing the rail's right edge up through the strip.
                    Line [ DockPanel.Dock = Left, Orientation = Vertical, Stroke = (@Border, 1) ]
                    // Menu bar — the app supplies @WindowMenu (its MenuButton(s),
                    // each carrying its own inline MenuItem children). MenuButton
                    // self-manages open/close.
                    ContentControl [ DockPanel.Dock = Left, Template = @WindowMenu ]
                    // Title — active document / open project / app name. Right margin
                    // keeps it clear of the ~138dp caption buttons.
                    TextBlock
                        [ Text              = $service(TitleService).Title,
                          Foreground        = @Fg2,
                          FontSize          = 12,
                          VerticalAlignment = Center,
                          Margin            = (12,0,140,0) ]
                }
            }
        }

        // The File trigger: PART_Trigger (Button) + PART_TriggerStack + PART_HeaderText
        // are the parts MenuButton keeps in sync with Header ("File").
        Template x:key="FileMenuTrigger" [ TargetType = MenuButton ] {
            Button x:name="PART_Trigger" [ Template = @FileMenuTriggerChrome ] {
                StackPanel x:name="PART_TriggerStack" [ Orientation = Horizontal, VerticalAlignment = Center ] {
                    TextBlock x:name="PART_HeaderText"
                        [ FontSize = 12, Foreground = @Fg2, VerticalAlignment = Center ]
                }
            }
        }

        // Flat rectangular menu-bar button face with @Fg2 hover/press layers.
        Template x:key="FileMenuTriggerChrome" [ TargetType = Button ] {
            Border x:name="PART_Primary" [ Fill = #00000000, CornerRadius = @RadiusSm ] {
                Border x:name="PART_PrimaryState" [ Fill = #00000000, CornerRadius = @RadiusSm, Padding = (8,4,8,4) ] {
                    ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
                }
            }
            when ( IsMouseOver ) { PART_PrimaryState.Fill = @RowHoverFill; }
            when ( IsPressed )   { PART_PrimaryState.Fill = @Bg3; }
        }

        // Compact menu row for the icon-less File menu: no 24dp leading-icon gutter,
        // no wide min label — a tight padded row with the label filling and the
        // submenu chevron pinned right. Hover/press/disabled use the same
        // OnSurfaceVariant state layers as the File trigger.
        Template x:key="CompactMenuItemRow" [ TargetType = MenuItem ] {
            Border x:name="PART_Row" [ Fill = #00000000, CornerRadius = @RadiusSm, Padding = (10,4,10,4) ] {
                DockPanel [ LastChildFill = true ] {
                    Shape x:name="PART_Chevron"
                        [ DockPanel.Dock   = Right,
                          Geometry          = @ChevronRight,
                          Fill              = @Fg2,
                          Width             = 5,
                          Height            = 10,
                          Margin            = (12,0,0,0),
                          VerticalAlignment = Center,
                          Visibility        = Collapsed ]
                    TextBlock x:name="PART_Gesture" [ DockPanel.Dock = Right, Foreground = @Fg2 ]
                    TextBlock x:name="PART_Label"   [ Foreground = @Fg1 ]
                }
            }
            when ( IsMouseOver )       { PART_Row.Fill = @RowHoverFill; }
            when ( IsSubmenuOpen )     { PART_Row.Fill = @RowHoverFill; }
            when ( IsPressed )         { PART_Row.Fill = @Bg3; }
            when ( IsEnabled = false ) { PART_Row.Opacity = @OpacityDisabled; }
        }

        // The shared menu-bar dropdown: MenuPopupHost = PART_PopupHost, a
        // PART_Scrim ClickAwayScrim, a PART_PopupContainer Border. The body is
        // a bare ItemsPresenter — mural's MenuButton locates it by TYPE (see
        // ItemsControl.findFirstItemsPresenter), not by name, and hosts the
        // MenuButton's OWN MenuItem children there. This lets ANY MenuButton
        // reuse this popup chrome while supplying its own inline items (no
        // hardcoded single-slot ContentControl). Reusable across all menu-bar
        // buttons (File, Edit, View, Help — Task 6).
        Template x:key="WindowMenuPopup" [ TargetType = MenuButton ] {
            MenuPopupHost x:name="PART_PopupHost" {
                ClickAwayScrim x:name="PART_Scrim"
                Border x:name="PART_PopupContainer"
                    [ Fill = @Bg2, Stroke = Pen [ Brush = @Border ],
                      CornerRadius = @RadiusLg, Effect = @ShadowMd, Padding = (4) ] {
                    ItemsPresenter
                }
            }
        }
    }
}
