// graph-viewer.resources.mu — view resources for the read-only graph viewer.
// Merged app-global by app.mu (`merge GraphViewerResources`).
//
// The content host presents a GraphViewerDocument through the canvas template
// below. It mirrors the editable board canvas (board.resources.mu — the
// `[DataType = BoardDocument]` template) but with every editing affordance
// removed: no Mutator, no DropReceiver, no context menu, and selection resize /
// connector interactions / alignment guides / rulers all OFF. CameraEnabled stays
// on so the graph can be panned and zoomed. The Board is resolved by EXACT type
// (GraphViewerDocument), so the editable BoardDocument template never applies here.
//
// Positions are seeded into the document's node-visual store by GraphLayout before
// the document opens; the shared @BoardCanvasPanel (a PaginatedCanvas, merged
// app-global by board.resources.mu) places each node by that geometry.

import GraphViewerDocument from "./graph-viewer-document.js"
import GraphNodeVM from "./graph-node-vm.js"

resources GraphViewerResources {
    // ── Read-only canvas + header ─────────────────────────────────────────
    // A header strip (Refresh) docks above the canvas. Refresh re-pulls the whole
    // graph and re-projects — this is also how "Live" stays current, since the env
    // Inspect relay exposes no graph-change push to the renderer (no auto-subscribe).
    DataTemplate [DataType = GraphViewerDocument] {
        DockPanel [ LastChildFill = true ] {
            StackPanel
                [ DockPanel.Dock   = Top,
                  Orientation       = Horizontal,
                  HorizontalAlignment = Right,
                  Margin            = (8,6,8,6) ] {
                Button [ Variant = Text, Command = $RefreshCommand ] {
                    TextBlock [ Text = "Refresh" ]
                }
            }
            Board x:name="canvas"
                [ ItemsSource                  = $Nodes,
                  Connectors                   = $Connectors,
                  ItemsPanel                   = @BoardCanvasPanel,
                  CameraEnabled                = true,
                  SelectionResizeEnabled       = false,
                  ConnectorInteractionsEnabled = false,
                  AlignmentGuidesEnabled       = false,
                  RulersVisible                = false ]
        }
    }

    // ── Read-only node tile ───────────────────────────────────────────────
    // A label over its concept caption. No icon, no inline title editor, no
    // context menu — the viewer never mutates a node. Theme-adaptive ink (@Fg1 /
    // @Fg2) so it reads on the canvas surface in light and dark. MeasurementFidelity
    // = Exact matches the arch node tile so a long label wraps without shearing.
    DataTemplate [DataType = GraphNodeVM] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Center ] {
            TextBlock
                [ Text                = $Label,
                  Style               = @BodySm,
                  Foreground          = @Fg1,
                  TextWrapping        = Wrap,
                  MaxWidth            = 140,
                  TextAlignment       = Center,
                  MeasurementFidelity = Exact,
                  HorizontalAlignment = Center ]
            TextBlock
                [ Text                = $Concept,
                  Foreground          = @Fg2,
                  TextAlignment       = Center,
                  HorizontalAlignment = Center,
                  Margin              = (0,2,0,0) ]
        }
    }
}
