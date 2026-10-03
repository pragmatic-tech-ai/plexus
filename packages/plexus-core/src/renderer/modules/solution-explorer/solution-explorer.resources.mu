// solution-explorer.resources.mu — the Solution Explorer's left-panel view.
//
// Renders SolutionExplorerService: a small command bar (the surviving Open / New
// project commands, surfaced by the capability as pass-throughs to the lifecycle
// ProjectExplorerService), a hairline, an empty-state line, and ONE virtualized
// TreeView over the stable Hierarchy. The tree opts into mural's default
// @HierarchyTreeView style (ItemTemplate = @HierarchyItemTemplate: icon + caption +
// inline-rename, shipped in the framework theme) and attaches the four default
// hierarchy behaviors — tree (selection/expansion/keyboard), context menu, drop and
// drag — each bound from the SAME $Hierarchy. The hand-written action / context-menu /
// custom-item templates + custom behavior bundle are retired.
//
// DataContext is set on the TreeView itself via $service (not inherited) because the
// behaviors attach before parent DataContext inheritance is live — and
// HierarchyContextMenuBehavior throws on an undefined Hierarchy. ItemsSource is a
// body SLOT-ASSIGN placed AFTER .Behaviors: so the behaviors attach before the rows
// realize (inline-rename wiring on already-live rows depends on that order).

import SolutionExplorerService from "./services/solution-explorer-service.js"
import HierarchyTreeBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy"
import HierarchyContextMenuBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy"
import HierarchyDropBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy"
import HierarchyDragBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy"

resources SolutionExplorerResources {

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

            // The whole hierarchy is ONE virtualized TreeView (roots = solution members +
            // the Connections branch, descendants = folders/files/references/connections),
            // so its built-in ScrollViewer is the single scroll region. @HierarchyTreeView
            // supplies @HierarchyItemTemplate; the four default behaviors are bound from the
            // service's stable $Hierarchy; ItemsSource is slot-assigned AFTER .Behaviors:.
            TreeView [ DataContext = $service(SolutionExplorerService), Style = @HierarchyTreeView,
                       Indent = 14, IsVirtualizing = true,
                       SelectionMode = Extended, AllowMarqueeSelection = true ] {
                .Behaviors: {
                    HierarchyTreeBehavior        [ Hierarchy = $Hierarchy ]
                    HierarchyContextMenuBehavior [ Hierarchy = $Hierarchy ]
                    HierarchyDropBehavior        [ Hierarchy = $Hierarchy, Host = $Hierarchy.Host ]
                    HierarchyDragBehavior        [ Hierarchy = $Hierarchy ]
                }
                ItemsSource: $Hierarchy.Roots
            }
        }
    }
}
