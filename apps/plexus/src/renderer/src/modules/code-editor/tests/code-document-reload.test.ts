import { describe, expect, test } from 'vitest'
import { CodeDocument } from '../code-document.js'
import { IncomingApplyResult } from '@pragmatic-tech-ai/plexus-core/renderer/modules/storage/remote-change-coordinator.js'
import { type ICodeFile } from '../code-file.js'

class FakeFile implements ICodeFile
{
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

describe('CodeDocument.ApplyIncoming', () => {
  test('clean buffer takes the server content', async () => {
    const file = new FakeFile('a.txt', 'v1')
    const doc = new CodeDocument(file)
    await new Promise(r => setTimeout(r, 0))
    file.text = 'v2'
    expect(await doc.ApplyIncoming()).toBe(IncomingApplyResult.Applied)
    expect(doc.Content).toBe('v2')
  })

  test('keystrokes typed DURING the async read are not overwritten', async () => {
    const file = new FakeFile('a.txt', 'v1')
    const doc = new CodeDocument(file)
    await new Promise(r => setTimeout(r, 0))
    file.text = 'v2'
    const pending = doc.ApplyIncoming()
    doc.Content = 'typed while reading'
    expect(await pending).toBe(IncomingApplyResult.DirtySkipped)
    expect(doc.Content).toBe('typed while reading')
  })

  test('own-write echo is Unchanged and leaves the buffer alone', async () => {
    const file = new FakeFile('a.txt', 'v1')
    const doc = new CodeDocument(file)
    await new Promise(r => setTimeout(r, 0))
    doc.Content = 'mine'
    await doc.Save()
    doc.Content = 'mine and more'
    expect(await doc.ApplyIncoming()).toBe(IncomingApplyResult.Unchanged)
    expect(doc.Content).toBe('mine and more')
  })

  test('SetChangedOnServer marks the tab title non-destructively', async () => {
    const doc = new CodeDocument(new FakeFile('dir/a.txt', 'v1'))
    doc.SetChangedOnServer(true)
    expect(doc.Title).toContain('changed on server')
    doc.SetChangedOnServer(false)
    expect(doc.Title).toBe('a.txt')
  })
})
