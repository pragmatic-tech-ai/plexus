// svg-editor.resources.mu — the SVG document view.
//
// DataTemplate[SvgDocument] lays out one document with two stacked sub-views the
// user flips between via a small tab strip docked at the BOTTOM:
//   * Visual — an SvgSceneHost (a DomHost subclass) that parses the document's
//     $Content markup into a live <svg> and renders it (pan/zoom/fit);
//   * XML — a bare CodeEditor (a Monaco DomHost) whose DataContext is the
//     document, so it self-binds $Content / $Language ('xml') with no adapter.
//
// Which view shows is driven by the document's IsVisualActive / IsTextActive
// booleans (both derived from ActiveView) via `<< ToVisibility`. The tab buttons
// invoke ShowVisualCommand / ShowTextCommand. Default is Visual (visual-first).

import SvgDocument from "./svg-document.js"
import SvgSceneHost from "./svg-scene-host.js"
import CodeEditor from "../code-editor/code-editor.js"

resources SvgEditorResources {
    DataTemplate [ DataType = SvgDocument ] {
        DockPanel [ LastChildFill = true ] {
            // Bottom tab strip: Visual | XML.
            Border [ DockPanel.Dock = Bottom, Fill = @SurfaceContainerHigh, Padding = (6,3,6,3) ] {
                StackPanel [ Orientation = Horizontal ] {
                    Button [ Command = $ShowVisualCommand, Margin = (0,0,4,0) ] {
                        TextBlock [ Text = "Visual", Style = @LabelMedium, Foreground = @OnSurface ]
                    }
                    Button [ Command = $ShowTextCommand ] {
                        TextBlock [ Text = "XML", Style = @LabelMedium, Foreground = @OnSurface ]
                    }
                }
            }
            // Content area: the object format inspector is docked on the RIGHT and
            // appears whenever an SVG part is selected — it PERSISTS across both the
            // Visual and XML tabs (hoisted out of the visual view), so a selection
            // shows the inspector next to whichever tab is active, and styling edits
            // reflect live in the XML. The two views swap in the remaining space.
            //
            // The inspector is the framework ShapeFormatControl (the real Format
            // Shape control). Its two-way Fill (Brush) / Stroke (Pen) bind to the
            // document's SelectionStyle sink — the StackPanel sets DataContext to the
            // sink so those are simple $Fill/$Stroke bindings. The rail's Visibility
            // binds the DOCUMENT-level $HasSelection (a single-level path that reacts
            // reliably; a dotted sub-object path did not). The app-local controls
            // (SvgSceneHost, CodeEditor) are placed BARE and self-bind to the document.
            DockPanel [ LastChildFill = true ] {
                Border [ DockPanel.Dock = Right, Width = 264,
                         Visibility = $HasSelection << ToVisibility,
                         Fill = @SurfaceContainerHigh, Padding = (10,10,10,10) ] {
                    StackPanel [ DataContext = $SelectionStyle, Orientation = Vertical ] {
                        TextBlock [ Text = "Format Shape", Style = @LabelLarge, Foreground = @OnSurface, Margin = (0,0,0,8) ]
                        ShapeFormatControl [ Fill = $Fill, Stroke = $Stroke, ShowCaps = false ]
                    }
                }
                // The two views swap, one visible at a time, filling the space left
                // of the inspector.
                Grid {
                    Border [ Visibility = $IsVisualActive << ToVisibility ] {
                        Border { SvgSceneHost }
                    }
                    Border [ Visibility = $IsTextActive << ToVisibility ] {
                        CodeEditor
                    }
                }
            }
        }
    }
}
