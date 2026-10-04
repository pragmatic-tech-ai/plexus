import { test, expect, vi } from 'vitest'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SemanticTokensProvider } from '@pragmatic-tech-ai/todl'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeServiceHarness } from './fake-language-service.js'
import { editorSemanticLegend, TodlSemanticScope } from '../semantic-scopes.js'

class Fixture
{
  public static Client(): TodlLanguageClient
  {
    return new TodlLanguageClient(FakeServiceHarness.Provider().provider)
  }
}

test('advertises the engine legend renamed to TODL-namespaced scopes', () =>
{
  const client = Fixture.Client()
  const legend = client.SemanticLegend()
  expect(legend).toEqual(editorSemanticLegend(SemanticTokensProvider.Legend))
  // The concept-bearing types are renamed so a blue theme rule can target them.
  expect(legend.tokenTypes).toContain(TodlSemanticScope.Type)
  expect(legend.tokenTypes).toContain(TodlSemanticScope.Class)
})

test('refreshing a known project bases fires the semantic-stale event', async () =>
{
  const client = Fixture.Client()
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

test('refreshing an unknown storage does not fire (nothing to recolor)', async () =>
{
  const client = Fixture.Client()
  const stale = vi.fn()
  client.onSemanticTokensStale(stale)
  await client.RefreshBases(new FakeStorage('C:/unknown'))
  expect(stale).not.toHaveBeenCalled()
})
