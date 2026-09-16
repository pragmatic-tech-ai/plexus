// title-bar.resources.mu — the mural-painted app title bar.
//
// Set as EditorShell.HeaderContent in app.mu, this fills the shell's top Header
// region (PART_HeaderHost) — a full-width 32dp strip:
//   • a 48dp logo box on the left, painted the shared @Surface chrome tone with
//     the rail's 1dp @OutlineVariant right divider, so the rail column reads as
//     continuing to the top-left corner. It holds the Plexus brand mark — the
//     SolariaMark (the same "signal" mark the boot splash animates): a green
//     self-node with a soft glow inside its ring, three beams reaching out to
//     three hologram nodes, and a faint world ring. Distilled to legible stroke
//     weights for the ~28dp box (the splash's fine dashed detail is sub-pixel
//     here); drawn as flat vector Ellipse/Line shapes in the mark's greens.
//   • the title text, bound to $service(TitleService).Title (active document,
//     else open project, else "Plexus").
//
// The strip is only PAINTED here; OS window-dragging + the native caption
// buttons stay HTML/OS concerns (a transparent #drag-strip in index.html gives
// the drag affordance, the Window Controls Overlay draws the buttons). The band
// reserves ~140dp on the right so a long title never slides under those buttons.
//
// Merged into Application.Resources by app.mu; referenced there as
// `HeaderContent = @PlexusTitleBar`.

// The title feed the strip binds ($service(TitleService).Title) — imported so
// the compiler knows the symbol.
import TitleService from "./title-service.js"
import DiagramExportService from "../modules/diagram-export/services/diagram-export-service.js"

resources PlexusTitleBar {
    Border x:key="PlexusTitleBar" [ Height = 32, Fill = @Surface ] {
        DockPanel [ LastChildFill = true ] {
            // Logo box — same @Surface chrome as the rail below (and the title,
            // status bar, window background): one flat VSCode-style frame tone.
            Border [ DockPanel.Dock = Left, Width = 48, Fill = @Surface ] {
                // SolariaMark, centred in the 48×32 box (~28dp). Ellipses position
                // via Canvas.Left/Top (top-left of the bounding box); hollow rings
                // set only a Pen Stroke (no Fill), filled nodes set Fill. Drawn
                // back-to-front: world ring, beams, holograms, then the self node.
                Canvas [ Width = 48, Height = 32 ] {
                    // the near-empty world — one faint ring
                    Ellipse [ Width = 26, Height = 26, Canvas.Left = 11, Canvas.Top = 3,
                              Stroke = Pen [ Brush = #3D3B36, Thickness = 0.6 ], Opacity = 0.5 ]
                    // viewing beams: the self reaches out to three holograms
                    Line [ X1 = 20.4, Y1 = 13.4, X2 = 29, Y2 = 11,
                           Stroke = Pen [ Brush = #2EA862, Thickness = 0.6 ], Opacity = 0.5 ]
                    Line [ X1 = 20.4, Y1 = 13.4, X2 = 30, Y2 = 19.4,
                           Stroke = Pen [ Brush = #2EA862, Thickness = 0.6 ], Opacity = 0.5 ]
                    Line [ X1 = 20.4, Y1 = 13.4, X2 = 18.4, Y2 = 21,
                           Stroke = Pen [ Brush = #2EA862, Thickness = 0.6 ], Opacity = 0.5 ]
                    // holograms: seen, not met — small green nodes
                    Ellipse [ Width = 2, Height = 2, Fill = #2EA862, Canvas.Left = 28, Canvas.Top = 10, Opacity = 0.75 ]
                    Ellipse [ Width = 2, Height = 2, Fill = #2EA862, Canvas.Left = 29, Canvas.Top = 18.4, Opacity = 0.75 ]
                    Ellipse [ Width = 2, Height = 2, Fill = #2EA862, Canvas.Left = 17.4, Canvas.Top = 20, Opacity = 0.75 ]
                    // the self, alone in its estate: ring, soft glow, bright node
                    Ellipse [ Width = 10, Height = 10, Canvas.Left = 15.4, Canvas.Top = 8.4,
                              Stroke = Pen [ Brush = #2EA862, Thickness = 0.7 ], Opacity = 0.55 ]
                    Ellipse [ Width = 6.4, Height = 6.4, Fill = #2EA862, Canvas.Left = 17.2, Canvas.Top = 10.2, Opacity = 0.22 ]
                    Ellipse [ Width = 4, Height = 4, Fill = #2EA862, Canvas.Left = 18.4, Canvas.Top = 11.4 ]
                }
            }
            // 1dp divider continuing the rail's right edge up through the strip.
            Line [ DockPanel.Dock = Left, Orientation = Vertical, Stroke = (@OutlineVariant, 1) ]
            // File menu — click-to-open dropdown; Export ▸ SVG / PPTX bound to the
            // same commands the diagram context menu uses. MenuButton self-manages
            // open/close (trigger toggles IsOpen; scrim + item activation close it).
            MenuButton
                [ DockPanel.Dock    = Left,
                  Header            = "File",
                  Template          = @FileMenuPopup,
                  TriggerTemplate   = @FileMenuTrigger,
                  VerticalAlignment = Center ]
            // Title — active document / open project / "Plexus". Right margin keeps
            // it clear of the ~138dp Window-Controls-Overlay caption buttons.
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

    // Flat rectangular menu-bar button face with @OnSurfaceVariant hover/press layers
    // (no pill — this is a menu-bar button, not a status pill).
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
    // no wide min label — just a tight padded row with the label filling and the
    // submenu chevron pinned right (PART_Chevron is a @ChevronRight Shape whose
    // Visibility MenuItem.refreshRow toggles when the item has children — mural
    // 0.46.0 made the chevron a Shape, not a ▶ TextBlock). Hover/press/disabled
    // use the same OnSurfaceVariant state layers as the File trigger.
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
    // a PART_PopupContainer Border. The Export MenuItem sits in a plain vertical
    // StackPanel so its submenu cascades RIGHT (a MenuStrip parent would anchor it
    // below). SVG/PPTX bind to the SP1 export commands via $service.
    Template x:key="FileMenuPopup" [ TargetType = MenuButton ] {
        MenuPopupHost x:name="PART_PopupHost" {
            ClickAwayScrim x:name="PART_Scrim"
            Border x:name="PART_PopupContainer"
                [ Fill = @SurfaceContainerHigh, Stroke = Pen [ Brush = @OutlineVariant ],
                  CornerRadius = @ShapeExtraSmall, Effect = @Elevation2, Padding = (4) ] {
                // Shrink-wrap to the items (like the diagram context menu). The
                // default menu row reserves a 24dp leading-icon gutter + an 80dp
                // min label — right for icon-bearing menus, but these export items
                // carry no icons, so it read as an oversized, sparsely-padded menu.
                // @CompactMenuItemRow drops the icon gutter and the wide min label
                // (keeping the ▶ chevron slot) so the rows shrink-wrap to the text.
                StackPanel [ Orientation = Vertical ] {
                    MenuItem [ Header = "Export…", RowTemplate = @CompactMenuItemRow, Command = $service(DiagramExportService).OpenExportDialogCommand ]
                }
            }
        }
    }
}
