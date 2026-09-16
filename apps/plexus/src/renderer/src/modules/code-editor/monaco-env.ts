import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

// Configure Monaco's worker exactly once (module side effect). Vite's `?worker`
// import bundles the worker as a same-origin file — no plugin, no blob/eval — so
// it loads under the renderer's constraints. A generic text editor needs only
// the base editor worker; language-service workers (ts/json/…) would be added
// here per language for richer IntelliSense.
const scope = self as unknown as { MonacoEnvironment?: { getWorker(): Worker } }
if (scope.MonacoEnvironment === undefined)
{
    scope.MonacoEnvironment = { getWorker: () => new EditorWorker() }
}

export {}
