// skills-authoring.resources.mu — view resources for the "Skills" authoring
// capability (SkillAuthoringService). Merged app-global by app.mu.
//
// The panel lists the catalog (SkillListItemVm rows, each with a SelectCommand)
// with search + ＋New. Selecting a skill binds SkillEditSession → a structured
// x-plexus form (SkillFrontmatterFormVm) that writes the SAME Monaco buffer the
// body tab shows. Row VMs (input/binding/output) render the type-appropriate
// controls, mirroring the #3 run-form idiom. New-skill collection uses a modal
// (SkillNewDialogVm) over the reusable Observable form.

import SkillAuthoringService from "./services/skill-authoring-service.js"
import SkillListItemVm from "./services/skill-list-item.js"
import SkillEditSession from "./services/skill-edit-session.js"
import SkillFrontmatterFormVm from "./services/skill-frontmatter-form.js"
import SkillInputRowVm from "./services/skill-frontmatter-form.js"
import SkillBindingRowVm from "./services/skill-frontmatter-form.js"
import SkillOutputRowVm from "./services/skill-frontmatter-form.js"
import SkillNewDialogVm from "./services/skill-new-dialog.js"

resources SkillsAuthoringResources {

    // ── one input row ───────────────────────────────────────────────────────
    DataTemplate x:key="SkillInputRowTemplate" [ DataType = SkillInputRowVm ] {
        Border [ Fill = @SurfaceContainerHigh, CornerRadius = 6, Padding = (8,6,8,6), Margin = (0,0,0,6) ] {
            StackPanel [ Orientation = Vertical ] {
                StackPanel [ Orientation = Horizontal ] {
                    TextBox [ Text = $Key, Width = 110, Margin = (0,0,6,0) ]
                    ComboBox [ ItemsSource = $Kinds, SelectedItem = $Type, Width = 100, Margin = (0,0,6,0) ]
                    Button [ Variant = Text, Command = $RemoveCommand ] { TextBlock [ Text = "Remove", Style = @BodySmall ] }
                }
                TextBox [ Text = $Label, Margin = (0,4,0,0) ]
                TextBox [ Text = $OptionsText, Margin = (0,4,0,0) ]
                StackPanel [ Orientation = Horizontal, Margin = (0,4,0,0) ] {
                    Switch [ IsChecked = $Required, VerticalAlignment = Center, Margin = (0,0,6,0) ]
                    TextBlock [ Text = "Required", Style = @BodySmall, Foreground = @OnSurfaceVariant, VerticalAlignment = Center ]
                    TextBox [ Text = $DefaultText, Width = 120, Margin = (10,0,0,0) ]
                }
            }
        }
    }

    // ── one binding row ─────────────────────────────────────────────────────
    DataTemplate x:key="SkillBindingRowTemplate" [ DataType = SkillBindingRowVm ] {
        StackPanel [ Orientation = Horizontal, Margin = (0,0,0,4) ] {
            ComboBox [ ItemsSource = $Sources, SelectedItem = $Source, Width = 150, Margin = (0,0,6,0) ]
            TextBox [ Text = $As, Width = 120, Margin = (0,0,6,0) ]
            Button [ Variant = Text, Command = $RemoveCommand ] { TextBlock [ Text = "Remove", Style = @BodySmall ] }
        }
    }

    // ── one output row ──────────────────────────────────────────────────────
    DataTemplate x:key="SkillOutputRowTemplate" [ DataType = SkillOutputRowVm ] {
        StackPanel [ Orientation = Horizontal, Margin = (0,0,0,4) ] {
            ComboBox [ ItemsSource = $Kinds, SelectedItem = $Kind, Width = 150, Margin = (0,0,6,0) ]
            TextBox [ Text = $Target, Width = 120, Margin = (0,0,6,0) ]
            Button [ Variant = Text, Command = $RemoveCommand ] { TextBlock [ Text = "Remove", Style = @BodySmall ] }
        }
    }

    // ── the x-plexus form ───────────────────────────────────────────────────
    DataTemplate [ DataType = SkillFrontmatterFormVm ] {
        StackPanel [ Orientation = Vertical ] {
            TextBlock [ Text = "Authored with a newer schema — editing disabled here.", Style = @BodySmall,
                        Foreground = @OnSurfaceVariant, TextWrapping = Wrap, Margin = (0,0,0,6),
                        Visibility = $IsUnknownVersion << ToVisibility ]

            TextBlock [ Text = "Title", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            TextBox [ Text = $Title, IsEnabled = $IsEditable, Margin = (0,0,0,6) ]
            TextBlock [ Text = "Category", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            TextBox [ Text = $Category, IsEnabled = $IsEditable, Margin = (0,0,0,6) ]
            TextBlock [ Text = "Icon", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            TextBox [ Text = $Icon, IsEnabled = $IsEditable, Margin = (0,0,0,6) ]
            TextBlock [ Text = "Model", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            TextBox [ Text = $Model, IsEnabled = $IsEditable, Margin = (0,0,0,6) ]
            TextBlock [ Text = "Tags (comma-separated)", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            TextBox [ Text = $TagsText, IsEnabled = $IsEditable, Margin = (0,0,0,6) ]
            TextBlock [ Text = "Allowed tools (comma-separated)", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            TextBox [ Text = $AllowedToolsText, IsEnabled = $IsEditable, Margin = (0,0,0,6) ]
            TextBlock [ Text = "Requires project type (comma-separated)", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            TextBox [ Text = $RequiresProjectTypeText, IsEnabled = $IsEditable, Margin = (0,0,0,6) ]

            TextBlock [ Text = "Deprecation — replaced by", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            TextBox [ Text = $DeprecationReplacedBy, IsEnabled = $IsEditable, Margin = (0,0,0,6) ]
            TextBlock [ Text = "Deprecation — note", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            TextBox [ Text = $DeprecationNote, IsEnabled = $IsEditable, Margin = (0,0,0,10) ]

            TextBlock [ Text = "Inputs", Style = @BodyMedium, Foreground = @OnSurface, Margin = (0,4,0,4) ]
            ItemsControl [ ItemsSource = $Inputs, ItemsPanel = @VerticalStackPanel, ItemTemplate = @SkillInputRowTemplate ]
            Button [ Variant = Text, Command = $AddInputCommand, IsEnabled = $IsEditable, HorizontalAlignment = Left, Margin = (0,0,0,10) ] {
                TextBlock [ Text = "+ Add input", Style = @BodySmall ]
            }

            TextBlock [ Text = "Bindings", Style = @BodyMedium, Foreground = @OnSurface, Margin = (0,4,0,4) ]
            ItemsControl [ ItemsSource = $Bindings, ItemsPanel = @VerticalStackPanel, ItemTemplate = @SkillBindingRowTemplate ]
            Button [ Variant = Text, Command = $AddBindingCommand, IsEnabled = $IsEditable, HorizontalAlignment = Left, Margin = (0,0,0,10) ] {
                TextBlock [ Text = "+ Add binding", Style = @BodySmall ]
            }

            TextBlock [ Text = "Outputs", Style = @BodyMedium, Foreground = @OnSurface, Margin = (0,4,0,4) ]
            ItemsControl [ ItemsSource = $Outputs, ItemsPanel = @VerticalStackPanel, ItemTemplate = @SkillOutputRowTemplate ]
            Button [ Variant = Text, Command = $AddOutputCommand, IsEnabled = $IsEditable, HorizontalAlignment = Left ] {
                TextBlock [ Text = "+ Add output", Style = @BodySmall ]
            }
        }
    }

    // ── the selected-skill editor (form + validation problems) ──────────────
    DataTemplate [ DataType = SkillEditSession ] {
        Border [ Fill = @SurfaceContainer, CornerRadius = 6, Padding = (12,12,12,12), Margin = (0,8,0,0) ] {
            StackPanel [ Orientation = Vertical ] {
                ContentControl [ Content = $Form ]
                TextBlock [ Text = $ProblemText, Style = @BodySmall, Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                            Margin = (0,8,0,0), Visibility = $HasProblems << ToVisibility ]
            }
        }
    }

    // ── one catalog row ─────────────────────────────────────────────────────
    DataTemplate x:key="SkillListItemTemplate" [ DataType = SkillListItemVm ] {
        Border [ Fill = @SurfaceContainerHigh, CornerRadius = 6, Padding = (10,8,10,8), Margin = (0,0,0,6) ] {
            Button [ Variant = Text, Command = $SelectCommand, HorizontalAlignment = Stretch ] {
                StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
                    TextBlock [ Text = $Title, Style = @BodyMedium, Foreground = @OnSurface ]
                    StackPanel [ Orientation = Horizontal, Margin = (0,2,0,0) ] {
                        TextBlock [ Text = $ScopeLabel, Style = @BodySmall, Foreground = @OnSurfaceVariant, Margin = (0,0,8,0) ]
                        TextBlock [ Text = "read-only", Style = @BodySmall, Foreground = @OnSurfaceVariant, Visibility = $IsReadOnly << ToVisibility ]
                    }
                    TextBlock [ Text = $Description, Style = @BodySmall, Foreground = @OnSurfaceVariant, TextTrimming = CharacterEllipsis ]
                }
            }
        }
    }

    // ── the new-skill modal ─────────────────────────────────────────────────
    DataTemplate [ DataType = SkillNewDialogVm ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Text = "Name", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            TextBox [ Text = $Form.Name, Margin = (0,0,0,6) ]
            TextBlock [ Text = "Description", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            TextBox [ Text = $Form.Description, Margin = (0,0,0,6) ]
            TextBlock [ Text = "Scope", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            ComboBox [ ItemsSource = $Form.Scopes, SelectedItem = $Form.Scope, HorizontalAlignment = Stretch, Margin = (0,0,0,6) ]
            TextBlock [ Text = "Template", Style = @BodySmall, Foreground = @OnSurfaceVariant ]
            ComboBox [ ItemsSource = $Form.Templates, SelectedItem = $Form.Template, HorizontalAlignment = Stretch, Margin = (0,0,0,6) ]
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,10,0,0) ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand ] { TextBlock [ Text = "Create" ] }
            }
        }
    }

    // ── the capability panel ────────────────────────────────────────────────
    DataTemplate [ DataType = SkillAuthoringService ] {
        DockPanel [ LastChildFill = true, Margin = (12,12,12,12) ] {
            StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,10) ] {
                Button [ Variant = Tonal, Command = $NewCommand ] { TextBlock [ Text = "+ New Skill", Style = @BodySmall ] }
                Button [ Variant = Text, Command = $RefreshCommand, Margin = (6,0,0,0) ] { TextBlock [ Text = "Refresh", Style = @BodySmall ] }
                Button [ Variant = Text, Command = $SaveCommand, Margin = (6,0,0,0) ] { TextBlock [ Text = "Save", Style = @BodySmall ] }
            }
            TextBox [ DockPanel.Dock = Top, Text = $SearchText, Margin = (0,0,0,8) ]

            ScrollViewer [ HorizontalScrollEnabled = false ] {
                StackPanel [ Orientation = Vertical ] {
                    TextBlock [ DockPanel.Dock = Top, Style = @BodyMedium, Foreground = @OnSurfaceVariant, TextWrapping = Wrap,
                                Text = "No skills found. Create one with + New Skill.",
                                Visibility = $IsEmpty << ToVisibility ]
                    ItemsControl [ ItemsSource = $Items, ItemsPanel = @VerticalStackPanel, ItemTemplate = @SkillListItemTemplate ]
                    ContentControl [ Content = $Session, Visibility = $HasSession << ToVisibility ]
                }
            }
        }
    }
}
