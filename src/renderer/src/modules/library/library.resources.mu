// library.resources.mu — view resources for the Libraries capability panel
// (LibrariesPanelService). Merged app-global by app.mu. A TreeView of published
// libraries grouped Library -> Concept -> Class; class leaves are draggable onto
// the architecture canvas (term payload). Selecting a class drives a preview pane
// docked at the BOTTOM of the panel (its mounted visual + concept) — the tree's
// list rows are fixed-height and can't host tall inline content.

import LibrariesPanelService from "./services/libraries-panel-service.js"
import LibraryTreeNode from "./services/library-tree-node.js"

resources LibraryResources {

    // Right-click menu for a Library row: uninstall it from the local libraries
    // store. Attached only to Library nodes (see the LibraryNodeTemplate trigger),
    // so Concept/Class rows get no menu. $DeleteCommand resolves against the row's
    // LibraryTreeNode DataContext.
    ContextMenu x:key="LibraryContextMenu" {
        MenuItem [ Header = "Delete", Command = $DeleteCommand ]
    }

    // One tree row: a draggable-when-a-class Border with an optional @Libraries
    // glyph (library nodes only) + the node name. No inline preview — the fixed
    // row height can't grow, so the preview lives in the panel's bottom pane. A
    // `when($IsLibrary)` trigger attaches the right-click uninstall menu to
    // Library rows only.
    HierarchicalDataTemplate x:key="LibraryNodeTemplate" [ DataType = LibraryTreeNode, itemsselector = Children ] {
        Border [ Fill = #00000000, IsDraggable = $IsDraggable, OnDragStart = $BeginDragData ] {
            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                Shape [ Geometry = @Libraries, Fill = @OnSurfaceVariant, Width = 14, Height = 14,
                        Margin = (0,0,6,0), VerticalAlignment = Center,
                        Visibility = $IsLibrary << ToVisibility ]
                TextBlock [ Text = $Name, Style = @BodyMedium, Foreground = @OnSurface, VerticalAlignment = Center ]
            }
        }
        when ( $IsLibrary = true ) { ContextMenuService.ContextMenu = @LibraryContextMenu; }
        // Class leaves with an openable wiki page get the "Open Wiki" menu.
        when ( $HasWiki = true ) { ContextMenuService.ContextMenu = @OpenWikiMenu; }
    }

    // Bottom-pane preview for a selected class LEAF. Implicit-by-type (DataType =
    // LibraryTreeNode, no x:key), so the ContentControl in the panel resolves it for
    // the node it hosts; the TreeView rows use the EXPLICIT @LibraryNodeTemplate, so
    // this template only ever renders in the preview pane. The shared
    // ToolboxVisualPresenter resolves the node's Descriptor (Tile context) and
    // upgrades the class visual in place when it lazily compiles; the presenter's
    // DataContext is the node, so the class template's $Display binds here. $Concept
    // labels it.
    DataTemplate [ DataType = LibraryTreeNode ] {
        StackPanel [ Orientation = Vertical ] {
            ToolboxVisualPresenter [ Descriptor = $Descriptor, Context = VisualContext.Tile ]
            TextBlock [ Text = $Display, Style = @BodyMedium, Foreground = @OnSurface, TextWrapping = Wrap, Margin = (0,4,0,0) ]
            TextBlock [ Text = $Concept, Style = @BodySmall, Foreground = @OnSurfaceVariant, TextWrapping = Wrap, Margin = (0,2,0,0) ]
        }
    }

    // Mirror each row's expansion from its data node so RevealTerm can open a
    // path to a leaf from the data side (node.IsExpanded → TreeViewItem). One-way
    // (IsExpanded is not two-way by default): pushes only when the node changes,
    // so it never fights a user's own expand/collapse.
    Style x:key="LibraryTreeItemStyle" [ TargetType = TreeViewItem ] {
        IsExpanded = $IsExpanded;
    }

    DataTemplate [ DataType = LibrariesPanelService ] {
        DockPanel [ LastChildFill = true, Margin = (12,12,12,12) ] {
            // Preview pane — docked at the bottom, shown when a class is selected.
            Border [ DockPanel.Dock = Bottom, Visibility = $HasPreview << ToVisibility,
                     Fill = @SurfaceContainerHigh, CornerRadius = 6, Padding = (8), Margin = (0,8,0,0) ] {
                // Host the selected NODE via a ContentControl (not a bare
                // ContentPresenter): the ContentControl keeps its own DataContext
                // (this panel service), so Content = $PreviewData keeps tracking the
                // selection, and it resolves the node through the implicit
                // PreviewNodeTemplate (DataTemplate[LibraryTreeNode]) above. A bare
                // ContentPresenter pins its DataContext to the content it renders,
                // which froze the preview on the first class selected.
                ContentControl [ Content = $PreviewData ]
            }
            // Loading state — docked at the top while discovery runs.
            TextBlock [ DockPanel.Dock = Top, Style = @BodyMedium, Text = "Loading libraries…",
                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Visibility = $IsLoading << ToVisibility ]
            // Empty state — docked at the top.
            TextBlock [ DockPanel.Dock = Top, Style = @BodyMedium, Text = "No published libraries yet.",
                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Visibility = $IsEmpty << ToVisibility ]
            // The tree fills the remaining space.
            TreeView [ Indent = 14,
                       ItemsSource        = $Roots,
                       ItemTemplate       = @LibraryNodeTemplate,
                       ItemContainerStyle = @LibraryTreeItemStyle,
                       SelectedDataItem   = $SelectedNode,
                       SelectionMode      = Single ]
        }
    }
}
