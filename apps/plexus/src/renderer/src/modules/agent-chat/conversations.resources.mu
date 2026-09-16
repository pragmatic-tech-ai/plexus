// The Conversations navigation panel — a Claude-style session manager. A New
// session button, a search box that two-ways $SearchText, and two restyled
// groups (OPEN = live dock tabs, STORED = restorable) bound to the filtered
// $VisibleOpen / $VisibleStored views. Each row shows the title, a relative-time
// label (stored), and Rename / Close|Delete actions; double-clicking or the pencil
// swaps the title for an inline editor. Rendered in the left side pane by
// DataTemplate[ChatSessionsService] (the module's Capability ServiceKey). Row
// templates are x:key'd (not implicit) so they don't shadow the implicit
// DataTemplate[ChatSession] that renders the full chat panel in the dock.

import ChatSessionsService from "./services/chat-sessions-service.js"
import ChatSession from "./services/chat-session.js"
import StoredConversationRow from "./services/stored-conversation-row.js"
import ApprovalRulesVM from "./services/approval-rules.js"
import EditingToLabelVisibility from "../../services/projects/project-node-icon.js"

resources ConversationsResources {
    // Full-width, left-aligned clickable row with a subtle hover/press state layer
    // (the M3 Text button centres + pads its content). Covers the title area — the
    // per-row action buttons are siblings, not descendants, so a click on an action
    // never also triggers the row's open/reveal command.
    Template x:key="ConversationRowButton" [ TargetType = Button ] {
        Border x:name="PART_Row" [ Fill = #00000000, CornerRadius = 6, Padding = (6,5,6,5) ] {
            ContentPresenter [ HorizontalAlignment = Stretch, VerticalAlignment = Center ]
        }
        when ( IsMouseOver ) { PART_Row.Fill = @StateHoverOverlay; }
        when ( IsPressed ) { PART_Row.Fill = @StatePressOverlay; }
    }

    // Small transparent icon button for the per-row Rename / Close / Delete actions.
    Template x:key="RowIconButton" [ TargetType = Button ] {
        Border x:name="PART_Bg" [ Fill = #00000000, CornerRadius = 4, Padding = (3,3,3,3) ] {
            ContentPresenter [ HorizontalAlignment = Center, VerticalAlignment = Center ]
        }
        when ( IsMouseOver ) { PART_Bg.Fill = @StateHoverOverlay; }
        when ( IsPressed ) { PART_Bg.Fill = @StatePressOverlay; }
    }

    // KeyDown on the inline rename editor → RenameKeyCommand (Return commits,
    // Escape cancels), mirroring the project tree's TreeKeyStyle. On a plain Border
    // (no default style to clobber) wrapping the editor TextBox.
    Style x:key="RenameKeyStyle" [ TargetType = Border ] {
        on KeyDown { InvokeCommand [ Command = $RenameKeyCommand ] }
    }

    DataTemplate [ DataType = ChatSessionsService ] {
        DockPanel [ LastChildFill = true, Margin = (8,8,8,8) ] {
            // New session — pinned to the top. A full-width Tonal button (sizes its
            // height to the label; PanelButton is a fixed-size IconButton that clipped
            // the text).
            Button [ DockPanel.Dock = Top, Variant = Tonal, Command = $NewConversationCommand,
                     HorizontalAlignment = Stretch, Margin = (0,0,0,8) ] {
                TextBlock [ Text = "＋ New session", Style = @LabelLarge, TextWrapping = Wrap, HorizontalAlignment = Center ]
            }

            // Search box — a magnifier + a TextBox two-waying $SearchText, with a
            // placeholder shown (behind the transparent editor) while it's empty.
            Border [ DockPanel.Dock = Top, Stroke = Pen [ Brush = @OutlineVariant ], CornerRadius = 8,
                     Padding = (8,2,8,2), Margin = (0,0,0,8) ] {
                DockPanel [ LastChildFill = true ] {
                    Shape [ DockPanel.Dock = Left, Geometry = @Search, Fill = @OnSurfaceVariant,
                            Width = 16, Height = 16, VerticalAlignment = Center, Margin = (0,0,6,0) ]
                    // Auto row: hug the field height. Without it the Grid falls back to a
                    // single Star row and greedily fills the pane's remaining height.
                    Grid {
                        RowDefinitions { RowDefinition [ Height = GridLength.Auto ] }
                        TextBlock [ Text = "Search sessions…", Style = @BodyMedium, Foreground = @OnSurfaceVariant,
                                    VerticalAlignment = Center, Visibility = $SearchEmpty << ToVisibility ]
                        TextBox [ Text = $SearchText, Variant = Plain, VerticalAlignment = Center,
                                  SelectionBrush = @TextSelectionBrush ]
                    }
                }
            }

            // Workspace-shared approved tools — one button that pops the list (the
            // persistent tool-approval rules for the agent cwd) in a modal dialog.
            Button [ DockPanel.Dock = Top, Variant = Text, Command = $OpenApprovedToolsCommand,
                     HorizontalAlignment = Left, Margin = (0,0,0,8) ] {
                StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                    Shape [ Geometry = @Shield, Fill = @OnSurfaceVariant, Width = 16, Height = 16, VerticalAlignment = Center, Margin = (0,0,6,0) ]
                    TextBlock [ Text = "Approved tools", Style = @BodyMedium, Foreground = @OnSurfaceVariant, VerticalAlignment = Center ]
                }
            }

            ScrollViewer [ HorizontalScrollEnabled = false ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Style = @LabelSmall, Text = "OPEN", Foreground = @OnSurfaceVariant, Margin = (0,0,0,4), TextWrapping = Wrap ]
                    ItemsControl [ ItemsSource = $VisibleOpen, ItemsPanel = @VerticalStackPanel, ItemTemplate = @OpenConversationRow ]
                    TextBlock [ Style = @LabelSmall, Text = "STORED", Foreground = @OnSurfaceVariant, Margin = (0,10,0,4), TextWrapping = Wrap ]
                    ItemsControl [ ItemsSource = $VisibleStored, ItemsPanel = @VerticalStackPanel, ItemTemplate = @StoredConversationRow ]
                }
            }
        }
    }

    // One live conversation row: click focuses its tab (RevealCommand); Rename /
    // Close on the right. The title Grid z-stacks the static title (hidden while
    // renaming) over the inline edit TextBox (shown while renaming);
    // FocusOnVisibleBehavior focuses the box when it becomes visible.
    DataTemplate x:key="OpenConversationRow" [ DataType = ChatSession ] {
        DockPanel [ LastChildFill = true, Margin = (0,1,0,1) ] {
            StackPanel [ DockPanel.Dock = Right, Orientation = Horizontal, VerticalAlignment = Center ] {
                Button [ Template = @RowIconButton, Command = $BeginRenameCommand, Margin = (2,0,0,0) ] {
                    Shape [ Geometry = @Edit, Fill = @OnSurfaceVariant, Width = 15, Height = 15 ]
                }
                Button [ Template = @RowIconButton, Command = $CloseCommand, Margin = (2,0,0,0) ] {
                    Shape [ Geometry = @Close, Fill = @OnSurfaceVariant, Width = 15, Height = 15 ]
                }
            }
            Button [ Template = @ConversationRowButton, Command = $RevealCommand, HorizontalAlignment = Stretch ] {
                Grid {
                    RowDefinitions { RowDefinition [ Height = GridLength.Auto ] }
                    TextBlock [ Text = $Title, Style = @BodyMedium, Foreground = @OnSurface, VerticalAlignment = Center,
                                TextWrapping = NoWrap, TextTrimming = CharacterEllipsis, Visibility = $IsEditing << EditingToLabelVisibility ]
                    Border [ Style = @RenameKeyStyle, Visibility = $IsEditing << ToVisibility ] {
                        .Behaviors: { FocusOnVisibleBehavior }
                        TextBox [ Text = $EditTitle, Variant = Plain, VerticalAlignment = Center, SelectionBrush = @TextSelectionBrush ]
                    }
                }
            }
        }
    }

    // One stored (restorable) conversation row: click reopens it (OpenCommand);
    // a relative-time label + Rename / Delete on the right. Title Grid as above.
    DataTemplate x:key="StoredConversationRow" [ DataType = StoredConversationRow ] {
        DockPanel [ LastChildFill = true, Margin = (0,1,0,1) ] {
            StackPanel [ DockPanel.Dock = Right, Orientation = Horizontal, VerticalAlignment = Center ] {
                TextBlock [ Text = $TimeAgo, Style = @BodySmall, Foreground = @OnSurfaceVariant, VerticalAlignment = Center, Margin = (6,0,2,0) ]
                Button [ Template = @RowIconButton, Command = $BeginRenameCommand, Margin = (2,0,0,0) ] {
                    Shape [ Geometry = @Edit, Fill = @OnSurfaceVariant, Width = 15, Height = 15 ]
                }
                Button [ Template = @RowIconButton, Command = $DeleteCommand, Margin = (2,0,0,0) ] {
                    Shape [ Geometry = @Delete, Fill = @OnSurfaceVariant, Width = 15, Height = 15 ]
                }
            }
            Button [ Template = @ConversationRowButton, Command = $OpenCommand, HorizontalAlignment = Stretch ] {
                Grid {
                    RowDefinitions { RowDefinition [ Height = GridLength.Auto ] }
                    TextBlock [ Text = $Title, Style = @BodyMedium, Foreground = @OnSurface, VerticalAlignment = Center,
                                TextWrapping = NoWrap, TextTrimming = CharacterEllipsis, Visibility = $IsEditing << EditingToLabelVisibility ]
                    Border [ Style = @RenameKeyStyle, Visibility = $IsEditing << ToVisibility ] {
                        .Behaviors: { FocusOnVisibleBehavior }
                        TextBox [ Text = $EditTitle, Variant = Plain, VerticalAlignment = Center, SelectionBrush = @TextSelectionBrush ]
                    }
                }
            }
        }
    }

    // The "Approved tools" dialog body (DialogService supplies the window chrome +
    // title). The list of persistent tool-approval rules ($Rules, each rendered by
    // the app-global DataTemplate[ApprovalRuleRow] with its Revoke), or an empty
    // state when the workspace has granted none yet. Revoking a row refreshes in
    // place. Scrim-click dismisses (DismissOnScrimClick).
    DataTemplate [ DataType = ApprovalRulesVM ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            ItemsControl [ ItemsSource = $Rules, ItemsPanel = @VerticalStackPanel, Visibility = $HasRules << ToVisibility ]
            TextBlock [ Text = "No tools approved yet. When you allow a tool during a chat, it appears here.",
                        Style = @BodyMedium, Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Visibility = $HasRules << EditingToLabelVisibility ]
        }
    }
}
