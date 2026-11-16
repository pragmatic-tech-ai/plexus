// tenant-explorer.resources.mu — view resources for the Tenant Explorer capability panel
// (TenantExplorerService). Merged app-global by app.mu (`merge TenantExplorerResources`).
//
// Renders the signed-in tenant as a virtualized tree: tenant -> environments ->
// applications / graphs (loaded lazily on first expand). One trigger-free
// HierarchicalDataTemplate governs every level; TenantExplorerKindToGeometry maps a
// node's Kind to its leading glyph.

import TenantExplorerService from "./services/tenant-explorer-service.js"
import TenantExplorerNode from "./services/tenant-explorer-node.js"
import TenantExplorerKindToGeometry from "./services/tenant-explorer-node-icon.js"

resources TenantExplorerResources {
    // The panel body: a signed-out prompt, an empty prompt, and the tree. A DockPanel
    // so the TreeView (LastChildFill) inherits the pane's bounded height.
    DataTemplate [DataType = TenantExplorerService] {
        DockPanel [ LastChildFill = true, Margin = (12,12,12,12) ] {
            TextBlock
                [ DockPanel.Dock = Top,
                  Style          = @Body,
                  Text           = "Sign in to see your environments.",
                  Foreground     = @Fg2,
                  TextWrapping   = Wrap,
                  Visibility     = $SignedOut << ToVisibility ]
            TextBlock
                [ DockPanel.Dock = Top,
                  Style          = @Body,
                  Text           = "No environments available.",
                  Foreground     = @Fg2,
                  TextWrapping   = Wrap,
                  Visibility     = $IsEmpty << ToVisibility ]
            TreeView
                [ Indent         = 14,
                  IsVirtualizing = true,
                  ItemsSource    = $Nodes,
                  ItemTemplate   = @TenantExplorerNodeTemplate ]
        }
    }

    // One tree row (any level): the per-kind icon, the label, and a muted status suffix.
    HierarchicalDataTemplate x:key="TenantExplorerNodeTemplate" [DataType = TenantExplorerNode, itemsselector = Children] {
        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
            Shape
                [ Geometry          = $Kind << TenantExplorerKindToGeometry,
                  Fill              = @Fg2,
                  Width             = 16,
                  Height            = 16,
                  Margin            = (0,0,6,0),
                  VerticalAlignment = Center ]
            TextBlock [ Text = $Label, Style = @Body, VerticalAlignment = Center ]
            TextBlock
                [ Text              = $Status,
                  Style             = @BodySm,
                  Foreground        = @Fg2,
                  Margin            = (6,0,0,0),
                  VerticalAlignment = Center ]
        }
    }
}
