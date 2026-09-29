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
import HierarchyAction from "@pragmatic-tech-ai/mural/framework/hierarchy"
import IconKeyToGeometry from "./services/icon-key-to-geometry.js"
import EditingToLabelVisibility from "../../projects/project-node-icon.js"

resources SolutionExplorerResources {

    // One context-menu entry. Recurses via Children (an ObservableCollection) for
    // submenus (Add New, Run Agent/Skill, Export, Bump Version); a separator action
    // (IsSeparator) renders as a disabled divider row.
    DataTemplate x:key="HierarchyActionTemplate" [ DataType = HierarchyAction ] {
        MenuItem [ Header = $Label, Command = $Invoke,
                   ItemsControl.ItemsSource  = $Children,
                   ItemsControl.ItemTemplate = @HierarchyActionTemplate ]
    }

    // The row's right-click menu: the VM's ContextActions (owner base + keyed
    // contributor additions, resolved lazily when the menu opens).
    ContextMenu x:key="HierarchyContextMenu"
        [ ItemsControl.ItemsSource  = $ContextActions,
          ItemsControl.ItemTemplate = @HierarchyActionTemplate ] { }

    // One hierarchy row: leading icon (IconKey → geometry via IconKeyToGeometry) +
    // caption, in a transparent Border carrying the right-click HierarchyContextMenu.
    // itemsselector = Children recurses the template down the tree. The caption hides
    // while the row is in rename mode; a persistent Plain TextBox (revealed by
    // Visibility, focused by FocusOnVisibleBehavior on each transition to Visible)
    // edits EditingName in place.
    HierarchicalDataTemplate x:key="HierarchyItemTemplate"
        [ DataType = HierarchyItemVM, itemsselector = Children ] {
        Border x:root [ Fill = #00000000, ContextMenuService.ContextMenu = @HierarchyContextMenu ] {
            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                Shape [ Geometry = $IconKey << IconKeyToGeometry, Fill = @Fg2,
                        Width = 16, Height = 16, Margin = (0,0,6,0), VerticalAlignment = Center ]
                TextBlock [ Text = $Caption, Style = @Body, VerticalAlignment = Center,
                            Visibility = $IsEditing << EditingToLabelVisibility ]
                // In-place rename editor: the Border is revealed by Visibility and
                // FocusOnVisibleBehavior focuses the TextBox on each transition to Visible.
                Border [ Visibility = $IsEditing << ToVisibility ] {
                    .Behaviors: { FocusOnVisibleBehavior }
                    TextBox [ Text = $EditingName, Variant = Plain, MinWidth = 80,
                              VerticalAlignment = Center, SelectionBrush = @TextSelectionBg ]
                }
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
