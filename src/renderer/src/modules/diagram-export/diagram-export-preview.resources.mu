// diagram-export-preview.resources.mu — the export preview dialog body.
//
// Renders DiagramExportPreviewModel as DialogService modal content: a live SVG
// preview on the left, the export options on the right, Cancel / Export below.
// Every option two-way-binds a VM DP (ComboBox SelectedItem / Switch IsChecked);
// the VM re-renders the preview on each change. Mirrors save-prompt.resources.mu.
//
// Merged app-global by app.mu (`merge DiagramExportPreviewResources`) so
// DialogService.Show({ Content: vm }) resolves this template by data type.

import DiagramExportPreviewModel from "./services/diagram-export-preview-model.js"

resources DiagramExportPreviewResources {

    DataTemplate [ DataType = DiagramExportPreviewModel ] {
        DockPanel [ LastChildFill = true, Width = 720 ] {
            // Actions row (bottom): Cancel + Export (Filled primary).
            StackPanel [ DockPanel.Dock = Bottom, Orientation = Horizontal, HorizontalAlignment = Right, Margin = (0,16,0,0) ] {
                Button [ Variant = Text,   Command = $CancelCommand, Margin = (0,0,8,0) ] { TextBlock [ Text = "Cancel" ] }
                Button [ Variant = Filled, Command = $ExportCommand ] { TextBlock [ Text = "Export" ] }
            }

            // Preview (left): the rendered diagram on a neutral backdrop + a size readout.
            Border [ DockPanel.Dock = Left, Width = 420, MinHeight = 320, Fill = @SurfaceContainerHigh,
                     CornerRadius = @ShapeSmall, Margin = (0,0,16,0), Padding = (8) ] {
                StackPanel [ Orientation = Vertical, HorizontalAlignment = Center, VerticalAlignment = Center ] {
                    Image [ Source = $Preview, Stretch = Uniform, MaxWidth = 400, MaxHeight = 340 ]
                    TextBlock [ Text = $PreviewSize, Style = @BodySmall, Foreground = @OnSurfaceVariant,
                                HorizontalAlignment = Center, Margin = (0,8,0,0) ]
                }
            }

            // Options (right, fills remaining).
            StackPanel [ Orientation = Vertical ] {
                DockPanel [ LastChildFill = true, Margin = (0,4,0,4) ] {
                    ComboBox [ DockPanel.Dock = Right, Width = 180, ItemsSource = $Formats, SelectedItem = $Format, VerticalAlignment = Center ]
                    TextBlock [ Style = @BodyLarge, Text = "Format", Foreground = @OnSurface, VerticalAlignment = Center ]
                }
                DockPanel x:name="PART_SelectionOption" [ LastChildFill = true, Margin = (0,4,0,4) ] {
                    Switch [ DockPanel.Dock = Right, IsChecked = $UseSelection, VerticalAlignment = Center ]
                    TextBlock [ Style = @BodyLarge, Text = "Selection only", Foreground = @OnSurface, VerticalAlignment = Center ]
                }
                DockPanel [ LastChildFill = true, Margin = (0,4,0,4) ] {
                    ComboBox [ DockPanel.Dock = Right, Width = 180, ItemsSource = $Backgrounds, SelectedItem = $Background, VerticalAlignment = Center ]
                    TextBlock [ Style = @BodyLarge, Text = "Background", Foreground = @OnSurface, VerticalAlignment = Center ]
                }
                DockPanel [ LastChildFill = true, Margin = (0,4,0,4) ] {
                    ComboBox [ DockPanel.Dock = Right, Width = 180, ItemsSource = $ForegroundChoices, SelectedItem = $ForegroundChoice, VerticalAlignment = Center ]
                    TextBlock [ Style = @BodyLarge, Text = "Foreground", Foreground = @OnSurface, VerticalAlignment = Center ]
                }
                DockPanel [ LastChildFill = true, Margin = (0,4,0,4) ] {
                    Switch [ DockPanel.Dock = Right, IsChecked = $ShowPageBreaks, VerticalAlignment = Center ]
                    TextBlock [ Style = @BodyLarge, Text = "Page breaks", Foreground = @OnSurface, VerticalAlignment = Center ]
                }
                DockPanel [ LastChildFill = true, Margin = (0,4,0,4) ] {
                    ComboBox [ DockPanel.Dock = Right, Width = 180, ItemsSource = $Scales, SelectedItem = $Scale, VerticalAlignment = Center ]
                    TextBlock [ Style = @BodyLarge, Text = "Scale (raster)", Foreground = @OnSurface, VerticalAlignment = Center ]
                }
            }
        }
        // Hide the selection toggle when nothing is selected — there is no selection to scope to.
        when ( $HasSelection = false ) { PART_SelectionOption.Visibility = Collapsed; }
    }
}
