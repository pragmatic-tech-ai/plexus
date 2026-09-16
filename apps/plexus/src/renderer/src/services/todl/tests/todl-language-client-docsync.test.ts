import { test, expect } from 'vitest'
import { TodlLanguageClient } from '../todl-language-client.js'
import { providerWithFakeResolver } from './fake-resolver.js'
import { CodeDocument } from '../../../modules/code-editor/code-document.js'
import { StorageCodeFile } from '../../../modules/code-editor/code-file.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

function fakeConn() {
  const notes: Array<{ method: string; params: unknown }> = []
  return {
    conn: {
      sendNotification: (m: string, p: unknown) => { notes.push({ method: m, params: p }); return Promise.resolve() },
      sendRequest: () => Promise.resolve(null),
      onNotification: () => ({ dispose() {} }),
      listen: () => {},
    },
    notes,
  }
}

async function attachedDoc() {
  const storage = new FakeStorage('proj')
  await storage.WriteText('a.todl', 'namespace demo {\n}')
  const client = new TodlLanguageClient(providerWithFakeResolver())
  const { conn, notes } = fakeConn()
  await client.Initialize(conn as never)
  await client.AttachProject('C:\\proj', 'Proj', storage)
  const doc = new CodeDocument(new StorageCodeFile(storage, 'a.todl'))
  await new Promise((r) => setTimeout(r, 0)) // let load() settle
  return { client, storage, doc, notes }
}

test('editing an attached doc sends a full-text didChange to its uri', async () => {
  const { client, storage, doc, notes } = await attachedDoc()
  client.AttachDocument(doc, storage)
  notes.length = 0
  doc.Content = 'namespace demo {\n  concept x { }\n}'
  const change = notes.find((n) => n.method === 'textDocument/didChange')
  expect(change).toBeTruthy()
  const p = change!.params as { textDocument: { uri: string }; contentChanges: Array<{ text: string }> }
  expect(p.textDocument.uri).toBe(client.uriFor('C:\\proj', 'a.todl'))
  expect(p.contentChanges[0]!.text).toContain('concept x')
})

test('ResyncProject didOpens a newly created file and didCloses a removed one', async () => {
  const { client, storage, notes } = await attachedDoc()
  await storage.WriteText('b.todl', 'namespace two {\n}')
  await storage.Delete('a.todl')
  notes.length = 0
  await client.ResyncProject('C:\\proj', storage)
  const opened = notes.filter((n) => n.method === 'textDocument/didOpen').map((n) => (n.params as { textDocument: { uri: string } }).textDocument.uri)
  const closed = notes.filter((n) => n.method === 'textDocument/didClose').map((n) => (n.params as { textDocument: { uri: string } }).textDocument.uri)
  expect(opened).toContain(client.uriFor('C:\\proj', 'b.todl'))
  expect(closed).toContain(client.uriFor('C:\\proj', 'a.todl'))
})
