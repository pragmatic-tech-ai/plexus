// solution-explorer.resources.mu — the Solution Explorer's left-panel view.
//
// Renders SolutionExplorerService: a small command bar (the surviving Open / New
// project commands, surfaced by the capability as pass-throughs to the
// ProjectCommandsService), a hairline, an empty-state line, and ONE virtualized
// TreeView over the stable Hierarchy. The tree opts into mural's default
// @HierarchyTreeView style (tree chrome + the default ItemTemplate's structure —
// icon + caption + inline-rename) and attaches the four default hierarchy
// behaviors — tree (selection/expansion/keyboard), context menu, drop and drag —
// each bound from the SAME $Hierarchy. The hand-written action / context-menu /
// custom-item templates + custom behavior bundle are retired.
//
// ItemTemplate is overridden with @SolutionExplorerItemTemplate below — a LOCAL
// value on the TreeView wins over the Style setter (same DP-tier precedence as any
// other Style; see hierarchy.template.mu's own ruling comment on this exact pattern).
// The override mirrors the default template's structure exactly (StackPanel >
// Shape "PART_Icon" + EditableTextBlock "PART_Caption") but resolves the icon through
// Plexus's IconKeyToGeometry instead of the framework's HierarchyIconKeyToGeometry:
// the default converter treats IconKey as a mural RESOURCE key
// (Application.ResolveDefaultResource), but Plexus's IconKey strings (NodeKey /
// ProjectNodeKind / reference- and connection-leaf keys) are not resource keys — they
// were never themed geometry names — so the default converter resolves nothing and
// every row renders iconless. IconKeyToGeometry resolves the SAME way the pre-
// migration custom template did (IconKeyGlyphs.For(iconKey) -> glyph name ->
// Application.current.Resources.Resolve(...)).
//
// DataContext is set on the TreeView itself via $service (not inherited) because the
// behaviors attach before parent DataContext inheritance is live — and
// HierarchyContextMenuBehavior throws on an undefined Hierarchy. ItemsSource is a
// body SLOT-ASSIGN placed AFTER .Behaviors: so the behaviors attach before the rows
// realize (inline-rename wiring on already-live rows depends on that order).
//
// RULING (Delete-key shortcut — Task 5 regression Concern 2, deferred): the deleted
// TreeKeyCommand/HierarchyKeyBehavior path gave the tree a direct Delete-key shortcut
// (host.Delete(anchor) — the same method SolutionExplorerService.Delete still
// implements as "the key-Delete peer of the menu Remove"). The C1 default bundle
// wires only F2 (rename) — no Delete. CommandDefinition (framework/shell/commands)
// carries no key-gesture property at all, so there is no "add a gesture to the
// existing Remove CommandDefinition" option. The one generic, non-hierarchy-specific
// C1 primitive for this is Control.InputBindings { KeyBinding[...] } — tried here as
// `KeyBinding[Key=Delete, Command=$DeleteAnchorCommand]` on the TreeView — but probing
// the installed compiler (`compile()` on a standalone KeyBinding[Command=$Prop]
// snippet) shows it lowers to `keyBinding.Command = DataContextBinding(keyBinding,
// "Prop")`: the DataContextBinding target is the KeyBinding value-object itself (not
// the host Visual), and KeyBinding has no DataContext — so the $-bound Command never
// resolves to a real ICommand (the input-binding.ts doc comment's own
// `Command=$SaveCommand` example is unexercised by any test). That is a mural-side
// compiler gap, not something to patch from Plexus. The remaining option — a bespoke
// Behavior subclass re-implementing the deleted HierarchyKeyBehavior's KeyDown
// handling — is exactly the kind of custom key behavior this migration retired.
// Per the task brief, NOT forcing either: the context-menu Remove stays the sole
// delete affordance; the bare Delete key is deferred to Wave 5 (pending either a
// mural fix to KeyBinding/InputBindings DataContext resolution, or an explicit call
// to re-add a small dedicated key behavior).

import SolutionExplorerService from "./services/solution-explorer-service.js"
import HierarchyTreeBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy"
import HierarchyContextMenuBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy"
import HierarchyDropBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy"
import HierarchyDragBehavior from "@pragmatic-tech-ai/mural/framework/hierarchy"
import HierarchyItem from "@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-item.js"
import EditableTextBlock from "@pragmatic-tech-ai/mural/basic/editable-text-block.js"
import IconKeyToGeometry from "./services/icon-key-to-geometry.js"

resources SolutionExplorerResources {

    // Compact command-bar button. The default PanelButton template (@DefaultIconButton)
    // is a FIXED 40dp box — far too tall for the Solution Explorer command strip. This
    // sizes to content (16dp icon + 4dp padding ≈ 24dp) and hovers to @Bg3 (not @Bg2,
    // which is invisible on the @Bg2 side pane — same contrast rule as the tree rows).
    Template x:key="CompactPanelButton" [ TargetType = PanelButton ] {
        Border x:name="PART_FocusRing"
            [ Fill = #00000000, Padding = (@FocusRingOffset), CornerRadius = $$CornerRadius ] {
            Border x:name="PART_Root"
                [ Fill = #00000000, CornerRadius = $$CornerRadius, Padding = (4,4,4,4),
                  TextBlock.Foreground = @Fg1 ] {
                ContentPresenter x:name="PART_Content" [ HorizontalAlignment = Center, VerticalAlignment = Center ]
            }
        }
        when ( IsMouseOver )       { PART_Root.Fill = @Bg3; }
        when ( IsPressed )         { PART_Root.Fill = @Bg3; }
        when ( IsFocused )         { PART_FocusRing.Stroke = Pen [ Brush = @BorderFocus, Thickness = 2 ]; }
        when ( IsEnabled = false ) { PART_Root.Opacity = @OpacityDisabled; }
    }

    // Thin override of mural's default @HierarchyItemTemplate (hierarchy.template.mu)
    // — same shape, Plexus's own icon resolution. See the file header comment above.
    HierarchicalDataTemplate x:key="SolutionExplorerItemTemplate"
        [ DataType = HierarchyItem, itemsselector = Children ] {
        StackPanel [ Orientation = Horizontal ] {
            Shape x:name="PART_Icon" [ Geometry = $IconKey << IconKeyToGeometry, Width = 16, Height = 16 ]
            // Gap between the icon and the caption so glyph and label don't touch.
            EditableTextBlock x:name="PART_Caption"
                [ Text = $Caption, IsEditing = $IsEditing, EditingText = $EditingName, Margin = (6,0,0,0) ]
        }
    }

    // Command bar docked top (Open / New project — the surviving lifecycle commands,
    // surfaced by the capability), a hairline, the empty-state line pinned bottom, and
    // the virtualized hierarchy TreeView filling the space between.
    DataTemplate [ DataType = SolutionExplorerService ] {
        DockPanel [ LastChildFill = true, Margin = (8,3,8,6) ] {
            // Compact command bar: a tight button row (@CompactPanelButton keeps the
            // vertical footprint small — the default PanelButton is a fixed 40dp box,
            // far too tall here). 3dp above / 4dp below keeps the strip slim.
            StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,4) ] {
                PanelButton [ Margin = (0,0,4,0), Template = @CompactPanelButton, Command = $OpenProjectCommand ] {
                    Shape [ Geometry = @Folder, Fill = @Fg2, Width = 16, Height = 16 ]
                }
                PanelButton [ Template = @CompactPanelButton, Command = $NewProjectCommand ] {
                    Shape [ Geometry = @NewFolder, Fill = @Fg2, Width = 16, Height = 16 ]
                }
            }

            // Hairline separating the command bar from the tree.
            Border [ DockPanel.Dock = Top, Height = 1, Fill = @Border, Margin = (0,0,0,4) ]

            // Empty state — shown (ToVisibility: true → Visible) when no solution is open.
            TextBlock [ DockPanel.Dock = Bottom, Style = @BodySm, Foreground = @Fg2,
                        Text = "No solution open.", Margin = (0,8,0,0),
                        Visibility = $HasNoSolution << ToVisibility ]

            // The whole hierarchy is ONE virtualized TreeView (roots = solution members +
            // the Connections branch, descendants = folders/files/references/connections),
            // so its built-in ScrollViewer is the single scroll region. @HierarchyTreeView
            // supplies the tree chrome; ItemTemplate is a local override (@SolutionExplorerItemTemplate
            // — see file header) so icons resolve through Plexus's own converter; the four
            // default behaviors are bound from the service's stable $Hierarchy; ItemsSource is
            // slot-assigned AFTER .Behaviors:.
            TreeView [ DataContext = $service(SolutionExplorerService), Style = @HierarchyTreeView,
                       ItemTemplate = @SolutionExplorerItemTemplate,
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
