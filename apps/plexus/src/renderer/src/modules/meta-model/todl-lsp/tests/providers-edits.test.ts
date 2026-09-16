import { test, expect } from 'vitest'
import { provideRenameEdits, provideFormattingEdits, provideCodeActions, providePrepareRename } from '../providers.js'

const model = { uri: { toString: () => 'todl://p/a.todl' } }

test('rename delegates the WorkspaceEdit to the client and returns an empty Monaco edit', async () => {
  let appliedWith: unknown
  const client = {
    sendRequest: async () => ({ changes: { 'todl://p/a.todl': [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'dog' }] } }),
    applyWorkspaceEdit: async (e: unknown) => { appliedWith = e },
  }
  const result = await provideRenameEdits(client, model, { lineNumber: 1, column: 1 }, 'dog')
  expect(appliedWith).toBeTruthy()
  expect(result.edits).toHaveLength(0)
})

test('prepareRename maps the range and placeholder', async () => {
  const req = { sendRequest: async () => ({ range: { start: { line: 0, character: 8 }, end: { line: 0, character: 14 } }, placeholder: 'animal' }) }
  const res = await providePrepareRename(req, model, { lineNumber: 1, column: 9 })
  expect(res!.text).toBe('animal')
  expect(res!.range.startColumn).toBe(9)
})

test('code actions flatten the WorkspaceEdit changes into per-file edits', async () => {
  const req = { sendRequest: async () => ([{ title: 'Add missing field "name"', kind: 'quickfix', edit: { changes: { 'todl://p/a.todl': [{ range: { start: { line: 3, character: 8 }, end: { line: 3, character: 8 } }, newText: '\n  name = ;' }] } } }]) }
  const actions = await provideCodeActions(req, model, { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 1 }, [])
  expect(actions[0]!.title).toContain('name')
  expect(actions[0]!.edits[0]!.uri).toBe('todl://p/a.todl')
  expect(actions[0]!.edits[0]!.range.startLineNumber).toBe(4)
})

test('formatting maps LSP TextEdits to Monaco text edits', async () => {
  const req = { sendRequest: async () => ([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, newText: '  ' }]) }
  const edits = await provideFormattingEdits(req, model)
  expect(edits[0]!.range.startLineNumber).toBe(1)
  expect(edits[0]!.text).toBe('  ')
})
