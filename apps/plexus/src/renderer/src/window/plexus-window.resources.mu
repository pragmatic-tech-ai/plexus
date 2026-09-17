// Plexus's window-chrome slots for the shared PragmaticWindowChrome module: the
// brand mark (@WindowBrand) drawn in the title bar's 48×32 box, and the File-menu
// items (@WindowMenuItems). The strip layout + menu chrome come from the module;
// these two ControlTemplates are the Plexus-specific fills the module hosts via
// ContentControl[Template].
import DiagramExportService from "../modules/diagram-export/services/diagram-export-service.js"

resources PlexusWindowChrome {
    // The SolariaMark — the "signal" brand mark (the same mark the boot splash
    // animates): a green self-node with a soft glow inside its ring, three beams
    // reaching out to three hologram nodes, and a faint world ring. Distilled to
    // legible stroke weights for the ~28dp box; flat vector Ellipse/Line shapes in
    // the mark's greens. Ellipses position via Canvas.Left/Top (top-left of the
    // bounding box); hollow rings set only a Pen Stroke, filled nodes set Fill.
    Template x:key="WindowBrand" [ TargetType = ContentControl ] {
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

    // File-menu items — Export… opens the diagram export dialog, bound to the same
    // command the diagram context menu uses. RowTemplate = @CompactMenuItemRow is
    // the shared compact row from the module.
    Template x:key="WindowMenuItems" [ TargetType = ContentControl ] {
        StackPanel [ Orientation = Vertical ] {
            MenuItem [ Header = "Export…", RowTemplate = @CompactMenuItemRow, Command = $service(DiagramExportService).OpenExportDialogCommand ]
        }
    }
}
