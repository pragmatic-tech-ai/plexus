import { describe, test, expect } from 'vitest'
import { collectProblems, resolveOwningProject, summarizeProject, type OpenProjectRef } from '../refresh-targets.js'
import { DiagnosticSeverity, type Diagnostic, type DiagnosticSpan } from '../../diagnostics/diagnostic.js'
import { ProblemSeverity } from '../../../../../shared/agent-api.js'

const OPEN: OpenProjectRef[] = [
    { folder: 'C:\\Users\\me\\projA', name: 'A' },
    { folder: 'C:\\Users\\me\\projB', name: 'B' },
]

function diag(projectId: string, severity: DiagnosticSeverity, message: string, span: DiagnosticSpan | null = null): Diagnostic
{
    return { owner: 'todl', projectId, projectName: 'x', uri: 'f.todl', message, severity, span }
}

describe('resolveOwningProject', () => {
    test('matches a file inside a project (Windows sep + case insensitive)', () => {
        const owner = resolveOwningProject(OPEN, 'c:/users/me/projA/models/x.todl')
        expect(owner?.name).toBe('A')
    })
    test('matches the project folder itself', () => {
        expect(resolveOwningProject(OPEN, 'C:\\Users\\me\\projB')?.name).toBe('B')
    })
    test('does not match a sibling whose name is a string-prefix but not a path-prefix', () => {
        expect(resolveOwningProject([{ folder: '/p/proj', name: 'P' }], '/p/project-x/f.todl')).toBeUndefined()
    })
    test('returns undefined when nothing contains the path', () => {
        expect(resolveOwningProject(OPEN, 'D:/other/x.todl')).toBeUndefined()
    })
})

describe('summarizeProject', () => {
    test('counts by severity and caps sample messages at 5', () => {
        const diags = [
            diag('C:\\Users\\me\\projA', DiagnosticSeverity.Error, 'e1'),
            diag('C:\\Users\\me\\projA', DiagnosticSeverity.Warning, 'w1'),
            ...Array.from({ length: 6 }, (_v, i) => diag('C:\\Users\\me\\projA', DiagnosticSeverity.Error, `x${i}`)),
            diag('C:\\Users\\me\\projB', DiagnosticSeverity.Error, 'other'),
        ]
        const s = summarizeProject(OPEN[0]!, diags)
        expect(s.folder).toBe('C:\\Users\\me\\projA')
        expect(s.errorCount).toBe(7)
        expect(s.warningCount).toBe(1)
        expect(s.sampleMessages.length).toBe(5)
        expect(s.sampleMessages).not.toContain('other')
    })
})

describe('collectProblems', () => {
    const A = 'C:\\Users\\me\\projA', B = 'C:\\Users\\me\\projB'
    const diags: Diagnostic[] = [
        diag(A, DiagnosticSeverity.Error, 'a-err', { startLine: 3, startColumn: 5, endLine: 3, endColumn: 9 }),
        diag(A, DiagnosticSeverity.Warning, 'a-warn'),
        diag(B, DiagnosticSeverity.Error, 'b-err'),
        diag(B, DiagnosticSeverity.Info, 'b-info'),
    ]

    test('no filters → every diagnostic, with counts and mapped fields', () => {
        const r = collectProblems(diags, OPEN)
        expect(r.total).toBe(4)
        expect(r.errorCount).toBe(2)
        expect(r.warningCount).toBe(1)
        expect(r.truncated).toBe(false)
        const aErr = r.problems.find((p) => p.message === 'a-err')!
        expect(aErr.severity).toBe(ProblemSeverity.Error)   // enum string, not the numeric 0
        expect(aErr.folder).toBe(A)
        expect(aErr.line).toBe(3)
        expect(aErr.column).toBe(5)
        // span-less diagnostic omits line/column
        expect(r.problems.find((p) => p.message === 'a-warn')!.line).toBeUndefined()
    })

    test('path scopes to the owning project', () => {
        const r = collectProblems(diags, OPEN, 'c:/users/me/projA/f.todl')
        expect(r.total).toBe(2)
        expect(r.problems.every((p) => p.folder === A)).toBe(true)
    })

    test('severity is a minimum threshold (Warning ⇒ errors + warnings, not info)', () => {
        const r = collectProblems(diags, OPEN, undefined, ProblemSeverity.Warning)
        expect(r.total).toBe(3)                                    // 2 errors + 1 warning
        expect(r.problems.some((p) => p.severity === ProblemSeverity.Info)).toBe(false)
    })

    test('severity Error ⇒ errors only', () => {
        const r = collectProblems(diags, OPEN, undefined, ProblemSeverity.Error)
        expect(r.total).toBe(2)
        expect(r.problems.every((p) => p.severity === ProblemSeverity.Error)).toBe(true)
    })

    test('path matching no open project → empty with a note', () => {
        const r = collectProblems(diags, OPEN, 'D:/elsewhere/x.todl')
        expect(r.problems.length).toBe(0)
        expect(r.total).toBe(0)
        expect((r.note ?? '').length).toBeGreaterThan(0)
    })

    test('caps the list at 200 but counts/total reflect the full set', () => {
        const many = Array.from({ length: 250 }, (_v, i) => diag(A, DiagnosticSeverity.Error, `e${i}`))
        const r = collectProblems(many, OPEN)
        expect(r.total).toBe(250)
        expect(r.errorCount).toBe(250)
        expect(r.problems.length).toBe(200)
        expect(r.truncated).toBe(true)
    })
})
