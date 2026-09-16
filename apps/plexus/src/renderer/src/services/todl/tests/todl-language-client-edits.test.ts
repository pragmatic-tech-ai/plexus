import { test, expect } from 'vitest'
import { TodlLanguageClient } from '../todl-language-client.js'
import { providerWithFakeResolver } from './fake-resolver.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

function fakeConn() {
  return {
    sendNotification: () => Promise.resolve(),
    sendRequest: () => Promise.resolve(null),
    onNotification: () => ({ dispose() {} }),
    listen: () => {},
  }
}

async function attached() {
  const storage = new FakeStorage('proj')
  await storage.WriteText('open.todl', 'aaa')
  await storage.WriteText('closed.todl', 'zzz')
  const client = new TodlLanguageClient(providerWithFakeResolver())
  await client.Initialize(fakeConn() as never)
  await client.AttachProject('C:\\proj', 'Proj', storage)
  return { client, storage }
}

test('closed-file edits apply through storage, offset-descending', async () => {
  const { client, storage } = await attached()
  await client.applyWorkspaceEdit({ changes: { [client.uriFor('C:\\proj', 'closed.todl')]: [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'Z' },
    { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }, newText: 'Z' },
  ] } })
  expect(await storage.ReadText('closed.todl')).toBe('ZzZ')
})

test('open-buffer edits go through the model, not storage', async () => {
  const { client, storage } = await attached()
  const applied: unknown[] = []
  client.setModelFinder((uri) => uri.endsWith('open.todl') ? { applyEdits: (e: unknown[]) => { applied.push(...e) } } : null)
  await client.applyWorkspaceEdit({ changes: { [client.uriFor('C:\\proj', 'open.todl')]: [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'X' },
  ] } })
  expect(applied).toHaveLength(1)
  expect(await storage.ReadText('open.todl')).toBe('aaa') // untouched on disk
})

test('multi-line closed-file edit computes offsets across lines', async () => {
  const { client, storage } = await attached()
  await storage.WriteText('m.todl', 'line0\nline1\nline2')
  // Re-open the project so m.todl resolves through the registry.
  await client.ResyncProject('C:\\proj', storage)
  await client.applyWorkspaceEdit({ changes: { [client.uriFor('C:\\proj', 'm.todl')]: [
    { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, newText: 'LINE1' },
  ] } })
  expect(await storage.ReadText('m.todl')).toBe('line0\nLINE1\nline2')
})
