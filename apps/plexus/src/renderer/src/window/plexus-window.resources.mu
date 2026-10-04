// Plexus's window-chrome slots for the shared PragmaticWindowChrome module: the
// brand mark (@WindowBrand) drawn in the title bar's 48×32 box, and the menu
// bar (@WindowMenu) — a MenuButton per menu, each carrying its OWN inline
// MenuItem children (hosted natively by @WindowMenuPopup's ItemsPresenter, not
// a hardcoded items slot). The strip layout + menu chrome come from the module;
// these two ControlTemplates are the Plexus-specific fills the module hosts via
// ContentControl[Template].
import DiagramExportService from "../modules/diagram-export/services/diagram-export-service.js"
import ProjectCommandsService from "@pragmatic-tech-ai/plexus-core/renderer/modules/solution-explorer/services/project-commands-service.js"
import EditCommandsService from "../services/menu/edit-commands-service.js"
import ViewCommandsService from "../services/menu/view-commands-service.js"
import HelpCommandsService from "../services/menu/help-commands-service.js"

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

    // The menu bar — one MenuButton per menu, Template = @WindowMenuPopup (the
    // shared chrome from the module) hosting this MenuButton's OWN inline
    // MenuItem children natively. RowTemplate = @CompactMenuItemRow is the
    // shared compact row from the module; MenuSeparator divides each menu's
    // groups. This bar lives in EditorShell.HeaderContent, so each MenuItem's
    // inherited ServiceScope IS the shell scope (root.createScope()): $service(X)
    // resolves root-registered command services (File/Edit/View-zoom/Help) by
    // walking UP to the root AND shell-scoped services (NavigationService) on the
    // scope itself — resolution happens once, when the title bar's ControlTemplate
    // first applies.
    Template x:key="WindowMenu" [ TargetType = ContentControl ] {
        // A ControlTemplate has exactly one root visual, so the four menus sit
        // in one horizontal StackPanel (MenuButton self-manages its own
        // open/close popup; the strip just lays them out left to right).
        StackPanel [ Orientation = Horizontal ] {
            // File: project lifecycle, then document save, then export, then
            // close-all. Export… opens the diagram export dialog — the same
            // command the diagram context menu binds.
            MenuButton
                [ Header            = "File",
                  Template          = @WindowMenuPopup,
                  TriggerTemplate   = @FileMenuTrigger,
                  VerticalAlignment = Center ] {
                MenuItem [ Header = "New Project",  RowTemplate = @CompactMenuItemRow, Command = $service(ProjectCommandsService).NewProjectCommand ]
                MenuItem [ Header = "Open Project", RowTemplate = @CompactMenuItemRow, Command = $service(ProjectCommandsService).OpenProjectCommand ]
                MenuSeparator
                MenuItem [ Header = "Save",     RowTemplate = @CompactMenuItemRow, Command = $service(ContentHostService).SaveActiveCommand ]
                MenuItem [ Header = "Save All", RowTemplate = @CompactMenuItemRow, Command = $service(ContentHostService).SaveAllCommand ]
                MenuSeparator
                MenuItem [ Header = "Export…", RowTemplate = @CompactMenuItemRow, Command = $service(DiagramExportService).OpenExportDialogCommand ]
                MenuSeparator
                MenuItem [ Header = "Close All", RowTemplate = @CompactMenuItemRow, Command = $service(ContentHostService).CloseAllCommand ]
            }
            // Edit: Undo/Redo bridge to the active diagram's own History; Cut/
            // Copy/Paste bridge to the active view — see EditCommandsService.
            MenuButton
                [ Header            = "Edit",
                  Template          = @WindowMenuPopup,
                  TriggerTemplate   = @FileMenuTrigger,
                  VerticalAlignment = Center ] {
                MenuItem [ Header = "Undo", RowTemplate = @CompactMenuItemRow, Command = $service(EditCommandsService).UndoCommand ]
                MenuItem [ Header = "Redo", RowTemplate = @CompactMenuItemRow, Command = $service(EditCommandsService).RedoCommand ]
                MenuSeparator
                MenuItem [ Header = "Cut",   RowTemplate = @CompactMenuItemRow, Command = $service(EditCommandsService).CutCommand ]
                MenuItem [ Header = "Copy",  RowTemplate = @CompactMenuItemRow, Command = $service(EditCommandsService).CopyCommand ]
                MenuItem [ Header = "Paste", RowTemplate = @CompactMenuItemRow, Command = $service(EditCommandsService).PasteCommand ]
            }
            // View: zoom bridges to the active diagram's camera; Side Bar/
            // Problems are genuine toggles; Agent Chat is a show/focus (its
            // dock panel is permanent — see ViewCommandsService.ShowAgentChatCommand).
            MenuButton
                [ Header            = "View",
                  Template          = @WindowMenuPopup,
                  TriggerTemplate   = @FileMenuTrigger,
                  VerticalAlignment = Center ] {
                MenuItem [ Header = "Zoom In",    RowTemplate = @CompactMenuItemRow, Command = $service(ViewCommandsService).ZoomInCommand ]
                MenuItem [ Header = "Zoom Out",   RowTemplate = @CompactMenuItemRow, Command = $service(ViewCommandsService).ZoomOutCommand ]
                MenuItem [ Header = "Reset Zoom", RowTemplate = @CompactMenuItemRow, Command = $service(ViewCommandsService).ResetZoomCommand ]
                MenuSeparator
                MenuItem [ Header = "Toggle Side Bar", RowTemplate = @CompactMenuItemRow, Command = $service(NavigationService).ToggleSidePaneCommand ]
                MenuItem [ Header = "Toggle Problems", RowTemplate = @CompactMenuItemRow, Command = $service(ViewCommandsService).ToggleProblemsCommand ]
                MenuItem [ Header = "Agent Chat",      RowTemplate = @CompactMenuItemRow, Command = $service(ViewCommandsService).ShowAgentChatCommand ]
            }
            // Help: About + Keyboard Shortcuts open read-only dialogs; Quit
            // routes through the host-chrome WindowService seam (confirmCloseDocs
            // still guards unsaved work on the way out).
            MenuButton
                [ Header            = "Help",
                  Template          = @WindowMenuPopup,
                  TriggerTemplate   = @FileMenuTrigger,
                  VerticalAlignment = Center ] {
                MenuItem [ Header = "About Plexus…",       RowTemplate = @CompactMenuItemRow, Command = $service(HelpCommandsService).ShowAboutCommand ]
                MenuItem [ Header = "Keyboard Shortcuts…", RowTemplate = @CompactMenuItemRow, Command = $service(HelpCommandsService).ShowShortcutsCommand ]
                MenuSeparator
                MenuItem [ Header = "Quit", RowTemplate = @CompactMenuItemRow, Command = $service(HelpCommandsService).QuitCommand ]
            }
        }
    }
}
