// solution-explorer.resources.mu — the Solution Explorer's left-panel view (P2).
//
// Renders SolutionExplorerService: a small command bar (the surviving Open / New
// project commands, surfaced by the capability as pass-throughs to the lifecycle
// ProjectExplorerService), a hairline, an empty-state line, and ONE virtualized
// TreeView over the hierarchy. The tree is a single HierarchicalDataTemplate for
// HierarchyItemVM whose `itemsselector = Children` recurses to arbitrary depth;
// the framework's default TreeView chrome supplies chevrons, indent, hover and
// selection. Read-only in P2: no context menu, no rename slot, no drag. Mirrors
// project-explorer.resources.mu's chrome.

import SolutionExplorerService from "./services/solution-explorer-service.js"
import HierarchyItemVM from "@pragmatic-tech-ai/mural/framework/hierarchy"
import IconKeyToGeometry from "./services/icon-key-to-geometry.js"

resources SolutionExplorerResources {

    // One hierarchy row: leading icon (IconKey → geometry via IconKeyToGeometry) +
    // caption, in a transparent Border. itemsselector = Children recurses the
    // template down the tree.
    HierarchicalDataTemplate x:key="HierarchyItemTemplate"
        [ DataType = HierarchyItemVM, itemsselector = Children ] {
        Border x:root [ Fill = #00000000 ] {
            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                Shape [ Geometry = $IconKey << IconKeyToGeometry, Fill = @Fg2,
                        Width = 16, Height = 16, Margin = (0,0,6,0), VerticalAlignment = Center ]
                TextBlock [ Text = $Caption, Style = @Body, VerticalAlignment = Center ]
            }
        }
    }

    // Command bar docked top (Open / New project — the surviving lifecycle commands,
    // surfaced by the capability), a hairline, the empty-state line pinned bottom, and
    // the virtualized hierarchy TreeView filling the space between.
    DataTemplate [ DataType = SolutionExplorerService ] {
        DockPanel [ LastChildFill = true, Margin = (8,8,8,8) ] {
            StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,8) ] {
                PanelButton [ Margin = (0,0,4,0), Command = $OpenProjectCommand ] {
                    Shape [ Geometry = @Folder, Fill = @Fg2, Width = 20, Height = 20 ]
                }
                PanelButton [ Command = $NewProjectCommand ] {
                    Shape [ Geometry = @NewFolder, Fill = @Fg2, Width = 20, Height = 20 ]
                }
            }

            // Hairline separating the command bar from the tree.
            Border [ DockPanel.Dock = Top, Height = 1, Fill = @Border, Margin = (0,0,0,8) ]

            // Empty state — shown (ToVisibility: true → Visible) when no solution is open.
            TextBlock [ DockPanel.Dock = Bottom, Style = @BodySm, Foreground = @Fg2,
                        Text = "No solution open.", Margin = (0,8,0,0),
                        Visibility = $HasNoSolution << ToVisibility ]

            // The whole hierarchy is ONE virtualized TreeView (roots = solution members,
            // descendants = folders/files), so its built-in ScrollViewer is the single
            // scroll region. IsVirtualizing realizes only the rows in the viewport.
            TreeView [ Indent = 14, IsVirtualizing = true,
                       ItemsSource = $Tree.Roots, ItemTemplate = @HierarchyItemTemplate,
                       SelectionMode = Extended, AllowMarqueeSelection = true ]
        }
    }
}
