// solution-dialogs.resources.mu -- the Solution Explorer's DIALOG templates, moved here
// from project-explorer.resources.mu (project-explorer retirement): New Project, Manage
// References, Set Version and Open Project, plus the shared reference-tree row template
// and the list-row button template they use. ConfirmDialogModel's template deliberately
// stays in project-explorer.resources.mu (shared; save-prompt relies on it).

import NewProjectDialogModel from "../../projects/new-project-dialog-model.js"
import ProjectTypeChoice from "../../projects/new-project-dialog-model.js"
import ReferenceNode from "../../projects/reference-node.js"
import ManageReferencesDialogModel from "../../projects/manage-references-dialog-model.js"
import OpenProjectDialogModel from "../../projects/open-project-dialog-model.js"
import RecentProjectItem from "../../projects/open-project-dialog-model.js"
import ShortenPath from "../../projects/shorten-path.js"
import SetVersionDialogModel from "../../projects/set-version-dialog-model.js"

resources SolutionDialogsResources {

    // ── New Project dialog ───────────────────────────────────────────────
    // One project-type choice: a full row (always shown, even for a single
    // factory). The leading marker (● / ○) is the VM-toggled selection glyph.
    DataTemplate [ DataType = ProjectTypeChoice ] {
        Button [ Template = @ListRowButton, Command = $SelectCommand, HorizontalAlignment = Stretch, Margin = (0,1,0,1) ] {
            DockPanel [ LastChildFill = true ] {
                TextBlock [ DockPanel.Dock = Left, Text = $Marker, Foreground = @ControlAccent,
                            Margin = (0,0,10,0), VerticalAlignment = Top ]
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @Body, Text = $Title, Foreground = @Fg1 ]
                    TextBlock [ Style = @BodySm, Text = $Description, Foreground = @Fg2, TextWrapping = Wrap ]
                }
            }
        }
    }

    // One row in the consolidated "References" tree, shared by both dialogs. A GROUP
    // node ("Meta-models" / "Libraries") is a bold header with no checkbox; a LEAF
    // node carries a Switch two-waying ReferenceNode.IsSelected + its `id @ version`
    // label. The Switch shows on leaves only (IsLeaf). itemsselector = Children walks
    // the group's leaves.
    HierarchicalDataTemplate x:key="ReferenceNodeTemplate" [ DataType = ReferenceNode, itemsselector = Children ] {
        DockPanel [ LastChildFill = true, Margin = (0,2,0,2) ] {
            Switch [ DockPanel.Dock = Left, IsChecked = $IsSelected, Margin = (0,0,8,0),
                     Visibility = $IsLeaf << ToVisibility ]
            TextBlock [ Text = $Label, Style = @Body, Foreground = @Fg1, VerticalAlignment = Center ]
        }
    }

    // Mirror each group's expansion from its data node so both sections open by
    // default (ReferenceNode.IsExpanded → TreeViewItem).
    Style x:key="ReferenceTreeItemStyle" [ TargetType = TreeViewItem ] {
        IsExpanded = $IsExpanded;
    }

    DataTemplate [ DataType = NewProjectDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @Body, Text = "Project type", Foreground = @Fg1, Margin = (0,0,0,4) ]
            Border [ Stroke = Pen [ Brush = @Border ], CornerRadius = 6,
                     Padding = (4,4,4,4), Margin = (0,0,0,14) ] {
                ItemsControl [ ItemsSource = $Types, ItemsPanel = @VerticalStackPanel ]
            }

            TextBlock [ Style = @Body, Text = "Name", Foreground = @Fg1 ]
            TextBox [ Text = $Name, Margin = (0,4,0,14) ]

            TextBlock [ Style = @Body, Text = "Location", Foreground = @Fg1 ]
            DockPanel [ LastChildFill = true, Margin = (0,4,0,8) ] {
                Button [ DockPanel.Dock = Right, Variant = Outlined, Command = $BrowseCommand, Margin = (8,0,0,0) ] {
                    TextBlock [ Text = "Browse…" ]
                }
                TextBox [ Text = $Location ]
            }

            // References — one consolidated tree (Meta-models + Libraries groups),
            // shown for a project type that requires a meta-model and/or offers
            // libraries. Each leaf's Switch two-ways ReferenceNode.IsSelected; a
            // library binds ≥1 meta-model, an architecture also picks libraries
            // (zero valid). Capped at 300dp so a large catalog scrolls in place.
            Border [ Visibility = $ShowReferences << ToVisibility, Margin = (0,4,0,8) ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @Body, Text = "References", Foreground = @Fg1 ]
                    TreeView [ Indent = 16, ItemsSource = $Roots, ItemTemplate = @ReferenceNodeTemplate,
                               ItemContainerStyle = @ReferenceTreeItemStyle,
                               MaxHeight = 300, Margin = (0,4,0,0) ]
                }
            }

            TextBlock [ Style = @BodySm, Text = $Error, Foreground = @StateDanger, TextWrapping = Wrap, Margin = (0,0,0,10) ]

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand, IsEnabled = $CanConfirm ] { TextBlock [ Text = "Create" ] }
            }
        }
    }

    // ── Manage References dialog ─────────────────────────────────────────
    // The consolidated references editor for a consumer project — one "References"
    // tree (Meta-models + Libraries groups) reusing @ReferenceNodeTemplate. Current
    // refs start checked, addable ones unchecked; a project binds ≥1 meta-model and
    // any number of libraries. The Libraries group shows only for a project that
    // offers libraries (architecture); a library project edits its meta-models alone.
    DataTemplate [ DataType = ManageReferencesDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @Body, Text = "References", Foreground = @Fg1, Margin = (0,0,0,4) ]
            TreeView [ Indent = 16, ItemsSource = $Roots, ItemTemplate = @ReferenceNodeTemplate,
                       ItemContainerStyle = @ReferenceTreeItemStyle, MaxHeight = 300 ]

            Border [ Visibility = $ShowLibraries << ToVisibility ] {
                TextBlock [ Style = @BodySm, Text = $EmptyLibrariesLabel, Foreground = @Fg2,
                            TextWrapping = Wrap, Margin = (0,2,0,0) ]
            }

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,14,0,0) ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand, IsEnabled = $CanConfirm ] { TextBlock [ Text = "Save" ] }
            }
        }
    }

    DataTemplate [ DataType = SetVersionDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @BodySm, Text = $Current, Foreground = @Fg2, Margin = (0,0,0,2) ]
            TextBox [ Text = $NewVersion, Margin = (0,0,0,6) ]
            StackPanel [ Orientation = Horizontal, Margin = (0,0,0,4) ] {
                Checkbox [ IsChecked = $Publish ]
                TextBlock [ Text = "Publish after setting", Foreground = @Fg1, VerticalAlignment = Center, Margin = (6,0,0,0) ]
            }
            TextBlock [ Style = @BodySm, Text = $Error, Foreground = @StateDanger, Margin = (0,0,0,10) ]
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
        Border x:name="PART_Row" [ Fill = #00000000, CornerRadius = @RadiusSm, Padding = (8,6,8,6) ] {
            ContentPresenter [ HorizontalAlignment = Stretch, VerticalAlignment = Center ]
        }
        when ( IsMouseOver ) { PART_Row.Fill = @RowHoverFill; }
        when ( IsPressed ) { PART_Row.Fill = @Bg3; }
    }

    // One recent-projects row: click to open (OpenCommand closes with its path).
    DataTemplate [ DataType = RecentProjectItem ] {
        Button [ Template = @ListRowButton, Command = $OpenCommand, HorizontalAlignment = Stretch, Margin = (0,1,0,1) ] {
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Style = @Body, Text = $Name, Foreground = @Fg1 ]
                // Path shown compactly (intermediate directories → `..`) so long
                // recents don't wrap; the full path stays in the model.
                TextBlock [ Style = @BodySm, Text = $Path << ShortenPath, Foreground = @Fg2, TextWrapping = Wrap ]
            }
        }
    }

    DataTemplate [ DataType = OpenProjectDialogModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @Body, Text = "Recent", Foreground = @Fg1, Margin = (0,0,0,4) ]
            // The recents list scrolls within a bounded height so a long MRU can't
            // grow the dialog past the viewport; the header and actions stay fixed.
            ScrollViewer [ MaxHeight = 360, VerticalScrollEnabled = true, HorizontalScrollEnabled = false ] {
                ItemsControl [ ItemsSource = $Recents, ItemsPanel = @VerticalStackPanel ]
            }
            TextBlock [ Style = @BodySm, Text = $EmptyLabel, Foreground = @Fg2, Margin = (0,2,0,0) ]

            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,14,0,0) ] {
                Button [ Variant = Outlined, Command = $BrowseCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Browse…" ] }
                Button [ Variant = Text, Command = $CancelCommand ] { TextBlock [ Text = "Cancel" ] }
            }
        }
    }
}
