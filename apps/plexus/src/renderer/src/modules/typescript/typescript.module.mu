// typescript.module.mu — contributes the TypeScript (.ts/.tsx) document type.
//
// A ShellModule with NO nav Capability (like code-editor): it only registers a
// document editor so the document-type registry can open/save/new .ts/.tsx files
// in the Monaco CodeEditor. The TypeScriptWorkspace / bridge services are composed
// elsewhere; this module adds the extension->factory routing.

import TypeScriptDocumentFactory from "./typescript-document-factory.js"

shell module TypeScriptEditorModule [ Name = "TypeScript Editor" ] {
    .services: {
        TypeScriptDocumentFactory
    }

    .documents: {
        DocumentDefinition
            [ Type           = "typescript",
              Title          = "TypeScript",
              Description    = "A TypeScript source file.",
              FileExtensions = [".ts", ".tsx"],
              Factory        = TypeScriptDocumentFactory ]
    }
}
