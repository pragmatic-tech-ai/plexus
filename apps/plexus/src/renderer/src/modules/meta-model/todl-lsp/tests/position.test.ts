import { test, expect } from 'vitest'
import { monacoToLspPosition, lspToMonacoPosition, lspToMonacoRange, monacoToLspRange } from '../position.js'

test('monaco 1-based ⇄ lsp 0-based position', () => {
  expect(monacoToLspPosition({ lineNumber: 1, column: 1 })).toEqual({ line: 0, character: 0 })
  expect(lspToMonacoPosition({ line: 2, character: 3 })).toEqual({ lineNumber: 3, column: 4 })
})

test('lsp range → monaco range', () => {
  expect(lspToMonacoRange({ start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }))
    .toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 })
})

test('monaco range → lsp range round-trips', () => {
  const m = { startLineNumber: 3, startColumn: 2, endLineNumber: 4, endColumn: 7 }
  expect(lspToMonacoRange(monacoToLspRange(m))).toEqual(m)
})
