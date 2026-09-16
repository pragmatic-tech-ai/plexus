// meta-model.resources.mu — view resources for the Meta-models capability panel
// (MetaModelsService). Merged app-global by app.mu (`merge MetaModelResources`).
//
// Renders the published meta-models as a virtualized tree: model id → version →
// ontology entities (grouped by kind), the entities loaded lazily when a version
// row is first expanded (MetaModelTreeNode.OnExpand via mural's TreeView hook).
// One HierarchicalDataTemplate governs every level; MetaModelKindToGeometry maps
// a node's Kind to its leading glyph.

import MetaModelsService from "./services/meta-models-service.js"
import MetaModelTreeNode from "./services/meta-model-tree-node.js"
import MetaModelKindToGeometry from "./services/meta-model-node-icon.js"

resources MetaModelResources {
    // The panel body: a virtualized tree of the published models, plus an
    // empty-state line shown only while nothing has been published. A DockPanel
    // (not a vertical StackPanel) so the TreeView, as the LastChildFill, inherits
    // the pane's bounded height and fills it — a StackPanel would measure the
    // tree with infinite height, collapsing the virtualizing panel to a thin
    // strip. The empty-state text docks above; it's collapsed while non-empty,
    // so the tree then fills the whole pane.
    DataTemplate [DataType = MetaModelsService] {
        DockPanel [ LastChildFill = true, Margin = (12,12,12,12) ] {
            TextBlock
                [ DockPanel.Dock = Top,
                  Style          = @BodyMedium,
                  Text           = "No published meta-models yet.",
                  Foreground     = @OnSurfaceVariant,
                  TextWrapping   = Wrap,
                  Visibility     = $IsEmpty << ToVisibility ]
            TreeView
                [ Indent         = 14,
                  IsVirtualizing = true,
                  ItemsSource    = $Nodes,
                  ItemTemplate   = @MetaModelNodeTemplate ]
        }
    }

    // Right-click menu for a published meta-model row: delete it. Attached only to
    // Model / Version nodes (see the MetaModelNodeTemplate trigger), so Group /
    // Entity rows get no menu. $DeleteCommand resolves against the row's
    // MetaModelTreeNode DataContext.
    ContextMenu x:key="MetaModelContextMenu" {
        MenuItem [ Header = "Delete", Command = $DeleteCommand ]
    }

    // One tree row (any level): the per-kind leading icon + the node's label.
    // `itemsselector = Children` recurses the template down the tree; the
    // framework's TreeView chrome supplies chevrons, indent, hover, selection.
    HierarchicalDataTemplate x:key="MetaModelNodeTemplate" [DataType = MetaModelTreeNode, itemsselector = Children] {
        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
            Shape
                [ Geometry          = $Kind << MetaModelKindToGeometry,
                  Fill              = @OnSurfaceVariant,
                  Width             = 16,
                  Height            = 16,
                  Margin            = (0,0,6,0),
                  VerticalAlignment = Center ]
            TextBlock [ Text = $Label, Style = @BodyMedium, VerticalAlignment = Center ]
        }
        // Only Model (id) and Version rows carry a delete command / context menu.
        when ( $IsDeletable = true ) { ContextMenuService.ContextMenu = @MetaModelContextMenu; }
        // Entity rows with an openable wiki page get the "Open Wiki" menu.
        when ( $HasWiki = true ) { ContextMenuService.ContextMenu = @OpenWikiMenu; }
    }
}
