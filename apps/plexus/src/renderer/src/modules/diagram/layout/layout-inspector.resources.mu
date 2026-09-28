// layout-inspector.resources.mu — the builder view for the layout
// pipeline inspector. Merged app-global by app.mu; rendered in the shell's
// Inspector region when a LayoutInspector is added to the InspectorService.
//
// The template binds to the shell-scoped LayoutPipelineService via
// $service(...): the run mode, the Run / preview commands, the status
// readout, and a catalog-derived stage summary all live there. v1 shows the
// pipeline stages read-only (StagesSummary) and drives the core run loop;
// per-slot interactive strategy editing is the next iteration.

import LayoutInspector from "./layout-inspector.js"
import LayoutPipelineService from "./layout-pipeline-service.js"
import LayoutStageVM from "./layout-stage-vm.js"
import NumberParamVM from "./layout-param-vm.js"
import BoolParamVM from "./layout-param-vm.js"
import SavePresetPromptModel from "./save-preset-prompt.js"

resources LayoutInspectorResources {

    // A numeric strategy parameter: label + spin edit.
    DataTemplate [ DataType = NumberParamVM ] {
        Grid [ Margin = (12,2,0,2) ] {
            ColumnDefinitions {
                ColumnDefinition [ Width = GridLength.Auto ]
                ColumnDefinition [ Width = GridLength.Star ]
            }
            TextBlock [ Grid.Column = 0, Text = $Label, Style = @BodySm, Width = 108,
                        Foreground = @Fg2, VerticalAlignment = Center, Margin = (0,0,8,0) ]
            SpinEdit  [ Grid.Column = 1, Value = $Value, Minimum = 0, Maximum = 100000,
                        VerticalAlignment = Center ]
        }
    }

    // A boolean strategy parameter: label + switch.
    DataTemplate [ DataType = BoolParamVM ] {
        Grid [ Margin = (12,2,0,2) ] {
            ColumnDefinitions {
                ColumnDefinition [ Width = GridLength.Auto ]
                ColumnDefinition [ Width = GridLength.Star ]
            }
            TextBlock [ Grid.Column = 0, Text = $Label, Style = @BodySm, Width = 108,
                        Foreground = @Fg2, VerticalAlignment = Center, Margin = (0,0,8,0) ]
            Switch    [ Grid.Column = 1, IsChecked = $Value, HorizontalAlignment = Left, VerticalAlignment = Center ]
        }
    }

    // One stage row: a two-column grid (label + strategy ComboBox), with the
    // selected strategy's editable parameters listed below.
    DataTemplate [ DataType = LayoutStageVM ] {
        StackPanel [ Orientation = Vertical, Margin = (0,3,0,3) ] {
            Grid {
                ColumnDefinitions {
                    ColumnDefinition [ Width = GridLength.Auto ]
                    ColumnDefinition [ Width = GridLength.Star ]
                }
                TextBlock [ Grid.Column = 0, Text = $Label, Style = @BodySm, Width = 120,
                            Foreground = @Fg2, VerticalAlignment = Center, Margin = (0,0,8,0) ]
                ComboBox  [ Grid.Column = 1, ItemsSource = $Options, SelectedItem = $Selected,
                            IsEnabled = $Enabled, VerticalAlignment = Center ]
            }
            ItemsControl [ ItemsSource = $Params, ItemsPanel = @VerticalStackPanel ]
        }
    }

    DataTemplate [ DataType = LayoutInspector ] {
        ScrollViewer [ HorizontalScrollEnabled = false ] {
            StackPanel [ Orientation = Vertical, Margin = (12,12,12,12) ] {

                TextBlock [ Style = @UiLabel, Text = "Layout Pipeline",
                            Foreground = @Fg1, Margin = (0,0,0,10) ]

                // Preset strip: [ presets ▾ ]  [Save]  [Delete]  [Preview]  [Run].
                // While a preview is active this whole group collapses, leaving
                // only Apply / Cancel — a focused confirm/discard bar.
                StackPanel [ Orientation = Horizontal, Margin = (0,0,0,10) ] {
                    StackPanel [ Orientation = Horizontal,
                                 Visibility = $service(LayoutPipelineService).PreviewInactive << ToVisibility ] {
                        ComboBox [ ItemsSource = $service(LayoutPipelineService).Presets,
                                   SelectedItem = $service(LayoutPipelineService).SelectedPreset,
                                   Width = 150, VerticalAlignment = Center, Margin = (0,0,8,0) ]
                        PanelButton [ Margin = (0,0,4,0), Command = $service(LayoutPipelineService).SaveCommand ] {
                            Shape [ Geometry = @Save, Fill = @Fg2, Width = 20, Height = 20 ]
                        }
                        PanelButton [ Margin = (0,0,4,0), Command = $service(LayoutPipelineService).DeleteCommand,
                                      IsEnabled = $service(LayoutPipelineService).CanDelete ] {
                            Shape [ Geometry = @Delete, Fill = @Fg2, Width = 20, Height = 20 ]
                        }
                        // Preview: paint a ghost of the proposed layout over the canvas.
                        PanelButton [ Margin = (0,0,4,0), Command = $service(LayoutPipelineService).PreviewCommand ] {
                            Shape [ Geometry = @Visibility, Fill = @Fg2, Width = 20, Height = 20 ]
                        }
                        PanelButton [ Command = $service(LayoutPipelineService).RunCommand ] {
                            Shape [ Geometry = @Play, Fill = @Fg2, Width = 20, Height = 20 ]
                        }
                    }
                    // Apply / Cancel the shown preview — only while one is active.
                    PanelButton [ Margin = (0,0,4,0), Command = $service(LayoutPipelineService).ApplyPreviewCommand,
                                  Visibility = $service(LayoutPipelineService).PreviewActive << ToVisibility ] {
                        Shape [ Geometry = @Check, Fill = @ControlAccent, Width = 20, Height = 20 ]
                    }
                    PanelButton [ Margin = (0,0,4,0), Command = $service(LayoutPipelineService).CancelPreviewCommand,
                                  Visibility = $service(LayoutPipelineService).PreviewActive << ToVisibility ] {
                        Shape [ Geometry = @Close, Fill = @Fg2, Width = 20, Height = 20 ]
                    }
                }

                // Hairline separating the preset toolbar from the pipeline config.
                Border [ Height = 1, Fill = @Border, Margin = (0,0,0,10) ]

                TextBlock [ Style = @BodySm, Text = $service(LayoutPipelineService).Status,
                            Foreground = @Fg2, TextWrapping = Wrap, Margin = (0,0,0,12) ]

                // Layout stages — one labelled ComboBox per stage; the choice
                // writes into the pipeline configuration used by Run.
                TextBlock [ Style = @BodySm, Text = "Layout stages",
                            Foreground = @Fg2, Margin = (0,0,0,4) ]
                ItemsControl [ ItemsSource = $service(LayoutPipelineService).Stages,
                               ItemsPanel = @VerticalStackPanel ]
            }
        }
    }

    // The save-preset prompt dialog body (DialogService supplies surface/title/
    // padding). A name field, a "Save to" scope picker (Global / Project /
    // Diagram — only the scopes the caller offers), then Cancel / Save; Save
    // stays disabled until the name is non-blank (CanConfirm). The scope ComboBox
    // shows each option's Label via the displayString convention.
    DataTemplate [ DataType = SavePresetPromptModel ] {
        StackPanel [ Orientation = Vertical, HorizontalAlignment = Stretch ] {
            TextBlock [ Style = @Body, Text = "Preset name", Foreground = @Fg1, Margin = (0,0,0,4) ]
            TextBox [ Text = $Name, Margin = (0,0,0,14) ]
            TextBlock [ Style = @Body, Text = "Save to", Foreground = @Fg1, Margin = (0,0,0,4) ]
            ComboBox [ ItemsSource = $Scopes, SelectedItem = $SelectedScope, HorizontalAlignment = Stretch, Margin = (0,0,0,14) ]
            StackPanel [ Orientation = Horizontal, HorizontalAlignment = Right ] {
                Button [ Variant = Text, Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ConfirmCommand, IsEnabled = $CanConfirm ] { TextBlock [ Text = "Save" ] }
            }
        }
    }
}
