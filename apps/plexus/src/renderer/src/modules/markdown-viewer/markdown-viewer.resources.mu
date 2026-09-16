// markdown-viewer.resources.mu — the rendered view for an opened .md file.
//
// The content host shows a MarkdownDocument as a tab and applies this template;
// the RichTextBlock lays out its FlowDocument (headings, bold/italic, highlighted
// code, lists, tables, links, images) inside a scrollable, padded surface.

import MarkdownDocument from "./markdown-document.js"

resources MarkdownViewerResources {
    DataTemplate [DataType = MarkdownDocument] {
        // Vertical scroll only — the document wraps to the viewport width instead of
        // scrolling sideways.
        ScrollViewer [ HorizontalScrollEnabled = false ] {
            Border [ Padding = (20) ] {
                RichTextBlock [ Document = $Document, Foreground = @OnSurface ]
            }
        }
    }
}
