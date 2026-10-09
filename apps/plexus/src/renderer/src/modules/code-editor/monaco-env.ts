import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { MonacoWorkerKind, MonacoWorkerRouting } from './monaco-worker-kind.js'

// Configure Monaco's worker environment exactly once (module side effect). Vite's
// `?worker` import bundles each worker as a same-origin file — no plugin, no blob/eval
// — so they load under the renderer's constraints. Monaco passes the requesting
// language's `label` to getWorker: its built-in TypeScript mode needs the dedicated TS
// language-service worker (ts.worker, shared by the "typescript"/"javascript" labels),
// and everything else uses the base editor worker. Returning the base worker for a TS
// request leaves the TS language providers calling methods that worker has no handler
// for (getDocumentHighlights, getCodeFixesAtPosition, provideInlayHints, …).
export class MonacoWorkerEnvironment
{
    public static Install(): void
    {
        const scope = self as unknown as { MonacoEnvironment?: { getWorker(moduleId: string, label: string): Worker } }
        if (scope.MonacoEnvironment !== undefined) return
        scope.MonacoEnvironment = { getWorker: (_moduleId, label) => MonacoWorkerEnvironment.WorkerFor(label) }
    }

    private static WorkerFor(label: string): Worker
    {
        if (MonacoWorkerRouting.KindFor(label) === MonacoWorkerKind.LanguageService)
        {
            return new TsWorker()
        }
        return new EditorWorker()
    }
}

MonacoWorkerEnvironment.Install()
