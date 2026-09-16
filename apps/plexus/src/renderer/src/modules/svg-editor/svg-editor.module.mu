// svg-editor.module.mu — contributes the .svg document type (visual + text tabs).
// A ShellModule with NO nav Capability (like code-editor): it only registers the
// document editor so the ProjectExplorerService can open/save/new .svg files.
// The views (DataTemplate[SvgDocument]) are composed by app.mu via
// SvgEditorResources.

import SvgDocumentFactory from "./svg-document-factory.js"

module SvgEditorModule [ Name = "SVG Editor" ] {
    .services: {
        SvgDocumentFactory
    }

    .documents: {
        DocumentDefinition
            [ Type           = "svg",
              Title          = "SVG",
              Description    = "A Scalable Vector Graphics image.",
              FileExtensions = [".svg"],
              Factory        = SvgDocumentFactory ]
    }
}
