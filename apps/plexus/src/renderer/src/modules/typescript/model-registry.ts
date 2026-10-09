import * as monaco from 'monaco-editor'

// A thin seam over Monaco's global model registry, so TypeScriptWorkspace is
// testable headless (a fake implements this) and Monaco stays isolated in the view layer.
export interface IModelRegistry
{
    Ensure(uri: string, text: string, language: string): void
    Has(uri: string): boolean
    Dispose(uri: string): void
}

export class MonacoModelRegistry implements IModelRegistry
{
    public Ensure(uri: string, text: string, language: string): void
    {
        const parsed = monaco.Uri.parse(uri)
        if (monaco.editor.getModel(parsed) === null) monaco.editor.createModel(text, language, parsed)
    }

    public Has(uri: string): boolean
    {
        return monaco.editor.getModel(monaco.Uri.parse(uri)) !== null
    }

    public Dispose(uri: string): void
    {
        monaco.editor.getModel(monaco.Uri.parse(uri))?.dispose()
    }
}
