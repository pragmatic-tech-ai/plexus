import { test, expect } from 'vitest'
import { CodeDocument } from '../code-document.js'
import { StorageCodeFile } from '../code-file.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

test('CodeDocument.Uri is settable and defaults empty', () => {
  const doc = new CodeDocument(new StorageCodeFile(new FakeStorage(), 'a.todl'))
  expect(doc.Uri).toBe('')
  doc.Uri = 'todl://proj/a.todl'
  expect(doc.Uri).toBe('todl://proj/a.todl')
})
