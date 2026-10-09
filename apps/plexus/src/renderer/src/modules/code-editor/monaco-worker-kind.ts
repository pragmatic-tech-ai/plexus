// Monaco emits a per-request worker `label`; its built-in TypeScript language mode
// labels its worker requests "typescript"/"javascript" (both served by the single TS
// language-service worker), while everything else uses the base editor worker. This
// pure routing decision lives apart from monaco-env's `?worker` imports so it can be
// unit-tested without pulling a Vite worker bundle into the Node test runner.

// The worker `label` values Monaco's built-in TypeScript mode requests under.
export enum MonacoWorkerLabel
{
    TypeScript = 'typescript',
    JavaScript = 'javascript',
}

// Which Monaco worker a label resolves to.
export enum MonacoWorkerKind
{
    Editor,
    LanguageService,
}

export class MonacoWorkerRouting
{
    public static KindFor(label: string): MonacoWorkerKind
    {
        if (label === MonacoWorkerLabel.TypeScript || label === MonacoWorkerLabel.JavaScript)
        {
            return MonacoWorkerKind.LanguageService
        }
        return MonacoWorkerKind.Editor
    }
}
