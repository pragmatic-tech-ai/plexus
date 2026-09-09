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
        Border [ Fill = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,8,10,8), Margin = (0,0,0,6) ] {
            DockPanel [ LastChildFill = true ] {
                Switch [ DockPanel.Dock = Left, IsChecked = $Enabled, VerticalAlignment = Center, Margin = (0,0,10,0) ]
                Button [ DockPanel.Dock = Right, Variant = Text, Command = $RemoveCommand, Margin = (4,0,0,0) ] {
                    TextBlock [ Text = "Remove", Style = @BodySmall ]
                }
                Button [ DockPanel.Dock = Right, Variant = Text, Command = $EditCommand ] {
                    TextBlock [ Text = "Edit", Style = @BodySmall ]
                }
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Text = $Label, Style = @BodyMedium, Foreground = @OnSurface ]
                    TextBlock [ Text = $TransportSummary, Style = @BodySmall, Foreground = @OnSurfaceVariant, TextTrimming = CharacterEllipsis ]
                    StackPanel [ Orientation = Horizontal, Margin = (0,2,0,0) ] {
                        TextBlock [ Text = $ScopeLabel, Style = @BodySmall, Foreground = @OnSurfaceVariant, Margin = (0,0,8,0) ]
                        TextBlock [ Text = $GatingBadge, Style = @BodySmall, Foreground = @OnSurfaceVariant ]
                        TextBlock [ Text = $LastStatus, Style = @BodySmall, Foreground = @OnSurfaceVariant, Margin = (8,0,0,0) ]
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
            Button [ Variant = Text, Command = $RemoveCommand ] { TextBlock [ Text = "Remove", Style = @BodySmall ] }
        }
    }

    // ── one discovered tool in the per-tool checklist ───────────────────────
    DataTemplate x:key="ToolToggleTemplate" [ DataType = ToolToggle ] {
        StackPanel [ Orientation = Horizontal, Margin = (0,0,0,2) ] {
            Switch [ IsChecked = $Checked, VerticalAlignment = Center, Margin = (0,0,8,0) ]
            TextBlock [ Text = $Name, Style = @BodySmall, Foreground = @OnSurface, VerticalAlignment = Center ]
        }
    }

    // ── the add/edit editor ─────────────────────────────────────────────────
    DataTemplate [ DataType = McpServerEditor ] {
        Border [ Fill = @SurfaceContainer, CornerRadius = 6, Padding = (12,12,12,12), Margin = (0,0,0,8) ] {
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Text = "Key", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
                TextBox [ Text = $Key, Margin = (0,0,0,6) ]
                TextBlock [ Text = "Display name", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
                TextBox [ Text = $Label, Margin = (0,0,0,6) ]
                TextBlock [ Text = "Transport", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
                ComboBox [ ItemsSource = $TransportKinds, SelectedItem = $SelectedTransportKind, HorizontalAlignment = Stretch, Margin = (0,0,0,6) ]

                // stdio fields
                StackPanel [ Orientation = Vertical, Visibility = $IsStdio << ToVisibility ] {
                    TextBlock [ Text = "Command", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
                    TextBox [ Text = $Command, Margin = (0,0,0,6) ]
                    TextBlock [ Text = "Arguments (space-separated)", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
                    TextBox [ Text = $ArgsText, Margin = (0,0,0,6) ]
                    TextBlock [ Text = "Environment", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
                    ItemsControl [ ItemsSource = $EnvRows, ItemsPanel = @VerticalStackPanel, ItemTemplate = @KeyValueRowTemplate ]
                    Button [ Variant = Text, Command = $AddEnvCommand, HorizontalAlignment = Left, Margin = (0,0,0,6) ] {
                        TextBlock [ Text = "+ Add variable", Style = @BodySmall ]
                    }
                }

                // http / sse fields
                StackPanel [ Orientation = Vertical, Visibility = $IsHttp << ToVisibility ] {
                    TextBlock [ Text = "URL", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
                    TextBox [ Text = $Url, Margin = (0,0,0,6) ]
                    TextBlock [ Text = "Headers", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
                    ItemsControl [ ItemsSource = $HeaderRows, ItemsPanel = @VerticalStackPanel, ItemTemplate = @KeyValueRowTemplate ]
                    Button [ Variant = Text, Command = $AddHeaderCommand, HorizontalAlignment = Left, Margin = (0,0,0,6) ] {
                        TextBlock [ Text = "+ Add header", Style = @BodySmall ]
                    }
                }

                TextBlock [ Text = "Tool gating", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
                ComboBox [ ItemsSource = $GatingModes, SelectedItem = $SelectedGating, HorizontalAlignment = Stretch, Margin = (0,0,0,6) ]

                // per-tool checklist
                StackPanel [ Orientation = Vertical, Visibility = $IsPerTool << ToVisibility ] {
                    Button [ Variant = Text, Command = $DiscoverToolsCommand, HorizontalAlignment = Left, Margin = (0,0,0,4) ] {
                        TextBlock [ Text = "Discover tools", Style = @BodySmall ]
                    }
                    ItemsControl [ ItemsSource = $Tools, ItemsPanel = @VerticalStackPanel, ItemTemplate = @ToolToggleTemplate ]
                }

                StackPanel [ Orientation = Horizontal, Margin = (0,6,0,6) ] {
                    Switch [ IsChecked = $Enabled, VerticalAlignment = Center, Margin = (0,0,8,0) ]
                    TextBlock [ Text = "Enabled", Style = @BodySmall, Foreground = @OnSurface, VerticalAlignment = Center ]
                }

                StackPanel [ Orientation = Horizontal ] {
                    Button [ Variant = Text, Command = $TestCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Test", Style = @BodySmall ] }
                    TextBlock [ Text = $TestStatus, Style = @BodySmall, Foreground = @OnSurfaceVariant, VerticalAlignment = Center ]
                }

                StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,10,0,0) ] {
                    Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel", Style = @BodySmall ] }
                    Button [ Variant = Tonal, Command = $SaveCommand, IsEnabled = $IsValid ] { TextBlock [ Text = "Save", Style = @BodySmall ] }
                }
            }
        }
    }

    // ── one importable candidate ────────────────────────────────────────────
    DataTemplate x:key="ImportRowTemplate" [ DataType = ImportRow ] {
        StackPanel [ Orientation = Horizontal, Margin = (0,0,0,4) ] {
            Switch [ IsChecked = $Selected, VerticalAlignment = Center, Margin = (0,0,8,0) ]
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Text = $Label, Style = @BodyMedium, Foreground = @OnSurface ]
                TextBlock [ Text = $Summary, Style = @BodySmall, Foreground = @OnSurfaceVariant, TextTrimming = CharacterEllipsis ]
            }
        }
    }

    // ── the import panel ────────────────────────────────────────────────────
    DataTemplate [ DataType = McpImport ] {
        Border [ Fill = @SurfaceContainer, CornerRadius = 6, Padding = (12,12,12,12), Margin = (0,0,0,8) ] {
            StackPanel [ Orientation = Vertical ] {
                TextBlock [ Text = "Import from Claude config", Style = @BodyMedium, Foreground = @OnSurface, Margin = (0,0,0,6) ]
                TextBlock [ Text = "No servers found in ~/.claude.json or .mcp.json.", Style = @BodySmall,
                            Foreground = @OnSurfaceVariant, TextWrapping = Wrap, Visibility = $IsEmpty << ToVisibility ]
                ItemsControl [ ItemsSource = $Candidates, ItemsPanel = @VerticalStackPanel, ItemTemplate = @ImportRowTemplate ]
                TextBlock [ Text = "Import into", Style = @BodySmall, Foreground = @OnSurfaceVariant, Margin = (0,6,0,0) ]
                ComboBox [ ItemsSource = $Scopes, SelectedItem = $SelectedScope, HorizontalAlignment = Stretch, Margin = (0,0,0,6) ]
                StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,4,0,0) ] {
                    Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel", Style = @BodySmall ] }
                    Button [ Variant = Tonal, Command = $ImportCommand ] { TextBlock [ Text = "Import", Style = @BodySmall ] }
                }
            }
        }
    }

    // ── the capability panel ────────────────────────────────────────────────
    DataTemplate [ DataType = McpServersService ] {
        DockPanel [ LastChildFill = true, Margin = (12,12,12,12) ] {
            // Action toolbar (the shell already renders the "MCP Servers" title).
            StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,10) ] {
                Button [ Variant = Tonal, Command = $AddCommand ] { TextBlock [ Text = "Add", Style = @BodySmall ] }
                Button [ Variant = Text, Command = $AddProjectCommand, Margin = (6,0,0,0), Visibility = $IsProjectOpen << ToVisibility ] {
                    TextBlock [ Text = "Add to project", Style = @BodySmall ]
                }
                Button [ Variant = Text, Command = $ImportCommand, Margin = (6,0,0,0) ] { TextBlock [ Text = "Import", Style = @BodySmall ] }
            }

            // Editor / import hosts (shown when active), docked above the lists.
            ContentControl [ DockPanel.Dock = Top, Content = $ActiveEditor, Visibility = $HasEditor << ToVisibility ]
            ContentControl [ DockPanel.Dock = Top, Content = $ActiveImport, Visibility = $HasImport << ToVisibility ]

            // Empty state.
            TextBlock [ DockPanel.Dock = Top, Style = @BodyMedium, Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                        Text = "No MCP servers yet. Add one, or Import from your Claude config.",
                        Visibility = $IsEmpty << ToVisibility ]

            // The lists fill the rest.
            ScrollViewer [ HorizontalScrollEnabled = false ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ Text = "Global", Style = @BodySmall, Foreground = @OnSurfaceVariant, Margin = (0,0,0,4) ]
                    ItemsControl [ ItemsSource = $GlobalServers, ItemsPanel = @VerticalStackPanel, ItemTemplate = @McpServerRowTemplate ]
                    StackPanel [ Orientation = Vertical, Visibility = $IsProjectOpen << ToVisibility ] {
                        TextBlock [ Text = "Project", Style = @BodySmall, Foreground = @OnSurfaceVariant, Margin = (0,8,0,4) ]
                        ItemsControl [ ItemsSource = $ProjectServers, ItemsPanel = @VerticalStackPanel, ItemTemplate = @McpServerRowTemplate ]
                    }
                }
            }
        }
    }
}
