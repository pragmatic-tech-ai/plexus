// code-editor.module.mu — contributes the mural (.mu/.mural) document type.
//
// A ShellModule with NO nav Capability (like problems/agent-chat): it only
// registers a document editor so the ProjectExplorerService can open/save/new
// .mu/.mural files in the Monaco CodeEditor. The Monaco host itself
// (CodeEditorService) + DataTemplate[CodeDocument] are composed by app.mu; this
// module adds the extension→factory routing. No language server — CodeDocument
// infers the 'mural' Monaco language from the extension (registerMuralLanguage).

import CodeDocumentFactory from "./code-document-factory.js"

module CodeEditorModule [ Name = "Code Editor" ] {
    .services: {
        CodeDocumentFactory
    }

    .documents: {
        DocumentDefinition
            [ Type           = "mural",
              Title          = "Mural",
              Description    = "A mural view / resource-dictionary file.",
              FileExtensions = [".mu", ".mural"],
              Factory        = CodeDocumentFactory ]
    }
}
