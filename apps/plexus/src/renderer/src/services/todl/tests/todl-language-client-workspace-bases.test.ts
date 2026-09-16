import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { toJSON, check } from '@pragmatic-tech-ai/todl'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { WorkspaceBaseResolver } from '../../projects/workspace-base-resolver.js'
import { TodlLanguageClient } from '../todl-language-client.js'

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

test('AttachProject resolves bases through WorkspaceBaseResolver (local-first), not resolveBases', async () => {
  const provider = new ServiceProvider()
  const doc = toJSON(check([{ uri: 'p.todl', text: 'namespace ea { concept ViaResolver { label : string; } }' }]).model)
  let called = false
  provider.registerInstance(WorkspaceBaseResolver.Key, {
    ResolveForStorage: async () => { called = true; return { bases: [doc], problems: [] } },
  } as unknown as WorkspaceBaseResolver)

  const client = new TodlLanguageClient(provider)
  const { conn, notes } = fakeConn()
  await client.Initialize(conn as never)

  const storage = new FakeStorage('C:/arch')
  await client.AttachProject('C:/arch', 'Arch', storage)

  expect(called).toBe(true)
  const setBases = notes.find((n) => n.method === 'todl/setBases')
  const bases = (setBases!.params as { bases: typeof doc[] }).bases
  expect(bases[0]!.nodes.some((n) => n.id === 'ViaResolver')).toBe(true)
})
