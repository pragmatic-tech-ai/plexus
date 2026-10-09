import { describe, it, expect } from 'vitest'
import { MonacoWorkerRouting, MonacoWorkerKind } from '../monaco-worker-kind.js'

// Monaco routes each worker request through MonacoEnvironment.getWorker(moduleId, label).
// The built-in TypeScript mode labels its requests "typescript"/"javascript" and expects
// the TS language-service worker; everything else expects the base editor worker. Handing
// the base worker back for a TS label leaves the TS providers calling methods it cannot
// service (getDocumentHighlights, getCodeFixesAtPosition, provideInlayHints).
describe('MonacoWorkerRouting.KindFor', () =>
{
    it('routes the typescript language-service label to the language worker', () =>
    {
        expect(MonacoWorkerRouting.KindFor('typescript')).toBe(MonacoWorkerKind.LanguageService)
    })

    it('routes the javascript label to the same language worker', () =>
    {
        expect(MonacoWorkerRouting.KindFor('javascript')).toBe(MonacoWorkerKind.LanguageService)
    })

    it('routes the base editor-worker label to the editor worker', () =>
    {
        expect(MonacoWorkerRouting.KindFor('editorWorkerService')).toBe(MonacoWorkerKind.Editor)
    })

    it('defaults any other language label to the editor worker', () =>
    {
        expect(MonacoWorkerRouting.KindFor('json')).toBe(MonacoWorkerKind.Editor)
    })
})
