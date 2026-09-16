// Pure Monaco⇄LSP position/range converters. LSP is 0-based; Monaco is 1-based;
// both use an exclusive end column. Plain object types (no monaco import) so the
// module is headless-testable and shared by every adapter.

export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }
export interface MonacoPosition { lineNumber: number; column: number }
export interface MonacoRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export function monacoToLspPosition(p: MonacoPosition): LspPosition {
  return { line: p.lineNumber - 1, character: p.column - 1 }
}

export function lspToMonacoPosition(p: LspPosition): MonacoPosition {
  return { lineNumber: p.line + 1, column: p.character + 1 }
}

export function lspToMonacoRange(r: LspRange): MonacoRange {
  const start = lspToMonacoPosition(r.start)
  const end = lspToMonacoPosition(r.end)
  return { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }
}

export function monacoToLspRange(r: MonacoRange): LspRange {
  return {
    start: monacoToLspPosition({ lineNumber: r.startLineNumber, column: r.startColumn }),
    end: monacoToLspPosition({ lineNumber: r.endLineNumber, column: r.endColumn }),
  }
}
