// diagram.resources.mu — view resources for Plexus's diagram editor, ported
// from the Diagrammer demo (demo/demos/diagram) and distributed across the
// shell regions. Merged app-global by app.mu (`merge DiagramResources`).
//
// Holds: the icon geometries (align/distribute/group/ungroup, baked from SVG)
// and the four boolean-combine glyphs (baked from the Material Symbols font at
// compile time); the toolbar-button template the Commands region iterates; the
// draggable toolbox tile; the ToolBox capability's shapes panel; and the CANVAS
// itself — a `DataTemplate[DataType=DiagramDocument]` the content host presents
// for the active diagram document (materializing the Diagram control in-tree).

import ToolboxService from "./services/diagram-panel-services.js"
import LayoutPipelineService from "./layout/layout-pipeline-service.js"
import DiagramExportService from "../diagram-export/services/diagram-export-service.js"
import WikiService from "../../services/wiki/wiki-service.js"
import DropCandidateChooserService from "../architecture-projects/services/drop-candidate-chooser-service.js"
import ArchNodeVM from "../architecture-projects/services/arch-node-vm.js"
import MediaNodeVM from "./media/media-node-vm.js"
import MediaOpenBehavior from "./media/media-open-behavior.js"
import ArchTitleEditBehavior from "../architecture-projects/behaviors/arch-title-edit-behavior.js"
import ZoomPercent from "./services/diagram-zoom-percent.js"

resources DiagramResources {
    // ── Icon geometries ─────────────────────────────────────────────────
    // SVG → shared Geometry at compile time (paint dropped; a Shape paints
    // each with a theme brush). @alignLeft, @group, @distributeHorizontal, …
    include "assets/icons/*.svg"

    // Boolean-combine glyphs baked from the Material Symbols font into
    // PathGeometry at COMPILE time (one per name). The font is compile-time
    // only — the baked geometry ships, not the .ttf. Venn glyphs map onto the
    // set ops: union → @join, intersect → @join_inner, subtract → @join_left,
    // exclude → @difference.
    glyphs "assets/material-symbols-outlined.ttf" {
        join
        join_inner
        join_left
        difference
        // Input-mode toolbar: Connectors mode.
        polyline
        // Text-format toolbars: paragraph alignment within the label …
        format_align_left
        format_align_center
        format_align_right
        format_align_justify
        // … and the 3×3 label-placement grid (where the label sits in the shape).
        north_west
        north
        north_east
        west
        filter_center_focus
        east
        south_west
        south
        south_east
        // Character decorations (text-style toolbar).
        format_bold
        format_italic
        format_underlined
        format_strikethrough
        // Grow / shrink font.
        text_increase
        text_decrease
        // Copy Format (format painter) — the paint-roller glyph.
        format_paint
        // Figure clipboard — Copy / Cut / Paste.
        content_copy
        content_cut
        content_paste
        // Zoom toolbar (host-built camera UI).
        zoom_in
        zoom_out
        fit_screen
    }

    // ── Canvas ItemsPanel — a paginated canvas whose measured extent grows
    // as nodes move/drop past the bounds (the enclosing ScrollViewer in the
    // Diagram's own template tracks it). ──
    ItemsPanelTemplate x:key="DiagramCanvasPanel" {
        // Paper + page border track the theme so the drawing surface reads in
        // both light and dark (PaperBrush/PageBorderBrush default to hard white /
        // light-gray in the framework). @DiagramCanvas / @OutlineVariant are
        // dynamic resources → they re-paint live on a scheme swap. The desk
        // behind the pages is the diagram template's PART_CanvasBg (@DiagramCanvas).
        PaginatedCanvas [ PageWidth = 800, PageHeight = 600,
                          PaperBrush = @DiagramCanvas, PageBorderBrush = @OutlineVariant ]
    }

    // ── Canvas — the diagram surface, materialized in-tree ──────────────
    // The Content region presents the active DiagramDocument
    // (DocumentsContentHostService.ActiveDocument) through this template.
    // Because the Diagram is created BY the template — attached in the live
    // tree — its alignment / resize / connector-interaction adorners mount
    // against a live AdornerLayer with no detached-build re-assert hack.
    // Mutator auto-wires from the DataContext (DiagramDocument IS a
    // DiagramMutator); the control publishes itself back onto the document's
    // ActiveView (IDiagramViewHost) so the shell's Commands / Inspector regions
    // reach its editing commands + selection-format state. DropReceiver = $Self
    // (the Diagram is on every canvas drop's bubble path). Mirrors the
    // Diagrammer demo's Diagram declaration (demo/demos/diagram).
    // The content area is now JUST the canvas — the input-mode strip that used to
    // ride above it is gone: the Connectors-mode toggle moved to the shell status
    // bar (see @ConnectorModeIndicator + the module's StatusBar-region .ShellControls:
    // entry), and the font editors moved to the command bar (@FontFormatEditor).
    DataTemplate [DataType = DiagramDocument] {
        DockPanel {
            // Grid so the drop-candidate chooser overlay floats over the canvas.
            Grid {
                Diagram x:name="canvas"
                    [ ItemsSource                  = $Nodes,
                      Connectors                   = $Connectors,
                      ItemsPanel                   = @DiagramCanvasPanel,
                      SelectionMode                = Extended,
                      AllowMarqueeSelection        = true,
                      AlignmentGuidesEnabled       = true,
                      RulersVisible                = true,
                      SelectionResizeEnabled       = true,
                      ConnectorInteractionsEnabled = true,
                      ReflectSelectionToItems      = true,
                      CameraEnabled                = true,
                      DropReceiver                 = $Self,
                      Focusable                    = true,
                      ContextMenuService.ContextMenu = @DiagramContextMenu ]
                // Ambiguous term-drop chooser: implicit DataTemplate[
                // DropCandidateChooserService] renders a hidden MenuButton whose
                // popup lists the candidates. Content is the app-scoped service.
                ContentControl [ Content = $service(DropCandidateChooserService),
                                 HorizontalAlignment = Left, VerticalAlignment = Top ]
            }
        }
    }

    // ── Font-format editor — a toolbar CONTROL (not a command) ──────────
    // Hosted in the shell command bar by the module's .ShellControls: entry.
    // The shell applies this template with the active document as DataContext, so
    // the pickers two-way bind the document's IFontFormatSink surface
    // (FontFamily / FontSize / FontColorHex), which the DiagramDocument mirrors
    // onto the live canvas selection. The size steppers bind the sink's step
    // commands. (Was the canvas-local picker row; now shared shell chrome.)
    //
    // Reached ONLY explicitly, by its key (the module's Template = @FontFormatEditor).
    // An x:key'd DataTemplate is never used for implicit type resolution
    // (findDataTemplateForType looks up the type KEY, not by DataType), so it can't
    // shadow the keyless canvas template above even though both are
    // [DataType = DiagramDocument].
    DataTemplate x:key="FontFormatEditor" [DataType = DiagramDocument] {
        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
            FontFamilyPicker [ Text = $FontFamily, Width = 170, VerticalAlignment = Center ]
            FontSizePicker   [ Value = $FontSize, IsEditable = true, Width = 80, Margin = (8,0,0,0), VerticalAlignment = Center ]
            ToolBar [ Margin = (8,0,0,0) ] {
                ToolBarButton [ Command = $IncreaseFontSizeCommand ] {
                    Shape [ Geometry = @text_increase, Fill = @OnSurfaceVariant, Width = 16, Height = 16 ]
                }
                ToolBarButton [ Command = $DecreaseFontSizeCommand ] {
                    Shape [ Geometry = @text_decrease, Fill = @OnSurfaceVariant, Width = 16, Height = 16 ]
                }
            }
            ColorPicker [ ColorHex = $FontColorHex, Margin = (8,0,0,0), VerticalAlignment = Center ]
            // Copy Format (format painter): a real toggle that two-way binds the
            // document's FormatPainterActive (mirrored onto the live canvas) — the
            // same proven pattern as the connector-mode toggle. Checking it arms the
            // brush; the ToolBarToggleButton's checked chrome fills @Primary and
            // flips the inherited icon ink to @OnPrimary, so "armed" reads clearly.
            // The icon Shape leaves Fill UNSET so it follows that checked-ink flip
            // (@OnSurfaceVariant at rest → @OnPrimary when checked) — hardcoding Fill
            // pins it to the resting ink and it vanishes on the @Primary fill (see
            // mural's toolbar-toggle-icon-ink guard). (Select a shape first — arming
            // with nothing selected disarms straight away.)
            ToolBar [ Margin = (8,0,0,0) ] {
                ToolBarToggleButton [ IsChecked = $FormatPainterActive ] {
                    Shape [ Geometry = @format_paint, Width = 16, Height = 16 ]
                }
            }
        }
    }

    // ── Zoom control — a Commands-region toolbar CONTROL (host-built camera UI) ──
    // Hosted in the shell command bar by the module's .ShellControls: entry. The
    // shell applies this with the active DiagramDocument as DataContext. Buttons
    // bind the live canvas's camera commands DIRECTLY as `$ActiveView.<X>Command` —
    // the exact idiom the canvas context menu uses for the align commands (a
    // two-segment path that re-resolves when ActiveView publishes; commands are
    // stable objects so it never goes stale). The readout retargets ONLY its own
    // TextBlock to $ActiveView so `$Zoom` binds as a single reactive segment
    // (mirrors the inspector's $View retarget) — isolated from the buttons so it
    // can never leave them unbound. Before the canvas mounts the commands resolve
    // to nothing (inert buttons) and the readout is blank — a transient the shell
    // tolerates. Reached ONLY by key, never implicit type resolution, so it can't
    // shadow the keyless canvas template above (both are [DataType = DiagramDocument]).
    DataTemplate x:key="ZoomControlEditor" [DataType = DiagramDocument] {
        StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
            ToolBar {
                ToolBarButton [ Command = $ActiveView.ZoomOutCommand ] {
                    Shape [ Geometry = @zoom_out, Fill = @OnSurfaceVariant, Width = 16, Height = 16 ]
                }
            }
            TextBlock
                [ DataContext       = $ActiveView,
                  Text              = $Zoom << ZoomPercent,
                  Width             = 44,
                  TextAlignment     = Center,
                  VerticalAlignment = Center,
                  Foreground        = @OnSurfaceVariant ]
            ToolBar {
                ToolBarButton [ Command = $ActiveView.ZoomInCommand ] {
                    Shape [ Geometry = @zoom_in, Fill = @OnSurfaceVariant, Width = 16, Height = 16 ]
                }
                ToolBarButton [ Command = $ActiveView.FitCommand ] {
                    Shape [ Geometry = @fit_screen, Fill = @OnSurfaceVariant, Width = 16, Height = 16 ]
                }
            }
        }
    }

    // ── Connector-mode indicator — a StatusBar-region toolbar CONTROL ────
    // Hosted in the shell STATUS BAR by the module's .ShellControls: entry
    // (Region = StatusBar). A tiny dot + "Connector" label that two-way binds the
    // document's ConnectorsModePinned (mirrored onto the live canvas): click to
    // pin/unpin the connectors interaction mode. Inactive → monochrome +
    // semitransparent; active → the dot turns green and the whole cell goes opaque.
    //
    // Like @FontFormatEditor: an x:key'd template reached only explicitly by key,
    // never implicitly — so it doesn't shadow the keyless canvas template.
    //
    // Chromeless ToggleButton chrome — strips the default pill so the cell reads as
    // plain status text; a transparent (#00000000) Border keeps it hit-testable.
    Template x:key="ConnectorModeToggleChrome" [TargetType = ToggleButton] {
        Border [ Fill = #00000000, Padding = (6,1,6,1), CornerRadius = (4) ] {
            ContentPresenter [ VerticalAlignment = Center ]
        }
    }
    DataTemplate x:key="ConnectorModeIndicator" [DataType = DiagramDocument] {
        ToggleButton x:name="Root"
            [ Template          = @ConnectorModeToggleChrome,
              IsChecked         = $ConnectorsModePinned,
              Opacity           = 0.55,
              VerticalAlignment = Center ] {
            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                Border x:name="Dot"
                    [ Width             = 8,
                      Height            = 8,
                      CornerRadius      = (4),
                      Fill        = @OnSurfaceVariant,
                      VerticalAlignment = Center,
                      Margin            = (0,0,6,0) ]
                TextBlock
                    [ Text              = "Connector",
                      FontSize          = 11,
                      Foreground        = @OnSurfaceVariant,
                      VerticalAlignment = Center ]
            }
        }
        // Pinned → opaque cell + green dot; reverts to the base 0.55 / mono otherwise.
        when ( $ConnectorsModePinned ) {
            Root.Opacity   = 1;
            Dot.Fill = #4caf50;
        }
    }

    // ── Canvas context menu — "Format Shape" ────────────────────────────
    // Right-click the canvas → "Format Shape" adds the document's DiagramInspector
    // to the PanelDockService, opening the Format Shape tab in the shell's right
    // panel dock (reuse-by-key, so it re-surfaces the one tab). The menu's logical
    // owner is the Diagram (DataContext = DiagramDocument), so `$Inspector` resolves
    // the document's inspector and `$service(PanelDockService)` the shell-scoped
    // dock host. The tab then tracks the live selection through the inspector's
    // View handle.
    ContextMenu x:key="DiagramContextMenu" {
        // Clipboard — Copy / Cut / Paste, bound to the live canvas's commands via
        // the document's published ActiveView (the same idiom the align items use).
        // Copy / Cut self-disable on an empty selection; Paste is always enabled
        // (the mutator no-ops on foreign / empty clipboard text). Ctrl+C/X/V drive
        // the same commands from the keyboard.
        MenuItem
            [ Header  = "Copy",
              Command = $ActiveView.CopyCommand,
              Icon    = Shape [ Geometry = @content_copy, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Cut",
              Command = $ActiveView.CutCommand,
              Icon    = Shape [ Geometry = @content_cut, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Paste",
              Command = $ActiveView.PasteCommand,
              Icon    = Shape [ Geometry = @content_paste, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuSeparator
        // Align + distribute — bound to the live canvas's commands via the
        // document's published ActiveView. Each self-disables when fewer than two
        // shapes are selected (the Diagram command's own CanExecute), so no extra
        // gating is needed. Icons reuse the toolbar geometries baked from SVG.
        MenuItem
            [ Header  = "Align Left",
              Command = $ActiveView.AlignLeftCommand,
              Icon    = Shape [ Geometry = @alignLeft, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Align Center",
              Command = $ActiveView.AlignCenterCommand,
              Icon    = Shape [ Geometry = @alignCenter, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Align Right",
              Command = $ActiveView.AlignRightCommand,
              Icon    = Shape [ Geometry = @alignRight, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Align Top",
              Command = $ActiveView.AlignTopCommand,
              Icon    = Shape [ Geometry = @alignTop, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Align Middle",
              Command = $ActiveView.AlignMiddleCommand,
              Icon    = Shape [ Geometry = @alignMiddle, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuSeparator
        MenuItem
            [ Header  = "Distribute Horizontally",
              Command = $ActiveView.DistributeHorizontalCommand,
              Icon    = Shape [ Geometry = @distributeHorizontal, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Distribute Vertically",
              Command = $ActiveView.DistributeVerticalCommand,
              Icon    = Shape [ Geometry = @distributeVertical, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuSeparator
        // Z-order — reorder the selected shape(s) within the figures layer. Each
        // self-disables with no figure selected (the Diagram command's CanExecute).
        // Also on Ctrl+] / Ctrl+[ (+Shift for front / back).
        MenuItem
            [ Header  = "Bring to Front",
              Command = $ActiveView.BringToFrontCommand,
              Icon    = Shape [ Geometry = @bringToFront, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Bring Forward",
              Command = $ActiveView.BringForwardCommand,
              Icon    = Shape [ Geometry = @bringForward, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Send Backward",
              Command = $ActiveView.SendBackwardCommand,
              Icon    = Shape [ Geometry = @sendBackward, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header  = "Send to Back",
              Command = $ActiveView.SendToBackCommand,
              Icon    = Shape [ Geometry = @sendToBack, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem [ Header = "Export…", Command = $service(DiagramExportService).OpenExportDialogCommand ]
        MenuSeparator
        MenuItem
            [ Header           = "Format Shape",
              Command          = $service(PanelDockService).AddPanelCommand,
              CommandParameter = $Inspector ]
        MenuSeparator
        // Layout — opens the layout-pipeline builder as a dock tab. The inspector
        // instance lives on LayoutPipelineService; adding it via the same
        // AddPanelCommand surfaces the builder panel.
        MenuItem
            [ Header           = "Layout…",
              Command          = $service(PanelDockService).AddPanelCommand,
              CommandParameter = $service(LayoutPipelineService).Inspector ]
        // Node-only: "Open Wiki" for an arch node whose concept has a wiki page.
        // Hidden on the empty-canvas right-click (the document data-context has no
        // $HasWiki → ToVisibility(undefined) → Collapsed) and on wiki-less nodes.
        // $Concept / $HasWiki resolve against the ArchNodeVM when this shared menu
        // is shown on a node.
        MenuItem
            [ Header           = "Open Wiki",
              Command          = $service(WikiService).OpenWikiCommand,
              CommandParameter = $Concept,
              Visibility       = $HasWiki << ToVisibility ]
    }

    // ── Toolbox ItemsPanel — a uniform-cell wrap grid so the tiles fit a
    // narrow pane. IsUniformChildren sizes every cell to the largest tile, so
    // the palette reads as an even grid regardless of per-shape label width. ─
    ItemsPanelTemplate x:key="DiagramToolboxPanel" {
        WrapPanel [ IsUniformChildren = true ]
    }

    // ── Toolbox tile — one draggable tile for every repository item (both mural
    // ShapeToolboxItems and Plexus ArchToolboxItems extend ToolboxItem, so the
    // base-type match serves both). The picture is the item's descriptor resolved
    // for the Tile context through the shared ToolboxVisualPresenter (shapes → the
    // shape figure; library/meta-model terms → the class icon, upgraded in place
    // when a lazily-compiled class arrives). Dragging emits the item id under
    // TOOLBOX_ITEM_FORMAT; dropping on the canvas routes id → repository → factory.
    // The presenter renders the figure/icon ONLY; the tile owns the caption below
    // it ($Label, wrapping), so shapes and class terms read the same and long names
    // wrap within the tile instead of clipping into the 48×48 figure. ──
    DataTemplate [DataType = ToolboxItem] {
        Border x:root
            [ IsDraggable     = true,
              OnDragStart     = $BeginDragData,
              Fill      = @Surface,
              Stroke     = Pen [ Brush = @OutlineVariant ],
              CornerRadius    = 4,
              Padding         = (4,8,4,8),
              Margin          = (2,0,2,4),
              MaxWidth        = 104 ] {
            StackPanel [ Orientation = Vertical, HorizontalAlignment = Center ] {
                ToolboxVisualPresenter
                    [ Descriptor          = $Descriptor,
                      Context             = VisualContext.Tile,
                      Width               = @ToolboxItemWidth,
                      Height              = @ToolboxItemHeight,
                      HorizontalAlignment = Center ]
                TextBlock
                    [ Text                = $Label,
                      Style               = @BodySmall,
                      Foreground          = @OnSurfaceVariant,
                      TextWrapping        = Wrap,
                      TextAlignment       = Center,
                      HorizontalAlignment = Center,
                      Margin              = (0,4,0,0) ]
            }
        }
        // "Open Wiki" for arch tiles whose concept has an openable wiki page.
        // Shape tiles have no HasWiki property → the trigger never fires for them.
        when ( $HasWiki = true ) { ContextMenuService.ContextMenu = @OpenWikiMenu; }
    }

    // ── Architecture node tile — icon + label for an ArchNodeVM dropped on an
    // architecture diagram. ToolboxVisualPresenter renders the term's icon via the
    // Figure context (same resolver path as the toolbox tile, but sized for the
    // canvas); the TextBlock shows the entity's display label below the icon.
    DataTemplate [DataType = ArchNodeVM] {
        // Right-click a node → the SHARED diagram menu (Copy/Cut/Align/Export/Format
        // + a node-only "Open Wiki"). Its $ActiveView / $Inspector items resolve via
        // ArchNodeVM's HostDocument aliases, so the node keeps the full menu instead
        // of the bare Open-Wiki menu it used to swap in.
        StackPanel x:name="PART_TileStack"
            [ Orientation = Vertical, HorizontalAlignment = Center,
              ContextMenuService.ContextMenu = @DiagramContextMenu ] {
            ToolboxVisualPresenter x:name="PART_Icon"
                [ Descriptor          = $Descriptor,
                  Context             = VisualContext.Figure,
                  // Sized from the shared shape-default-size setting so an arch
                  // node's icon renders at the same size as a geometric shape.
                  Width               = $IconSize,
                  Height              = $IconSize,
                  HorizontalAlignment = Center ]
            TextBlock x:name="PART_Title"
                [ Text                = $Label,
                  Style               = @BodySmall,
                  // Caption ink tracks the theme so it reads on the (now theme-
                  // adaptive) @DiagramCanvas surface in both light and dark.
                  Foreground          = @OnSurface,
                  TextWrapping        = Wrap,
                  // Caps the tile width so a long name wraps instead of stretching
                  // the node; the container sizes the box to this wrapped tile.
                  MaxWidth            = 120,
                  TextAlignment       = Center,
                  // Measure the width with the paint engine's own SVG <text> layout,
                  // not Canvas measureText — the two disagree by a fraction of a pixel
                  // per glyph, so under the node's ClipToBounds the last glyph was
                  // sheared off ("Data Source|s"). Same reason mural's ShapeText /
                  // Chip / markers use Exact. See TextBlock.MeasurementFidelity.
                  MeasurementFidelity = Exact,
                  HorizontalAlignment = Center,
                  Margin              = (0,4,0,0) ]
            // In-place TITLE editor — F2 / double-click on the node begins editing
            // $Label here (not the container's blank ShapeText). Hidden until the
            // $IsEditing trigger reveals it; FocusOnVisibleBehavior focuses + selects
            // the box on reveal, ArchTitleEditBehavior commits on Enter / click-away
            // and cancels on Escape (the commit persists to the entity via the
            // binding — see ArchNodeVM.CommitEdit). A non-focusable Border wraps the
            // TextBox because a TextBox has no content model to host a Behaviors block.
            Border x:name="PART_TitleEditor"
                [ Visibility          = Collapsed,
                  HorizontalAlignment = Center,
                  Margin              = (0,4,0,0) ] {
                .Behaviors: { FocusOnVisibleBehavior ArchTitleEditBehavior }
                TextBox
                    [ Text                = $EditingLabel,
                      Variant             = Plain,
                      MinWidth            = 60,
                      MaxWidth            = 120 ]
            }
        }
        // (Open Wiki now lives inside the shared @DiagramContextMenu, gated on
        // $HasWiki, so nodes keep the full diagram menu — see PART_TileStack above.)
        // Reveal the inline title editor while this node is being renamed (data
        // trigger — `$IsEditing`, not a root-property trigger — so it fires on the
        // ArchNodeVM's DP; see the project-explorer rename template for the idiom).
        when ( $IsEditing = true ) {
            PART_Title.Visibility       = Collapsed;
            PART_TitleEditor.Visibility = Visible;
        }
        // A CONTAINER node's header is just its label, pinned to the top-left
        // corner — the icon+label tile is for leaf nodes; a container reads as a
        // titled box that holds children, so it drops the icon and left-aligns the
        // title above its child region. IsContainer is set on placed diagram nodes
        // by the arch binding (never on toolbox items), so this is diagram-only.
        when ( $IsContainer = true ) {
            PART_Icon.Visibility            = Collapsed;
            PART_TileStack.HorizontalAlignment = Left;
            PART_TileStack.VerticalAlignment   = Top;
            PART_Title.HorizontalAlignment  = Left;
            PART_Title.TextAlignment        = Left;
            PART_Title.Margin               = (0,0,0,0);
        }
        // Per-node label text style (Format Shape → Text page, via the VM's
        // TextStyle adapter). Each property overrides the @BodySmall / @OnSurface /
        // Center defaults ONLY once the user sets it (the DP is undefined until
        // then), so untouched labels — and existing diagrams — are unchanged.
        when ( $LabelFontFamily is set )     { PART_Title.FontFamily = $LabelFontFamily; }
        when ( $LabelFontSize is set )       { PART_Title.FontSize = $LabelFontSize; }
        when ( $LabelForeground is set )     { PART_Title.Foreground = $LabelForeground; }
        when ( $LabelFontWeight is set )     { PART_Title.FontWeight = $LabelFontWeight; }
        when ( $LabelFontStyle is set )      { PART_Title.FontStyle = $LabelFontStyle; }
        when ( $LabelTextDecorations is set ){ PART_Title.TextDecorations = $LabelTextDecorations; }
        when ( $LabelTextAlignment is set )  { PART_Title.TextAlignment = $LabelTextAlignment; }
    }

    // A media shape dropped/pasted onto the diagram: an image renders as a
    // picture; a file/hyperlink renders as an icon+label chip. IsImage / ShowChip
    // are derived boolean flags on the VM (an image with no resolved bitmap —
    // unreadable file, dead URL — falls back to the chip so the node is never
    // invisible). Node geometry rides the document visuals like every other node.
    DataTemplate [DataType = MediaNodeVM] {
        Grid x:name="PART_MediaRoot" {
            .Behaviors: { MediaOpenBehavior }
            Image x:name="PART_Image"
                [ Source     = $Bitmap,
                  Stretch    = Uniform,
                  Visibility = Collapsed ]
            StackPanel x:name="PART_Chip"
                [ Orientation       = Horizontal,
                  VerticalAlignment = Center,
                  Visibility        = Collapsed ] {
                Border x:name="PART_ChipIcon"
                    [ Width        = 24,
                      Height       = 24,
                      Fill         = @OnSurfaceVariant,
                      CornerRadius = (4) ]
                TextBlock x:name="PART_ChipLabel"
                    [ Text                = $Label,
                      Style               = @BodySmall,
                      Foreground          = @OnSurface,
                      TextWrapping        = Wrap,
                      MaxWidth            = 160,
                      Margin              = (6,0,0,0),
                      MeasurementFidelity = Exact ]
            }
        }
        when ( $IsImage = true )  { PART_Image.Visibility = Visible; }
        when ( $ShowChip = true ) { PART_Chip.Visibility = Visible; }
    }

    // ── ToolBox capability panel — the shapes palette in the left pane.
    // Overrides the generic `DataTemplate [DataType = PlexusPanelService]` for the
    // ToolboxService subtype (exact-type match wins). The unified toolbox presents
    // $Pages as an ACCORDION (a built-in Shapes page plus one section per visible
    // taxonomy): each section's header two-ways the page's IsExpanded and its body
    // collapses when closed. Sections toggle independently; the whole stack scrolls
    // as one region. ──
    // The 8dp inset lives on an OUTER Border (padding), NOT as a Margin on the
    // scrolled ItemsControl. A margin on the scroll viewport's content shifts
    // that content's origin (translate(8,8)), but the ScrollContentPresenter
    // sizes its viewport clip to the full viewport and applies it on the
    // (now margin-offset) content — so the clip overshoots the viewport bottom
    // by the top margin, letting the last few dp of tiles paint over whatever
    // sits below the pane (the status bar). Keeping the inset outside the
    // ScrollViewer leaves the scrolled content at origin, so the clip aligns.
    DataTemplate [DataType = ToolboxService] {
        Border [ Padding = (8) ] {
            ScrollViewer [ IsAutoHideScrollBars = true, HorizontalScrollEnabled = false ] {
                ItemsControl [ ItemsSource = $Pages, ItemTemplate = @ToolboxAccordionItem, ItemsPanel = @VerticalStackPanel ]
            }
        }
    }

    // Chromeless accordion header chrome: a full-width, hit-testable row (no
    // default ToggleButton pill) whose leading chevron flips ▸→▾ when expanded
    // (IsChecked). The ContentPresenter shows the ToggleButton's content (title).
    Template x:key="ToolboxAccordionHeaderChrome" [TargetType = ToggleButton] {
        Border x:name="Root" [ Fill = #00000000, CornerRadius = @ShapeExtraSmall, Padding = (4,6,4,6) ] {
            DockPanel [ LastChildFill = true ] {
                TextBlock x:name="Chevron"
                    [ DockPanel.Dock = Left, Text = "▸", Foreground = @OnSurfaceVariant,
                      Margin = (0,0,8,0), VerticalAlignment = Center ]
                ContentPresenter [ VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver ) { Root.Fill = @StateHoverOverlay; }
        when ( IsChecked )   { Chevron.Text = "▾"; }
    }

    // One accordion section: a header ToggleButton (two-ways the page's IsExpanded)
    // over the page's tiles in the uniform wrap grid, collapsed when the section is
    // closed. Sections toggle independently. Tiles dispatch by DataType through the
    // single [DataType = ToolboxItem] template above; the outer ScrollViewer scrolls
    // the whole stack.
    DataTemplate x:key="ToolboxAccordionItem" [DataType = ToolboxPage] {
        StackPanel [ Orientation = Vertical, Margin = (0,0,0,2), Visibility = $IsVisible << ToVisibility ] {
            ToggleButton
                [ Template            = @ToolboxAccordionHeaderChrome,
                  IsChecked           = $IsExpanded,
                  HorizontalAlignment = Stretch ] {
                TextBlock [ Text = $Title, Style = @LabelMedium, Foreground = @OnSurfaceVariant ]
            }
            Border [ Visibility = $IsExpanded << ToVisibility, Padding = (0,4,0,6) ] {
                ItemsControl [ ItemsSource = $Items, ItemsPanel = @DiagramToolboxPanel ]
            }
        }
    }
}
