import { test, expect } from 'vitest'
import { TodlLanguageClient } from '../todl-language-client.js'
import { providerWithFakeResolver } from './fake-resolver.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

function fakeConn() {
  const notes: Array<{ method: string; params: unknown }> = []
  return {
    conn: {
      sendNotification: (method: string, params: unknown) => { notes.push({ method, params }); return Promise.resolve() },
      sendRequest: () => Promise.resolve(null),
      onNotification: () => ({ dispose() {} }),
      listen: () => {},
    },
    notes,
  }
}

test('AttachProject sets bases then didOpens every project .todl', async () => {
  const storage = new FakeStorage('proj')
  await storage.WriteText('a.todl', 'namespace demo {\n}')
  await storage.WriteText('sub/b.todl', 'namespace two {\n}')
  const client = new TodlLanguageClient(providerWithFakeResolver())
  const { conn, notes } = fakeConn()
  await client.Initialize(conn as never)
  await client.AttachProject('C:\\proj', 'Proj', storage)

  const setBases = notes.find((n) => n.method === 'todl/setBases')
  expect((setBases!.params as { rootUri: string }).rootUri).toBe(client.uriFor('C:\\proj', ''))
  const opened = notes.filter((n) => n.method === 'textDocument/didOpen')
    .map((n) => (n.params as { textDocument: { uri: string } }).textDocument.uri)
  expect(opened).toContain(client.uriFor('C:\\proj', 'a.todl'))
  expect(opened).toContain(client.uriFor('C:\\proj', 'sub/b.todl'))
})

test('DetachProject didCloses the project docs and drops the registry', async () => {
  const storage = new FakeStorage('proj')
  await storage.WriteText('a.todl', 'namespace demo {\n}')
  const client = new TodlLanguageClient(providerWithFakeResolver())
  const { conn, notes } = fakeConn()
  await client.Initialize(conn as never)
  await client.AttachProject('C:\\proj', 'Proj', storage)
  notes.length = 0
  client.DetachProject(storage)
  const closed = notes.filter((n) => n.method === 'textDocument/didClose')
    .map((n) => (n.params as { textDocument: { uri: string } }).textDocument.uri)
  expect(closed).toContain(client.uriFor('C:\\proj', 'a.todl'))
  expect(client.resolveUri(client.uriFor('C:\\proj', 'a.todl'))).toBeNull()
})

test('RefreshBases re-sends bases via todl/refreshBases', async () => {
  const storage = new FakeStorage('proj')
  await storage.WriteText('a.todl', 'namespace demo {\n}')
  const client = new TodlLanguageClient(providerWithFakeResolver())
  const { conn, notes } = fakeConn()
  await client.Initialize(conn as never)
  await client.AttachProject('C:\\proj', 'Proj', storage)
  notes.length = 0
  await client.RefreshBases(storage)
  expect(notes.some((n) => n.method === 'todl/refreshBases')).toBe(true)
})
