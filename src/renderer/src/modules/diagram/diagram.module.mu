// diagram.module.mu â€” the Diagram module for Plexus.
//
// A ShellModule declaration: the "Diagram" capability provider. It contributes
// its capabilities to the shell's root navigation layer â€” each Capability is
// one rail entry (Name + Icon) that names, via its `ServiceKey`, the service
// whose content fills the shell's left panel while the capability is active.
//
// Compiles to `export function create()` returning the ShellModule instance;
// the app adds it via a `.modules:` block on the Application. An editor is then
// "shell + a set of modules": this Diagram module, plus a Layers module, an
// Outline module, â€¦
//
// Capability content is service-backed (the updated mechanism): the module's
// `.services:` block registers a service per capability, and a shared
// `DataTemplate [DataType = PlexusPanelService]` (in panels.resources.mu) renders whichever
// one is active. See services/panels/panel-services.ts.

import ToolboxService from "./services/diagram-panel-services.js"
import DiagramDocumentFactory from "./services/diagram-document-factory.js"
import TodlPresentationRegistry from "./services/todl-presentation-registry.js"

module DiagramModule [ Name = "Diagram" ] {
    .services: {
        ToolboxService
        DiagramDocumentFactory
        TodlPresentationRegistry
    }

    // Settings this module contributes to the app's ApplicationSettings. Each is
    // a schema (key + type + default + metadata); ApplicationSettings builds a
    // live, user-modifiable value from it, overlaying any persisted value.
    .settings: {
        SettingDefinition
            [ Key         = "diagram.grid.show",
              Label       = "Show grid",
              Description = "Show a grid on the diagram background.",
              Kind        = Boolean,
              Default     = true,
              Category    = "Diagram" ]
        SettingDefinition
            [ Key         = "diagram.grid.size",
              Label       = "Grid size",
              Description = "Grid cell size in pixels.",
              Kind        = Number,
              Default     = 20,
              Min         = 1,
              Max         = 128,
              Category    = "Diagram" ]
        SettingDefinition
            [ Key         = "diagram.page.width",
              Label       = "Page width",
              Description = "Diagram page width in pixels.",
              Kind        = Number,
              Default     = 2000,
              Min         = 1,
              Max         = 20000,
              Category    = "Diagram" ]
        SettingDefinition
            [ Key         = "diagram.page.height",
              Label       = "Page height",
              Description = "Diagram page height in pixels.",
              Kind        = Number,
              Default     = 2000,
              Min         = 1,
              Max         = 20000,
              Category    = "Diagram" ]
        // Canvas icon-node default size. An arch node's PART_Icon ContentControl
        // binds $Self.(Diagram.DefaultIconWidth/Height) — inheritable attached DPs
        // (mural Diagram) whose SettingValue tier reads these keys via the
        // SettingSourceKey→ApplicationSettings bridge. Without these definitions the
        // DP falls back to its registration default (0) and the icon collapses; with
        // them it resolves 80 and is user-configurable + live. Keys/defaults match
        // mural's own DiagramSettingKey.DefaultIconWidth/Height.
        SettingDefinition
            [ Key         = "diagram.DefaultIconWidth",
              Label       = "Default icon width",
              Description = "Default width of an icon node, in pixels.",
              Kind        = Number,
              Default     = 80,
              Min         = 8,
              Max         = 400,
              Category    = "Diagram" ]
        SettingDefinition
            [ Key         = "diagram.DefaultIconHeight",
              Label       = "Default icon height",
              Description = "Default height of an icon node, in pixels.",
              Kind        = Number,
              Default     = 80,
              Min         = 8,
              Max         = 400,
              Category    = "Diagram" ]
        // Toolbox item figure size. The toolbox tile's icon ContentControl binds
        // @ToolboxItemWidth/@ToolboxItemHeight, which ToolboxService mirrors from
        // these settings.
        SettingDefinition
            [ Key         = "toolbox.item.width",
              Label       = "Toolbox item width",
              Description = "Width of a toolbox item's figure, in pixels.",
              Kind        = Number,
              Default     = 48,
              Min         = 16,
              Max         = 256,
              Category    = "Toolbox" ]
        SettingDefinition
            [ Key         = "toolbox.item.height",
              Label       = "Toolbox item height",
              Description = "Height of a toolbox item's figure, in pixels.",
              Kind        = Number,
              Default     = 48,
              Min         = 16,
              Max         = 256,
              Category    = "Toolbox" ]
        // How dropped file/hyperlink chips render (image nodes ignore it).
        SettingDefinition
            [ Key         = "diagram.media.linkRenderMode",
              Label       = "Media link display",
              Description = "How dropped files and hyperlinks are shown on the diagram.",
              Kind        = Choice,
              Default     = "thumbnail-label",
              Choices     = ["icon-label", "thumbnail-label", "plain-link"],
              Category    = "Diagram" ]
    }

    // The document type this module edits. Declarative schema aggregated by the
    // framework DocumentTypeRegistry (Type + extensions → file-open by extension;
    // CommandContexts → the toolbar contexts a diagram activates). Factory is the
    // .diagram editor the ProjectExplorerService resolves for open/save/new.
    .documents: {
        DocumentDefinition
            [ Type            = "diagram",
              Title           = "Diagram",
              Description     = "A node-and-connector diagram.",
              FileExtensions  = [".diagram"],
              Factory         = DiagramDocumentFactory,
              CommandContexts = [DiagramEditingContext] ]
    }

    // Toolbar commands — pure chrome (Id + Title + Icon + Context + placement).
    // Behaviour lives on the active document: the ToolbarService shows these
    // while a DiagramEditingContext document is active and dispatches each to
    // DiagramDocument.Execute(definition), which forwards to the canvas control.
    // The Id strings match DiagramCommandId (framework) — the same markup-string
    // ↔ code-constant contract as setting keys. Order is global (keeps groups
    // contiguous); Group tags future separators.
    .commands: {
        // Align + Distribute — one SplitMenu group. align.left is the leader: it
        // declares the group's presentation, dropdown face icon + tooltip. The
        // Distribute pair rides in the SAME group (Group = "align") below a divider
        // (SeparatorBefore on the first).
        CommandDefinition
            [ Id           = "diagram.align.left",
              Title        = "Align Left",
              Icon         = @alignLeft,
              Context      = DiagramEditingContext,
              Group        = "align",
              Order        = 10,
              Presentation = SplitMenu,
              GroupIcon    = @alignLeft,
              GroupTitle   = "Align" ]
        CommandDefinition
            [ Id      = "diagram.align.right",
              Title   = "Align Right",
              Icon    = @alignRight,
              Context = DiagramEditingContext,
              Group   = "align",
              Order   = 20 ]
        CommandDefinition
            [ Id      = "diagram.align.top",
              Title   = "Align Top",
              Icon    = @alignTop,
              Context = DiagramEditingContext,
              Group   = "align",
              Order   = 30 ]
        CommandDefinition
            [ Id      = "diagram.align.middle",
              Title   = "Align Middle",
              Icon    = @alignMiddle,
              Context = DiagramEditingContext,
              Group   = "align",
              Order   = 40 ]
        CommandDefinition
            [ Id      = "diagram.align.center",
              Title   = "Align Center",
              Icon    = @alignCenter,
              Context = DiagramEditingContext,
              Group   = "align",
              Order   = 50 ]
        CommandDefinition
            [ Id              = "diagram.distribute.horizontal",
              Title           = "Distribute Horizontally",
              Icon            = @distributeHorizontal,
              Context         = DiagramEditingContext,
              Group           = "align",
              Order           = 60,
              SeparatorBefore = true ]
        CommandDefinition
            [ Id      = "diagram.distribute.vertical",
              Title   = "Distribute Vertically",
              Icon    = @distributeVertical,
              Context = DiagramEditingContext,
              Group   = "align",
              Order   = 70 ]
        CommandDefinition
            [ Id      = "diagram.group",
              Title   = "Group",
              Icon    = @group,
              Context = DiagramEditingContext,
              Group   = "arrange",
              Order   = 80 ]
        CommandDefinition
            [ Id      = "diagram.ungroup",
              Title   = "Ungroup",
              Icon    = @ungroup,
              Context = DiagramEditingContext,
              Group   = "arrange",
              Order   = 90 ]
        CommandDefinition
            [ Id      = "diagram.combine.union",
              Title   = "Combine — Union",
              Icon    = @join,
              Context = DiagramEditingContext,
              Group   = "combine",
              Order   = 100 ]
        CommandDefinition
            [ Id      = "diagram.combine.intersect",
              Title   = "Combine — Intersect",
              Icon    = @join_inner,
              Context = DiagramEditingContext,
              Group   = "combine",
              Order   = 110 ]
        CommandDefinition
            [ Id      = "diagram.combine.subtract",
              Title   = "Combine — Subtract",
              Icon    = @join_left,
              Context = DiagramEditingContext,
              Group   = "combine",
              Order   = 120 ]
        CommandDefinition
            [ Id      = "diagram.combine.exclude",
              Title   = "Combine — Exclude",
              Icon    = @difference,
              Context = DiagramEditingContext,
              Group   = "combine",
              Order   = 130 ]
        // Paragraph alignment WITHIN the label block — a Toggles group (each
        // reflects the selection's current alignment; leader declares presentation).
        CommandDefinition
            [ Id           = "diagram.text.align.left",
              Title        = "Align Text Left",
              Icon         = @format_align_left,
              Context      = DiagramEditingContext,
              Group        = "text-align",
              Order        = 140,
              Presentation = Toggles ]
        CommandDefinition
            [ Id      = "diagram.text.align.center",
              Title   = "Align Text Center",
              Icon    = @format_align_center,
              Context = DiagramEditingContext,
              Group   = "text-align",
              Order   = 150 ]
        CommandDefinition
            [ Id      = "diagram.text.align.right",
              Title   = "Align Text Right",
              Icon    = @format_align_right,
              Context = DiagramEditingContext,
              Group   = "text-align",
              Order   = 160 ]
        CommandDefinition
            [ Id      = "diagram.text.align.justify",
              Title   = "Justify Text",
              Icon    = @format_align_justify,
              Context = DiagramEditingContext,
              Group   = "text-align",
              Order   = 170 ]
        // Label placement WITHIN the shape footprint — a SplitGrid group (3×3 icon
        // matrix in the dropdown; leader declares presentation + the centre-glyph
        // face).
        CommandDefinition
            [ Id           = "diagram.text.place.top-left",
              Title        = "Place Label Top-Left",
              Icon         = @north_west,
              Context      = DiagramEditingContext,
              Group        = "text-place",
              Order        = 180,
              Presentation = SplitGrid,
              GroupIcon    = @filter_center_focus,
              GroupTitle   = "Placement",
              Columns      = 3 ]
        CommandDefinition
            [ Id      = "diagram.text.place.top",
              Title   = "Place Label Top",
              Icon    = @north,
              Context = DiagramEditingContext,
              Group   = "text-place",
              Order   = 190 ]
        CommandDefinition
            [ Id      = "diagram.text.place.top-right",
              Title   = "Place Label Top-Right",
              Icon    = @north_east,
              Context = DiagramEditingContext,
              Group   = "text-place",
              Order   = 200 ]
        CommandDefinition
            [ Id      = "diagram.text.place.left",
              Title   = "Place Label Left",
              Icon    = @west,
              Context = DiagramEditingContext,
              Group   = "text-place",
              Order   = 210 ]
        CommandDefinition
            [ Id      = "diagram.text.place.center",
              Title   = "Place Label Center",
              Icon    = @filter_center_focus,
              Context = DiagramEditingContext,
              Group   = "text-place",
              Order   = 220 ]
        CommandDefinition
            [ Id      = "diagram.text.place.right",
              Title   = "Place Label Right",
              Icon    = @east,
              Context = DiagramEditingContext,
              Group   = "text-place",
              Order   = 230 ]
        CommandDefinition
            [ Id      = "diagram.text.place.bottom-left",
              Title   = "Place Label Bottom-Left",
              Icon    = @south_west,
              Context = DiagramEditingContext,
              Group   = "text-place",
              Order   = 240 ]
        CommandDefinition
            [ Id      = "diagram.text.place.bottom",
              Title   = "Place Label Bottom",
              Icon    = @south,
              Context = DiagramEditingContext,
              Group   = "text-place",
              Order   = 250 ]
        CommandDefinition
            [ Id      = "diagram.text.place.bottom-right",
              Title   = "Place Label Bottom-Right",
              Icon    = @south_east,
              Context = DiagramEditingContext,
              Group   = "text-place",
              Order   = 260 ]
        // Character decorations — bold / italic / underline / strikethrough. A
        // Toggles group (each reflects the selection's current run state).
        CommandDefinition
            [ Id           = "diagram.text.bold",
              Title        = "Bold",
              Icon         = @format_bold,
              Context      = DiagramEditingContext,
              Group        = "text-style",
              Order        = 270,
              Presentation = Toggles ]
        CommandDefinition
            [ Id      = "diagram.text.italic",
              Title   = "Italic",
              Icon    = @format_italic,
              Context = DiagramEditingContext,
              Group   = "text-style",
              Order   = 280 ]
        CommandDefinition
            [ Id      = "diagram.text.underline",
              Title   = "Underline",
              Icon    = @format_underlined,
              Context = DiagramEditingContext,
              Group   = "text-style",
              Order   = 290 ]
        CommandDefinition
            [ Id      = "diagram.text.strikethrough",
              Title   = "Strikethrough",
              Icon    = @format_strikethrough,
              Context = DiagramEditingContext,
              Group   = "text-style",
              Order   = 300 ]
        // Font family / size (+ steppers) / colour are NOT commands — they read &
        // write live selection state. They ride in a toolbar CONTROL instead (see
        // .ShellControls: below), bound to the document's IFontFormatSink.
    }

    // Non-command shell contributions — value editors the shell hosts in a region.
    // The font-format editor (Toolbar region) binds the active document's
    // IFontFormatSink surface (FontFamily / FontSize / FontColorHex + the two size
    // step commands); Order = 330 places it after the text-style toggles. The
    // connectors indicator rides the status bar (StatusBar region).
    .ShellControls: {
        // Zoom control — host-built camera UI (Commands region). Binds the live
        // canvas's zoom command DPs + Zoom readout through the published ActiveView.
        // Order 320 places it just ahead of the text controls.
        ShellControlDefinition
            [ Template = @ZoomControlEditor,
              Context  = DiagramEditingContext,
              Order    = 320 ]
        ShellControlDefinition
            [ Template = @FontFormatEditor,
              Context  = DiagramEditingContext,
              Order    = 330 ]
        // Connectors-mode indicator — a StatusBar-region control (a status cell, not
        // a command-bar button). Binds the document's ConnectorsModePinned; the
        // circle goes green + opaque when the mode is pinned.
        ShellControlDefinition
            [ Template = @ConnectorModeIndicator,
              Context  = DiagramEditingContext,
              Region   = StatusBar ]
    }

    // Shapes â€” the toolbox of shapes to drop onto the canvas.
    Capability [ Name = "Tool Box", Icon = @ToolBox, ServiceKey = ToolboxService ]
}
