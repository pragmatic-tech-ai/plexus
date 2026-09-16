import { test, expect } from 'vitest'
import { setCrossFileOpener, handleCrossFileOpen } from '../cross-file-open.js'

test('handleCrossFileOpen delegates to the registered opener and returns its result', () => {
  const seen: Array<{ uri: string; sel: unknown }> = []
  setCrossFileOpener((uri, sel) => { seen.push({ uri, sel }); return uri.startsWith('todl://') })

  expect(handleCrossFileOpen('todl://abc/a.todl', { startLineNumber: 3, startColumn: 2 })).toBe(true)
  expect(seen[0]).toEqual({ uri: 'todl://abc/a.todl', sel: { startLineNumber: 3, startColumn: 2 } })

  // Unresolvable (non-todl) → opener returns false → not handled.
  expect(handleCrossFileOpen('file:///x.ts')).toBe(false)
})
