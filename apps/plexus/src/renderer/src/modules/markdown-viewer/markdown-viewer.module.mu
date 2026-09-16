// markdown-viewer.module.mu — contributes the read-only Markdown (.md/.markdown)
// document type.
//
// A ShellModule with NO nav Capability (like code-editor/problems): it only
// registers a document VIEWER so the ProjectExplorerService opens .md files as a
// rendered MarkdownDocument (a RichTextBlock over the parsed FlowDocument) instead
// of raw text. The DataTemplate[MarkdownDocument] is composed by app.mu; this
// module adds the extension→factory routing.

import MarkdownDocumentFactory from "./markdown-document-factory.js"

module MarkdownViewerModule [ Name = "Markdown Viewer" ] {
    .services: {
        MarkdownDocumentFactory
    }

    .documents: {
        DocumentDefinition
            [ Type           = "markdown",
              Title          = "Markdown",
              Description    = "A rendered Markdown document.",
              FileExtensions = [".md", ".markdown"],
              Factory        = MarkdownDocumentFactory ]
    }
}
