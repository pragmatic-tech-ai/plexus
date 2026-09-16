import { test, expect } from 'vitest'
import { provideHover, provideDefinition, provideReferences, provideCompletion } from '../providers.js'

const model = { uri: { toString: () => 'todl://p/a.todl' } }

test('provideHover maps an LSP hover (MarkupContent) to a Monaco hover', async () => {
  const req = { sendRequest: async () => ({ contents: { kind: 'markdown', value: '**concept** animal' }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } } }) }
  const hover = await provideHover(req, model, { lineNumber: 1, column: 1 })
  expect(hover!.contents[0]!.value).toContain('animal')
  expect(hover!.range).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 })
})

test('provideHover returns null when the server has nothing', async () => {
  const req = { sendRequest: async () => null }
  expect(await provideHover(req, model, { lineNumber: 1, column: 1 })).toBeNull()
})

test('provideDefinition maps a single LSP Location to a Monaco location', async () => {
  const req = { sendRequest: async () => ({ uri: 'todl://p/b.todl', range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } } }) }
  const defs = await provideDefinition(req, model, { lineNumber: 1, column: 1 })
  expect(defs).toHaveLength(1)
  expect(defs[0]!.uri).toBe('todl://p/b.todl')
  expect(defs[0]!.range.startLineNumber).toBe(3)
})

test('provideReferences maps a Location array', async () => {
  const req = { sendRequest: async () => ([
    { uri: 'todl://p/a.todl', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } },
    { uri: 'todl://p/b.todl', range: { start: { line: 4, character: 1 }, end: { line: 4, character: 4 } } },
  ]) }
  const refs = await provideReferences(req, model, { lineNumber: 1, column: 1 })
  expect(refs).toHaveLength(2)
  expect(refs[1]!.range.startLineNumber).toBe(5)
})

test('provideCompletion maps items, defaulting insertText to the label', async () => {
  const req = { sendRequest: async () => ({ items: [{ label: 'animal', kind: 7, documentation: { value: 'an animal' } }] }) }
  const { suggestions } = await provideCompletion(req, model, { lineNumber: 1, column: 1 })
  expect(suggestions[0]).toEqual({ label: 'animal', insertText: 'animal', kind: 7, documentation: 'an animal' })
})
