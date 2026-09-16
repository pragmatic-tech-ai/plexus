import { test, expect } from 'vitest'
import { provideFoldingRanges, provideDocumentSymbols, provideDocumentSemanticTokens } from '../providers.js'

const model = { uri: { toString: () => 'todl://p/a.todl' } }

test('provideFoldingRanges maps LSP folding ranges (0-based) to Monaco (1-based)', async () => {
  const req = { sendRequest: async () => ([{ startLine: 0, endLine: 3 }]) }
  const ranges = await provideFoldingRanges(req, model)
  expect(ranges[0]).toEqual({ start: 1, end: 4, kind: undefined })
})

test('provideDocumentSymbols maps a nested symbol tree', async () => {
  const req = { sendRequest: async () => ([{
    name: 'animal', kind: 5,
    range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
    selectionRange: { start: { line: 0, character: 8 }, end: { line: 0, character: 14 } },
    children: [{ name: 'legs', kind: 8, range: { start: { line: 1, character: 2 }, end: { line: 1, character: 12 } }, selectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } } }],
  }]) }
  const syms = await provideDocumentSymbols(req, model)
  expect(syms[0]!.name).toBe('animal')
  expect(syms[0]!.range.startLineNumber).toBe(1)
  expect(syms[0]!.children[0]!.name).toBe('legs')
})

test('provideDocumentSemanticTokens passes the delta-encoded data through', async () => {
  const req = { sendRequest: async () => ({ data: [0, 0, 6, 1, 0] }) }
  const tokens = await provideDocumentSemanticTokens(req, model)
  expect(tokens.data).toEqual([0, 0, 6, 1, 0])
})
