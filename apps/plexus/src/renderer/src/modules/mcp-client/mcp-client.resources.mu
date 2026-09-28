// mcp-client.resources.mu — view resources for the "MCP Servers" capability
// (McpServersService). Merged app-global by app.mu. A list of registered MCP
// servers (global + project) with an add/edit editor and an import panel, all
// rendered through templates. Child rows/editor/import are Observable VMs; the
// transport/gating enums never appear here — the VMs expose option lists +
// boolean flags, so the panel binds those instead.
//
// Labelled actions use Button (Text / Tonal variants), NOT PanelButton — the
// latter is a fixed-size icon button whose hit area doesn't cover a text label.

import McpServersService from "./services/mcp-servers-service.js"
import McpServerRow from "./services/mcp-server-row.js"
import McpServerEditor from "./services/mcp-server-editor.js"
import KeyValueRow from "./services/mcp-editor-rows.js"
import ToolToggle from "./services/mcp-editor-rows.js"
import McpImport from "./services/mcp-import.js"
import ImportRow from "./services/mcp-import.js"

resources McpClientResources {

    // ── one server row ──────────────────────────────────────────────────────
    DataTemplate x:key="McpServerRowTemplate" [ DataType = McpServerRow ] {
        Border [ Fill = @Bg2, CornerRadius = 6, Padding = (10,8,10,8), Margin = (0,0,0,6) ] {
            DockPanel [ LastChildFill = true ] {
                Switch [ DockPanel.Dock = Left, IsChecked = $Enabled, VerticalAlignment = Center, Margin = (0,0,10,0) ]
                Button [ DockPanel.Dock = Right, Variant = Text, Command = $RemoveCommand, Margin = (4,0,0,0) ] {
                    TextBlock [ Text = "Remove", Style = @BodySm ]
                }
                Button [ DockPanel.Dock = Right, Variant = Text, Command = $EditCommand ] {
                    TextBlock [ Text = "Edit", Style = @BodySm ]
                }
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Text = $Label, Style = @Body, Foreground = @Fg1 ]
                    TextBlock [ Text = $TransportSummary, Style = @BodySm, Foreground = @Fg2, TextTrimming = CharacterEllipsis ]
                    StackPanel [ Orientation = Horizontal, Margin = (0,2,0,0) ] {
                        TextBlock [ Text = $ScopeLabel, Style = @BodySm, Foreground = @Fg2, Margin = (0,0,8,0) ]
                        TextBlock [ Text = $GatingBadge, Style = @BodySm, Foreground = @Fg2 ]
                        TextBlock [ Text = $LastStatus, Style = @BodySm, Foreground = @Fg2, Margin = (8,0,0,0) ]
                    }
                }
            }
        }
    }

    // ── one env / header row inside the editor ──────────────────────────────
    DataTemplate x:key="KeyValueRowTemplate" [ DataType = KeyValueRow ] {
        StackPanel [ Orientation = Horizontal, Margin = (0,0,0,4) ] {
            TextBox [ Text = $Name, Width = 120, Margin = (0,0,6,0) ]
            ComboBox [ ItemsSource = $SourceKinds, SelectedItem = $SourceKind, Width = 84, Margin = (0,0,6,0) ]
            TextBox [ Text = $Value, Width = 160, Margin = (0,0,6,0) ]
            Button [ Variant = Text, Command = $RemoveCommand ] { TextBlock [ Text = "Remove", Style = @BodySm ] }
        }
    }

    // ── one discovered tool in the per-tool checklist ───────────────────────
    DataTemplate x:key="ToolToggleTemplate" [ DataType = ToolToggle ] {
        StackPanel [ Orientation = Horizontal, Margin = (0,0,0,2) ] {
            Switch [ IsChecked = $Checked, VerticalAlignment = Center, Margin = (0,0,8,0) ]
            TextBlock [ Text = $Name, Style = @BodySm, Foreground = @Fg1, VerticalAlignment = Center ]
        }
    }

    // ── the add/edit editor ─────────────────────────────────────────────────
    DataTemplate [ DataType = McpServerEditor ] {
        Border [ Fill = @Bg2, CornerRadius = 6, Padding = (12,12,12,12), Margin = (0,0,0,8) ] {
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Text = "Key", Style = @BodySm, Foreground = @Fg2 ]
                TextBox [ Text = $Key, Margin = (0,0,0,6) ]
                TextBlock [ Text = "Display name", Style = @BodySm, Foreground = @Fg2 ]
                TextBox [ Text = $Label, Margin = (0,0,0,6) ]
                TextBlock [ Text = "Transport", Style = @BodySm, Foreground = @Fg2 ]
                ComboBox [ ItemsSource = $TransportKinds, SelectedItem = $SelectedTransportKind, HorizontalAlignment = Stretch, Margin = (0,0,0,6) ]

                // stdio fields
                StackPanel [ Orientation = Vertical, Visibility = $IsStdio << ToVisibility ] {
                    TextBlock [ Text = "Command", Style = @BodySm, Foreground = @Fg2 ]
                    TextBox [ Text = $Command, Margin = (0,0,0,6) ]
                    TextBlock [ Text = "Arguments (space-separated)", Style = @BodySm, Foreground = @Fg2 ]
                    TextBox [ Text = $ArgsText, Margin = (0,0,0,6) ]
                    TextBlock [ Text = "Environment", Style = @BodySm, Foreground = @Fg2 ]
                    ItemsControl [ ItemsSource = $EnvRows, ItemsPanel = @VerticalStackPanel, ItemTemplate = @KeyValueRowTemplate ]
                    Button [ Variant = Text, Command = $AddEnvCommand, HorizontalAlignment = Left, Margin = (0,0,0,6) ] {
                        TextBlock [ Text = "+ Add variable", Style = @BodySm ]
                    }
                }

                // http / sse fields
                StackPanel [ Orientation = Vertical, Visibility = $IsHttp << ToVisibility ] {
                    TextBlock [ Text = "URL", Style = @BodySm, Foreground = @Fg2 ]
                    TextBox [ Text = $Url, Margin = (0,0,0,6) ]
                    TextBlock [ Text = "Headers", Style = @BodySm, Foreground = @Fg2 ]
                    ItemsControl [ ItemsSource = $HeaderRows, ItemsPanel = @VerticalStackPanel, ItemTemplate = @KeyValueRowTemplate ]
                    Button [ Variant = Text, Command = $AddHeaderCommand, HorizontalAlignment = Left, Margin = (0,0,0,6) ] {
                        TextBlock [ Text = "+ Add header", Style = @BodySm ]
                    }
                }

                TextBlock [ Text = "Tool gating", Style = @BodySm, Foreground = @Fg2 ]
                ComboBox [ ItemsSource = $GatingModes, SelectedItem = $SelectedGating, HorizontalAlignment = Stretch, Margin = (0,0,0,6) ]

                // per-tool checklist
                StackPanel [ Orientation = Vertical, Visibility = $IsPerTool << ToVisibility ] {
                    Button [ Variant = Text, Command = $DiscoverToolsCommand, HorizontalAlignment = Left, Margin = (0,0,0,4) ] {
                        TextBlock [ Text = "Discover tools", Style = @BodySm ]
                    }
                    ItemsControl [ ItemsSource = $Tools, ItemsPanel = @VerticalStackPanel, ItemTemplate = @ToolToggleTemplate ]
                }

                StackPanel [ Orientation = Horizontal, Margin = (0,6,0,6) ] {
                    Switch [ IsChecked = $Enabled, VerticalAlignment = Center, Margin = (0,0,8,0) ]
                    TextBlock [ Text = "Enabled", Style = @BodySm, Foreground = @Fg1, VerticalAlignment = Center ]
                }

                StackPanel [ Orientation = Horizontal ] {
                    Button [ Variant = Text, Command = $TestCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Test", Style = @BodySm ] }
                    TextBlock [ Text = $TestStatus, Style = @BodySm, Foreground = @Fg2, VerticalAlignment = Center ]
                }

                StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,10,0,0) ] {
                    Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel", Style = @BodySm ] }
                    Button [ Variant = Tonal, Command = $SaveCommand, IsEnabled = $IsValid ] { TextBlock [ Text = "Save", Style = @BodySm ] }
                }
            }
        }
    }

    // ── one importable candidate ────────────────────────────────────────────
    DataTemplate x:key="ImportRowTemplate" [ DataType = ImportRow ] {
        StackPanel [ Orientation = Horizontal, Margin = (0,0,0,4) ] {
            Switch [ IsChecked = $Selected, VerticalAlignment = Center, Margin = (0,0,8,0) ]
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Text = $Label, Style = @Body, Foreground = @Fg1 ]
                TextBlock [ Text = $Summary, Style = @BodySm, Foreground = @Fg2, TextTrimming = CharacterEllipsis ]
            }
        }
    }

    // ── the import panel ────────────────────────────────────────────────────
    DataTemplate [ DataType = McpImport ] {
        Border [ Fill = @Bg2, CornerRadius = 6, Padding = (12,12,12,12), Margin = (0,0,0,8) ] {
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Text = "Import from Claude config", Style = @Body, Foreground = @Fg1, Margin = (0,0,0,6) ]
                TextBlock [ Text = "No servers found in ~/.claude.json or .mcp.json.", Style = @BodySm,
                            Foreground = @Fg2, TextWrapping = Wrap, Visibility = $IsEmpty << ToVisibility ]
                ItemsControl [ ItemsSource = $Candidates, ItemsPanel = @VerticalStackPanel, ItemTemplate = @ImportRowTemplate ]
                TextBlock [ Text = "Import into", Style = @BodySm, Foreground = @Fg2, Margin = (0,6,0,0) ]
                ComboBox [ ItemsSource = $Scopes, SelectedItem = $SelectedScope, HorizontalAlignment = Stretch, Margin = (0,0,0,6) ]
                StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,4,0,0) ] {
                    Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel", Style = @BodySm ] }
                    Button [ Variant = Tonal, Command = $ImportCommand ] { TextBlock [ Text = "Import", Style = @BodySm ] }
                }
            }
        }
    }

    // ── the capability panel ────────────────────────────────────────────────
    DataTemplate [ DataType = McpServersService ] {
        DockPanel [ LastChildFill = true, Margin = (12,12,12,12) ] {
            // Action toolbar (the shell already renders the "MCP Servers" title).
            StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,10) ] {
                Button [ Variant = Tonal, Command = $AddCommand ] { TextBlock [ Text = "Add", Style = @BodySm ] }
                Button [ Variant = Text, Command = $AddProjectCommand, Margin = (6,0,0,0), Visibility = $IsProjectOpen << ToVisibility ] {
                    TextBlock [ Text = "Add to project", Style = @BodySm ]
                }
                Button [ Variant = Text, Command = $ImportCommand, Margin = (6,0,0,0) ] { TextBlock [ Text = "Import", Style = @BodySm ] }
            }

            // Editor / import hosts (shown when active), docked above the lists.
            ContentControl [ DockPanel.Dock = Top, Content = $ActiveEditor, Visibility = $HasEditor << ToVisibility ]
            ContentControl [ DockPanel.Dock = Top, Content = $ActiveImport, Visibility = $HasImport << ToVisibility ]

            // Empty state.
            TextBlock [ DockPanel.Dock = Top, Style = @Body, Foreground = @Fg2, TextWrapping = Wrap,
                        Text = "No MCP servers yet. Add one, or Import from your Claude config.",
                        Visibility = $IsEmpty << ToVisibility ]

            // The lists fill the rest.
            ScrollViewer [ HorizontalScrollEnabled = false ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Text = "Global", Style = @BodySm, Foreground = @Fg2, Margin = (0,0,0,4) ]
                    ItemsControl [ ItemsSource = $GlobalServers, ItemsPanel = @VerticalStackPanel, ItemTemplate = @McpServerRowTemplate ]
                    StackPanel [ Orientation = Vertical, Visibility = $IsProjectOpen << ToVisibility ] {
                        TextBlock [ Text = "Project", Style = @BodySm, Foreground = @Fg2, Margin = (0,8,0,4) ]
                        ItemsControl [ ItemsSource = $ProjectServers, ItemsPanel = @VerticalStackPanel, ItemTemplate = @McpServerRowTemplate ]
                    }
                }
            }
        }
    }
}
