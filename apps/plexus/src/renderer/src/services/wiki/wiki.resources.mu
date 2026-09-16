// wiki.resources.mu — the shared "Open Wiki" context menu, attached by four
// surfaces (canvas node, toolbox tile, meta-model entity, library class) via a
// `when ($HasWiki = true)` trigger. The MenuItem's DataContext is the row VM, so
// $Concept resolves against it; $service(WikiService) resolves the app service.

import WikiService from "./wiki-service.js"
import WikiDocument from "./wiki-document.js"

resources WikiResources {
    ContextMenu x:key="OpenWikiMenu" {
        MenuItem [ Header           = "Open Wiki",
                   Command          = $service(WikiService).OpenWikiCommand,
                   CommandParameter = $Concept ]
    }

    // Read-only rendered view for an opened wiki page. The content host shows a
    // WikiDocument as a tab and applies this template; the RichTextBlock lays out
    // its FlowDocument (headings, bold/italic, code, lists, tables, links).
    DataTemplate [DataType = WikiDocument] {
        ScrollViewer {
            Border [ Padding = (16) ] {
                RichTextBlock [ Document = $Document, Foreground = @OnSurface ]
            }
        }
    }
}
