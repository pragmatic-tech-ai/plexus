import { test, expect, vi } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { toJSON, check } from '@pragmatic-tech-ai/todl'

import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { WorkspaceBaseResolver } from '../../projects/workspace-base-resolver.js'
import { TodlLanguageClient } from '../todl-language-client.js'
import { TodlSemanticScope } from '../semantic-scopes.js'

const LEGEND = { tokenTypes: ['type', 'class', 'property'], tokenModifiers: [] }

function fakeConn() {
  return {
    // handshake's `initialize` request returns the server capabilities incl. legend.
    sendRequest: () => Promise.resolve({ capabilities: { semanticTokensProvider: { legend: LEGEND } } }),
    sendNotification: () => Promise.resolve(),
    onNotification: () => ({ dispose() {} }),
    listen: () => {},
  }
}

function providerWithBase() {
  const provider = new ServiceProvider()
  const doc = toJSON(check([{ uri: 'p.todl', text: 'namespace ea { concept C { label : string; } }' }]).model)
  provider.registerInstance(WorkspaceBaseResolver.Key, {
    ResolveForStorage: async () => ({ bases: [doc], problems: [] }),
  } as unknown as WorkspaceBaseResolver)
  return provider
}

test('advertises the TODL-renamed semantic legend to the editor', async () => {
  const client = new TodlLanguageClient(providerWithBase())
  await client.Initialize(fakeConn() as never)
  expect(client.SemanticLegend().tokenTypes).toEqual([
    TodlSemanticScope.Type, TodlSemanticScope.Class, 'todlProperty',
  ])
})

test('refreshing a known project bases fires the semantic-stale event', async () => {
  const client = new TodlLanguageClient(providerWithBase())
  await client.Initialize(fakeConn() as never)
  const storage = new FakeStorage('C:/arch')
  await client.AttachProject('C:/arch', 'Arch', storage)

  const stale = vi.fn()
  const off = client.onSemanticTokensStale(stale)
  await client.RefreshBases(storage)
  expect(stale).toHaveBeenCalledTimes(1)

  off()
  await client.RefreshBases(storage)
  expect(stale).toHaveBeenCalledTimes(1) // no further calls after unsubscribe
})

test('refreshing an unknown storage does not fire (nothing to recolor)', async () => {
  const client = new TodlLanguageClient(providerWithBase())
  await client.Initialize(fakeConn() as never)
  const stale = vi.fn()
  client.onSemanticTokensStale(stale)
  await client.RefreshBases(new FakeStorage('C:/unknown'))
  expect(stale).not.toHaveBeenCalled()
})
