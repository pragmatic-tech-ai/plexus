import { test, expect } from 'vitest'

import { EditorSeverity, toMarkers, markerSignature, type EditorDiagnostic } from '../editor-diagnostic.js'

const mkDiag = (over: Partial<EditorDiagnostic> = {}): EditorDiagnostic => ({
    severity: EditorSeverity.Error, message: 'm', startLine: 1, startColumn: 1, endLine: 1, endColumn: 2, ...over,
})

test('markerSignature is equal for the same set in a different order', () => {
    const a = mkDiag({ message: 'a' })
    const b = mkDiag({ message: 'b', startLine: 3 })
    expect(markerSignature([a, b])).toBe(markerSignature([b, a]))
})

test('markerSignature differs when a diagnostic changes', () => {
    const base = markerSignature([mkDiag({ message: 'a' })])
    expect(markerSignature([mkDiag({ message: 'a', endColumn: 5 })])).not.toBe(base)
    expect(markerSignature([mkDiag({ message: 'a', severity: EditorSeverity.Warning })])).not.toBe(base)
    expect(markerSignature([])).not.toBe(base)
})

test('toMarkers maps each severity to its Monaco value', () => {
    const diag = (severity: EditorSeverity): EditorDiagnostic => ({
        severity, message: 'x', startLine: 1, startColumn: 1, endLine: 1, endColumn: 2,
    })
    const [error, warning, info, hint] = toMarkers([
        diag(EditorSeverity.Error), diag(EditorSeverity.Warning),
        diag(EditorSeverity.Info), diag(EditorSeverity.Hint),
    ])
    expect(error?.severity).toBe(8)
    expect(warning?.severity).toBe(4)
    expect(info?.severity).toBe(2)
    expect(hint?.severity).toBe(1)
})

test('toMarkers copies the 1-based range and message verbatim', () => {
    const [m] = toMarkers([{
        severity: EditorSeverity.Error, message: 'boom',
        startLine: 3, startColumn: 5, endLine: 3, endColumn: 9,
    }])
    expect(m).toMatchObject({
        message: 'boom', startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 9,
    })
})
