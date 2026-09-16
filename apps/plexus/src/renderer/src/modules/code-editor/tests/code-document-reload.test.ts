import { describe, expect, test } from 'vitest'
import { CodeDocument } from '../code-document.js'
import { type ICodeFile } from '../code-file.js'

class FakeFile implements ICodeFile {
  constructor(public id: string, public text: string) {}
  read(): Promise<string> { return Promise.resolve(this.text) }
  write(text: string): Promise<void> { this.text = text; return Promise.resolve() }
}

describe('CodeDocument.Reload', () => {
  test('re-reads content from the file and clears dirty', async () => {
    const file = new FakeFile('a.txt', 'v1')
    const doc = new CodeDocument(file)
    await Promise.resolve() // let the ctor load() settle
    doc.Content = 'edited'                 // user edit → dirty
    expect(doc.IsDirty).toBe(true)
    file.text = 'v2-external'              // external change on disk
    await doc.Reload()
    expect(doc.Content).toBe('v2-external')
    expect(doc.IsDirty).toBe(false)
  })
})
