import { test, expect } from 'vitest'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeServiceHarness } from './fake-language-service.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

// A fresh client over a fake language service — the registry helpers under test
// (uriFor / resolveUri / projectKeyFor) never touch the service.
class Fixture
{
  public static Client(): TodlLanguageClient
  {
    return new TodlLanguageClient(FakeServiceHarness.Provider().provider)
  }
}

test('uriFor/resolveUri round-trips through the registry', () =>
{
  const client = Fixture.Client()
  const storage = new FakeStorage('proj')
  client.registerProject('C:\\p1', 'P1', storage)
  const uri = client.uriFor('C:\\p1', 'src/a.todl')
  expect(uri.startsWith('todl://')).toBe(true)
  const r = client.resolveUri(uri)
  expect(r).toEqual({ projectId: 'C:\\p1', storage, relpath: 'src/a.todl' })
})

test('rootUri is the project prefix with an empty relpath', () =>
{
  const client = Fixture.Client()
  client.registerProject('C:\\p1', 'P1', new FakeStorage('proj'))
  expect(client.uriFor('C:\\p1', '')).toBe(client.uriFor('C:\\p1', 'x.todl').replace('x.todl', ''))
})

test('resolveUri returns null for an unknown project', () =>
{
  const client = Fixture.Client()
  expect(client.resolveUri('todl://nope/x.todl')).toBeNull()
})

test('projectKey is lowercase hex so it survives Monaco Uri normalization', () =>
{
  // Monaco lowercases + percent-decodes a URI authority; a key with any other
  // character would make model.uri.toString() differ from the registered URI and
  // break every request (hover/definition/completion). Guard against regressing
  // to encodeURIComponent, whose `%3A`/`:` get mangled.
  const client = Fixture.Client()
  const key = client.projectKeyFor('C:\\Users\\Eugene\\proj')
  expect(key).toMatch(/^[0-9a-f]+$/)
})
