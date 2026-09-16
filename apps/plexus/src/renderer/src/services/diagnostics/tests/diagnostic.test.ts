import { test, expect } from 'vitest'
import { EditorSeverity } from '../../../modules/code-editor/editor-diagnostic.js'
import { DiagnosticSeverity, toEditorDiagnostic, type Diagnostic } from '../diagnostic.js'

const spanned: Diagnostic = {
    owner: 'todl', projectId: '/p', projectName: 'P', uri: 'a.todl',
    message: 'bad', severity: DiagnosticSeverity.Warning,
    span: { startLine: 3, startColumn: 5, endLine: 3, endColumn: 9 },
}

test('toEditorDiagnostic copies span + maps severity', () => {
    const e = toEditorDiagnostic(spanned)
    expect(e).toEqual({
        severity: EditorSeverity.Warning, message: 'bad',
        startLine: 3, startColumn: 5, endLine: 3, endColumn: 9,
    })
})

test('toEditorDiagnostic collapses a null span to document start', () => {
    const projLevel: Diagnostic = { ...spanned, span: null, severity: DiagnosticSeverity.Error }
    const e = toEditorDiagnostic(projLevel)
    expect(e).toEqual({
        severity: EditorSeverity.Error, message: 'bad',
        startLine: 1, startColumn: 1, endLine: 1, endColumn: 2,
    })
})
