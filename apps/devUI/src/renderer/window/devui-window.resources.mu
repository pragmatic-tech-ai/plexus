// devUI's window-chrome slots for the shared PragmaticWindowChrome module: the
// brand mark (@WindowBrand) drawn in the title bar's 48×32 box, and the File-menu
// items (@WindowMenuItems). The strip layout + menu chrome come from the module;
// these two ControlTemplates are the devUI-specific fills the module hosts via
// ContentControl[Template].
import DevUiWindowCommands from "./devui-window-commands.ts"

resources DevUiWindowChrome {
    // The TODL package mark, distilled to legible stroke weights for the ~28dp box:
    // a rounded package box with a lid seam and an accent self-node. Themed tokens
    // (@OutlineVariant / @Primary) so it re-tints with the scheme. Flat vector
    // Border/Line/Ellipse; ellipses position via Canvas.Left/Top (top-left of the
    // bounding box); hollow rings set only a Pen Stroke, the filled node sets Fill.
    Template x:key="WindowBrand" [ TargetType = ContentControl ] {
        Canvas [ Width = 48, Height = 32 ] {
            // the package box + lid seam
            Border [ Width = 20, Height = 20, Canvas.Left = 14, Canvas.Top = 6,
                     CornerRadius = 5, Fill = #00000000,
                     Stroke = Pen [ Brush = @OutlineVariant, Thickness = 1.2 ] ]
            Line [ X1 = 14, Y1 = 13, X2 = 34, Y2 = 13,
                   Stroke = Pen [ Brush = @OutlineVariant, Thickness = 1 ], Opacity = 0.8 ]
            // the self node: ring + bright accent dot
            Ellipse [ Width = 9, Height = 9, Canvas.Left = 19.5, Canvas.Top = 14,
                      Stroke = Pen [ Brush = @Primary, Thickness = 1 ], Opacity = 0.6 ]
            Ellipse [ Width = 4.5, Height = 4.5, Fill = @Primary, Canvas.Left = 21.75, Canvas.Top = 16.25 ]
        }
    }

    // File-menu items — Reload reloads the renderer (the one genuinely useful File
    // action for a viewer). RowTemplate = @CompactMenuItemRow is the shared compact
    // row from the module.
    Template x:key="WindowMenuItems" [ TargetType = ContentControl ] {
        StackPanel [ Orientation = Vertical ] {
            MenuItem [ Header = "Reload", RowTemplate = @CompactMenuItemRow, Command = $service(DevUiWindowCommands).ReloadCommand ]
        }
    }
}
