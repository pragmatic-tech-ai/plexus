// project-explorer.resources.mu — the Project Explorer's left-panel view.
//
// Renders the generic ProjectExplorerService: a small command bar (Open / New
// project, Save), a status line, and the OPEN PROJECTS — each an OpenProject
// root (a header row carrying a right-click context menu of project-specific
// actions: New File / Publish / Close) over its file tree. A node's row binds
// its OpenCommand; the recursive DataTemplate[ProjectNode] gives arbitrary-depth
// folders.

import ProjectExplorerService from "./services/project-explorer-service.js"
import OpenProject from "../../services/projects/open-project.js"
import ProjectNode from "../../services/projects/project.js"
import KindToGeometry from "../../services/projects/project-node-icon.js"
import EditingToLabelVisibility from "../../services/projects/project-node-icon.js"
import NewProjectDialogModel from "../../services/projects/new-project-dialog-model.js"
import ProjectTypeChoice from "../../services/projects/new-project-dialog-model.js"
import LibraryChoice from "../../services/projects/new-project-dialog-model.js"
import ManageReferencesDialogModel from "../../services/projects/manage-references-dialog-model.js"
import OpenProjectDialogModel from "../../services/projects/open-project-dialog-model.js"
import RecentProjectItem from "../../services/projects/open-project-dialog-model.js"
import ShortenPath from "../../services/projects/shorten-path.js"
import ConfirmDialogModel from "../../services/dialogs/confirm-dialog-model.js"
import SetVersionDialogModel from "../../services/projects/set-version-dialog-model.js"
import TreeSelectionBehavior from "../../services/projects/tree-selection-behavior.js"
import TreeDragDropBehavior from "../../services/projects/tree-drag-drop-behavior.js"
import ProjectTreeTemplateBehavior from "../../services/projects/project-tree-template-behavior.js"
import NewItemChoice from "../../services/projects/new-item-choice.js"
import AgentSkillChoice from "../../modules/agent-chat/services/agent-skill-choice.js"

resources ProjectExplorerResources {

    // One row in an "Add New" submenu: a MenuItem whose Header/Command bind the
    // NewItemChoice. MenuItem is an ItemsControl, so the parent "Add New" item's
    // ItemsSource generates one of these per available project format.
    DataTemplate x:key="NewItemChoiceTemplate" [ DataType = NewItemChoice ] {
        MenuItem [ Header = $Label, Command = $Command ]
    }

    // One row in the "Run Agent / Skill" submenu — same shape as the Add New row,
    // one per the project's declared .claude/ agents + skills.
    DataTemplate x:key="AgentSkillChoiceTemplate" [ DataType = AgentSkillChoice ] {
        MenuItem [ Header = $Label, Command = $Command ]
    }

    // The project-specific actions — a shared context menu opened on a project's
    // header row. Its Command bindings resolve against that row's OpenProject.
    ContextMenu x:key="ProjectContextMenu" {
        MenuItem
            [ Header = "Add New",
              Icon = Shape [ Geometry = @NoteAdd, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ],
              ItemsControl.ItemsSource  = $NewItemChoices,
              ItemsControl.ItemTemplate = @NewItemChoiceTemplate ]
        MenuItem
            [ Header = "New Folder",
              Command = $NewFolderCommand,
              Icon = Shape [ Geometry = @NewFolder, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header = "Import File…",
              Command = $ImportFileCommand,
              Icon = Shape [ Geometry = @UploadFile, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header = "Import Folder…",
              Command = $ImportFolderCommand,
              Icon = Shape [ Geometry = @Folder, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header = "Publish",
              Command = $PublishCommand,
              Icon = Shape [ Geometry = @Publish, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem [ Header = "Generate Presentation" ] {
            MenuItem [ Header = "Colorful",   Command = $GeneratePresentationColorfulCommand ]
            MenuItem [ Header = "Monochrome", Command = $GeneratePresentationMonochromeCommand ]
        }
        MenuItem [ Header = "Bump Version" ] {
            MenuItem [ Header = "Major",   Command = $BumpVersionMajorCommand ]
            MenuItem [ Header = "Minor",   Command = $BumpVersionMinorCommand ]
            MenuItem [ Header = "Patch",   Command = $BumpVersionPatchCommand ]
            MenuSeparator
            MenuItem [ Header = "Custom…", Command = $SetVersionCommand ]
        }
        MenuItem [ Header = "Manage References…", Command = $ManageReferencesCommand ]
        MenuItem [ Header = "Refresh Bases", Command = $RefreshBasesCommand ]
        MenuItem [ Header = "Update Agent Meta-data", Command = $UpdateAgentMetadataCommand ]
        // Run one of the project's declared .claude/ agents or skills in the
        // background (opens as a conversation). Shown only when the catalog is
        // non-empty; its rows are generated from AgentSkillChoices.
        MenuItem
            [ Header = "Run Agent / Skill",
              Visibility = $HasAgentSkills << ToVisibility,
              ItemsControl.ItemsSource  = $AgentSkillChoices,
              ItemsControl.ItemTemplate = @AgentSkillChoiceTemplate ]
        MenuSeparator
        MenuItem [ Header = "Close Project", Command = $CloseCommand ]
    }

    // Per-node right-click menu: create a file / subfolder in the node's
    // containing folder (the host wires each so a folder node creates inside
    // itself, a file node beside itself). Commands resolve against the row's
    // ProjectNode DataContext.
    ContextMenu x:key="NodeContextMenu" {
        MenuItem
            [ Header = "Add New",
              Icon = Shape [ Geometry = @NoteAdd, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ],
              ItemsControl.ItemsSource  = $NewItemChoices,
              ItemsControl.ItemTemplate = @NewItemChoiceTemplate ]
        MenuItem
            [ Header = "New Folder",
              Command = $NewFolderCommand,
              Icon = Shape [ Geometry = @NewFolder, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header = "Import File…",
              Command = $ImportFileCommand,
              Icon = Shape [ Geometry = @UploadFile, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuItem
            [ Header = "Import Folder…",
              Command = $ImportFolderCommand,
              Icon = Shape [ Geometry = @Folder, Width = 16, Height = 16, HorizontalAlignment = Center, VerticalAlignment = Center ] ]
        MenuSeparator
        // Optional module-contributed action (e.g. arch "Edit Viewpoints…"),
        // shown only for nodes a contributor acted on (HasNodeAction).
        MenuItem [ Header = $NodeActionLabel, Command = $NodeActionCommand, Visibility = $HasNodeAction << ToVisibility ]
        // Export a .diagram file straight from the tree (rendered headlessly, no
        // editor open). Shown only for diagram nodes (HasExport).
        MenuItem [ Header = "Export", Visibility = $HasExport << ToVisibility ] {
            MenuItem [ Header = "Vector Graphics (SVG)", Command = $ExportSvgCommand ]
            MenuItem [ Header = "PowerPoint (PPTX)",     Command = $ExportPptxCommand ]
        }
        MenuItem [ Header = "Rename", Command = $BeginRenameCommand ]
        MenuItem [ Header = "Delete", Command = $DeleteCommand ]
    }

    // Keyed Style carrying only a KeyDown trigger. Applied to the plain Border
    // that wraps a project's TreeView (Borders have no default style to clobber,
    // unlike the TreeView itself): a focused row's F2 / Enter / Escape bubbles up
    // to this ancestor, where TreeKeyCommand drives rename begin / commit / cancel.
    Style x:key="TreeKeyStyle" [ TargetType = Border ] {
        on KeyDown { InvokeCommand [ Command = $TreeKeyCommand ] }
    }

    // The empty "off" state for a row's rename slot. Explicit (rather than an
    // unset ContentTemplate) so the ContentControl never falls back to
    // type-resolving its ProjectNode Content — which would re-stamp the row
    // template into itself. A zero-size element: nothing rendered, ~1 node.
    DataTemplate x:key="EmptyRenameTemplate" [ DataType = ProjectNode ] {
        Border [ Width = 0, Height = 0 ]
    }

    // The in-place rename editor, stamped ONLY while a node is being renamed
    // (the ProjectNodeTemplate's trigger swaps it in). FocusOnVisibleBehavior
    // focuses + selects the Plain TextBox on attach (it's already visible when
    // stamped), so lazy materialisation keeps the F2-to-type flow.
    DataTemplate x:key="RenameEditorTemplate" [ DataType = ProjectNode ] {
        Border {
            .Behaviors: { FocusOnVisibleBehavior }
            TextBox [ Text = $EditingName, Variant = Plain, MinWidth = 80, VerticalAlignment = Center,
                      SelectionBrush = @TextSelectionBrush ]
        }
    }

    // One tree row: a per-kind leading icon (Kind → geometry via KindToGeometry)
    // and the node's name, in a transparent Border that carries the row's
    // right-click NodeContextMenu. `itemsselector = Children` recurses the
    // template down the tree; the framework's default TreeView chrome supplies
    // the chevrons, indent guides, full-row hover, and selection.
    //
    // The rename editor is NOT instantiated per row. It lives behind
    // PART_RenameSlot, a ContentControl whose ContentTemplate is the empty
    // template until a `when(IsEditing)` trigger swaps in the real editor — so
    // the heavy Plain TextBox (its own template + caret-blink timer + input
    // listeners) is materialised only for the single node actually being
    // renamed, not once for every file/folder in the tree.
    HierarchicalDataTemplate x:key="ProjectNodeTemplate"
        [ DataType = ProjectNode, itemsselector = Children ] {
        Border x:root [ Fill = #00000000, ContextMenuService.ContextMenu = @NodeContextMenu ] {
            .Behaviors: { TreeDragDropBehavior }
            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                Shape [ Geometry = $Kind << KindToGeometry, Fill = @OnSurfaceVariant,
                        Width = 16, Height = 16, Margin = (0,0,6,0), VerticalAlignment = Center ]
                // Static label — hidden while the row is in rename mode.
                TextBlock [ Text = $Name, Style = @BodyMedium, VerticalAlignment = Center,
                            Visibility = $IsEditing << EditingToLabelVisibility ]
                // Lazy rename slot — empty until this row enters edit mode. A
                // ContentPresenter (not ContentControl) so ContentTemplate is a
                // real DP the trigger can swap; the explicit empty template keeps
                // it from type-resolving its ProjectNode Content into the row.
                ContentPresenter x:name="PART_RenameSlot"
                    [ Content = $Data, ContentTemplate = @EmptyRenameTemplate, VerticalAlignment = Center ]
            }
        }
        // Data trigger ($IsEditing, not IsEditing): a DataTemplate `when` fires on
        // a DATA-context path, not a property of the template's root Border. Without
        // the `$` the compiler drops it (property-triggers aren't supported in
        // DataTemplate bodies), so the rename editor never swapped in.
        when ( $IsEditing = true ) { PART_RenameSlot.ContentTemplate = @RenameEditorTemplate; }
    }

    // One open project — the tree's ROOT row. A header (project name + right-click
    // project context menu); expansion is the TreeViewItem's own chevron. The
    // hierarchical `itemsselector = Root.Children` makes the project's top-level
    // nodes this row's children, so files/folders nest under the project in the
    // one unified TreeView. The row template is picked per level by
    // ProjectTreeTemplateBehavior's ItemTemplateSelector (OpenProject → this
    // header, ProjectNode → the row below). The header carries the drag behavior so
    // it's a drop target for moving nodes into the project root.
    HierarchicalDataTemplate x:key="OpenProjectTemplate"
        [ DataType = OpenProject, itemsselector = Root.Children ] {
        Border x:root [ Fill = #00000000, HorizontalAlignment = Stretch,
                        ContextMenuService.ContextMenu = @ProjectContextMenu ] {
            .Behaviors: { TreeDragDropBehavior }
            TextBlock [ Style = @LabelLarge, Text = $Name, Foreground = @OnSurfaceVariant,
                        VerticalAlignment = Center ]
        }
    }

    // Command bar docked top, status strip docked bottom (pinned — always visible,
    // like a status bar), the scrolling project list filling the space between.
    DataTemplate [ DataType = ProjectExplorerService ] {
        DockPanel [ LastChildFill = true, Margin = (8,8,8,8) ] {
            StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,8) ] {
                PanelButton [ Margin = (0,0,4,0), Command = $OpenProjectCommand ] {
                    Shape [ Geometry = @Folder, Fill = @OnSurfaceVariant, Width = 20, Height = 20 ]
                }
                PanelButton [ Command = $NewProjectCommand ] {
                    Shape [ Geometry = @NewFolder, Fill = @OnSurfaceVariant, Width = 20, Height = 20 ]
                }
            }

            // Hairline separating the command bar from the project tree.
            Border [ DockPanel.Dock = Top, Height = 1, Fill = @OutlineVariant, Margin = (0,0,0,8) ]

            TextBlock [ DockPanel.Dock = Bottom, Style = @BodySmall, Text = $Status, Foreground = @OnSurfaceVariant,
                        TextWrapping = Wrap, Margin = (0,8,0,0) ]

            // The whole project list is ONE TreeView (roots = open projects,
            // descendants = files/folders), so its built-in ScrollViewer is the
            // single scroll region — no nested per-project scrollbars. The wrapper
            // Border carries the tree's KeyDown → the service's TreeKeyCommand
            // (F2 / Delete / Enter / Escape), routed to whichever project holds
            // the current selection.
            Border [ Style = @TreeKeyStyle ] {
                // IsVirtualizing: only realize the rows in the viewport, not the
                // whole open-projects file tree. Navigating here built every node
                // eagerly (a synchronous ~O(all nodes) tree materialisation in the
                // nav-click handler — resource Resolve + style subscribe + SVG
                // create + GC per row), freezing the UI on first open. The
                // meta-model tree already virtualizes the same way.
                TreeView [ Indent = 14, IsVirtualizing = true, ItemsSource = $OpenProjects, ItemTemplate = @OpenProjectTemplate,
                           SelectionMode = Extended, AllowMarqueeSelection = true ] {
                    .Behaviors: { ProjectTreeTemplateBehavior TreeSelectionBehavior }
                }
            }
        }
    }

    // ── New Project dialog ───────────────────────────────────────────────
    // One project-type choice: a full row (always shown, even for a single
    // factory). The leading marker (● / ○) is the VM-toggled selection glyph.
    DataTemplate [ DataType = ProjectTypeChoice ] {
        Button [ Template = @ListRowButton, Command = $SelectCommand, HorizontalAlignment = Stretch, Margin = (0,1,0,1) ] {
            DockPanel [ LastChildFill = true ] {
                TextBlock [ DockPanel.Dock = Left, Text = $Marker, Foreground = @Primary,
                            Margin = (0,0,10,0), VerticalAlignment = Top ]
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @BodyLarge, Text = $Title, Foreground = @OnSurface ]
                    TextBlock [ Style = @BodySmall, Text = $Description, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
                }
            }
        }
    }

    // The dialog body (DialogService supplies the surface, title, and padding).
    // HorizontalAlignment = Stretch so the panel fills the dialog width — a bare
    // StackPanel shrinks to its widest child and the content presenter pins it
    // to one side (leaving Name/Location collapsed).

    // One library row in the architecture picker's checklist: a Switch two-waying
    // LibraryChoice.IsSelected + its `id @ version` label.
    DataTemplate [ DataType = LibraryChoice ] {
        DockPanel [ LastChildFill = true, Margin = (0,2,0,2) ] {
            Switch [ DockPanel.Dock = Left, IsChecked = $IsSelected, Margin = (0,0,8,0) ]
            TextBlock [ Text = $Label, Style = @BodyMedium, Foreground = @OnSurface, VerticalAlignment = Center ]
        }
    }

    DataTemplate [ DataType = NewProjectDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodyLarge, Text = "Project type", Foreground = @OnSurface, Margin = (0,0,0,4) ]
            Border [ Stroke = Pen [ Brush = @OutlineVariant ], CornerRadius = 6,
                     Padding = (4,4,4,4), Margin = (0,0,0,14) ] {
                ItemsControl [ ItemsSource = $Types, ItemsPanel = @VerticalStackPanel ]
            }

            TextBlock [ Style = @BodyLarge, Text = "Name", Foreground = @OnSurface ]
            TextBox [ Text = $Name, Margin = (0,4,0,14) ]

            TextBlock [ Style = @BodyLarge, Text = "Location", Foreground = @OnSurface ]
            DockPanel [ LastChildFill = true, Margin = (0,4,0,8) ] {
                Button [ DockPanel.Dock = Right, Variant = Outlined, Command = $BrowseCommand, Margin = (8,0,0,0) ] {
                    TextBlock [ Text = "Browse…" ]
                }
                TextBox [ Text = $Location ]
            }

            // Meta-model picker — shown only for a project type that requires a
            // base meta-model (library today, architecture later). The combo lists
            // the published meta-models as `id @ version` (MetaModelChoice.Label).
            Border [ Visibility = $ShowMetaModelPicker << ToVisibility, Margin = (0,4,0,8) ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @BodyLarge, Text = "Meta-model", Foreground = @OnSurface ]
                    ComboBox [ ItemsSource = $MetaModels, SelectedItem = $SelectedMetaModel,
                               Margin = (0,4,0,0), HorizontalAlignment = Stretch ]
                }
            }

            // Libraries picker — shown only for a project type that offers
            // libraries (architecture). A checklist of published libraries; each
            // row's Switch two-ways LibraryChoice.IsSelected. Zero selected is valid.
            Border [ Visibility = $ShowLibrariesPicker << ToVisibility, Margin = (0,4,0,8) ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @BodyLarge, Text = "Libraries", Foreground = @OnSurface ]
                    ItemsControl [ ItemsSource = $Libraries, ItemsPanel = @VerticalStackPanel, Margin = (0,4,0,0) ]
                }
            }

            TextBlock [ Style = @BodySmall, Text = $Error, Foreground = @Error, TextWrapping = Wrap, Margin = (0,0,0,10) ]

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand, IsEnabled = $CanConfirm ] { TextBlock [ Text = "Create" ] }
            }
        }
    }

    // ── Manage References dialog ─────────────────────────────────────────
    // The consolidated references editor for a consumer project. A ComboBox swaps
    // the required meta-model; a checklist (reusing DataTemplate[LibraryChoice])
    // adds/removes libraries — current refs start checked, addable ones unchecked.
    // The libraries section shows only for a project that offers libraries
    // (architecture); a library project edits its meta-model alone.
    DataTemplate [ DataType = ManageReferencesDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodyLarge, Text = "Meta-model", Foreground = @OnSurface, Margin = (0,0,0,4) ]
            ComboBox [ ItemsSource = $MetaModels, SelectedItem = $SelectedMetaModel,
                       HorizontalAlignment = Stretch, Margin = (0,0,0,14) ]

            Border [ Visibility = $ShowLibraries << ToVisibility ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @BodyLarge, Text = "Libraries", Foreground = @OnSurface, Margin = (0,0,0,4) ]
                    ItemsControl [ ItemsSource = $Libraries, ItemsPanel = @VerticalStackPanel ]
                    TextBlock [ Style = @BodySmall, Text = $EmptyLibrariesLabel, Foreground = @OnSurfaceVariant,
                                TextWrapping = Wrap, Margin = (0,2,0,0) ]
                }
            }

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,14,0,0) ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand, IsEnabled = $CanConfirm ] { TextBlock [ Text = "Save" ] }
            }
        }
    }

    // ── Confirm dialog ───────────────────────────────────────────────────
    // A reusable message + Cancel / confirm pair (DialogService supplies the
    // title/surface). The confirm button's label comes from the VM so it reads
    // as the action ("Delete"); it's Filled to sit as the primary affordance.
    DataTemplate [ DataType = ConfirmDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodyLarge, Text = $Message, Foreground = @OnSurface, TextWrapping = Wrap, Margin = (0,0,0,16) ]
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand ] { TextBlock [ Text = $ConfirmLabel ] }
            }
        }
    }

    DataTemplate [ DataType = SetVersionDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodySmall, Text = $Current, Foreground = @OnSurfaceVariant, Margin = (0,0,0,2) ]
            TextBox [ Text = $NewVersion, Margin = (0,0,0,6) ]
            StackPanel [ Orientation = Horizontal, Margin = (0,0,0,4) ] {
                Checkbox [ IsChecked = $Publish ]
                TextBlock [ Text = "Publish after setting", Foreground = @OnSurface, VerticalAlignment = Center, Margin = (6,0,0,0) ]
            }
            TextBlock [ Style = @BodySmall, Text = $Error, Foreground = @Error, Margin = (0,0,0,10) ]
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand, IsEnabled = $CanConfirm ] { TextBlock [ Text = "Set Version" ] }
            }
        }
    }

    // ── Open Project dialog ──────────────────────────────────────────────
    // Left-aligned clickable list row. The M3 Text-button template centers its
    // content and pads it, so a row reads as indented by however much shorter it
    // is than the widest one. This template stretches the content full-width and
    // left-aligns it, keeping a subtle hover/press state layer for the click.
    Template x:key="ListRowButton" [ TargetType = Button ] {
        Border x:name="PART_Row" [ Fill = #00000000, CornerRadius = @ShapeExtraSmall, Padding = (8,6,8,6) ] {
            ContentPresenter [ HorizontalAlignment = Stretch, VerticalAlignment = Center ]
        }
        when ( IsMouseOver ) { PART_Row.Fill = @StateHoverOverlay; }
        when ( IsPressed ) { PART_Row.Fill = @StatePressOverlay; }
    }

    // One recent-projects row: click to open (OpenCommand closes with its path).
    DataTemplate [ DataType = RecentProjectItem ] {
        Button [ Template = @ListRowButton, Command = $OpenCommand, HorizontalAlignment = Stretch, Margin = (0,1,0,1) ] {
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Style = @BodyLarge, Text = $Name, Foreground = @OnSurface ]
                // Path shown compactly (intermediate directories → `..`) so long
                // recents don't wrap; the full path stays in the model.
                TextBlock [ Style = @BodySmall, Text = $Path << ShortenPath, Foreground = @OnSurfaceVariant, TextWrapping = Wrap ]
            }
        }
    }

    DataTemplate [ DataType = OpenProjectDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodyLarge, Text = "Recent", Foreground = @OnSurface, Margin = (0,0,0,4) ]
            // The recents list scrolls within a bounded height so a long MRU can't
            // grow the dialog past the viewport; the header and actions stay fixed.
            ScrollViewer [ MaxHeight = 360, VerticalScrollEnabled = true, HorizontalScrollEnabled = false ] {
                ItemsControl [ ItemsSource = $Recents, ItemsPanel = @VerticalStackPanel ]
            }
            TextBlock [ Style = @BodySmall, Text = $EmptyLabel, Foreground = @OnSurfaceVariant, Margin = (0,2,0,0) ]

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,14,0,0) ] {
                Button [ Variant = Outlined, Command = $BrowseCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Browse…" ] }
                Button [ Variant = Text, Command = $CancelCommand ] { TextBlock [ Text = "Cancel" ] }
            }
        }
    }
}
