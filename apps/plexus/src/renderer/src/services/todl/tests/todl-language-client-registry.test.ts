import { test, expect } from 'vitest'
import { TodlLanguageClient } from '../todl-language-client.js'
import { providerWithFakeResolver } from './fake-resolver.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

test('uriFor/resolveUri round-trips through the registry', () => {
  const client = new TodlLanguageClient(providerWithFakeResolver())
  const storage = new FakeStorage('proj')
  client.registerProject('C:\\p1', 'P1', storage)
  const uri = client.uriFor('C:\\p1', 'src/a.todl')
  expect(uri.startsWith('todl://')).toBe(true)
  const r = client.resolveUri(uri)
  expect(r).toEqual({ projectId: 'C:\\p1', storage, relpath: 'src/a.todl' })
})

test('rootUri is the project prefix with an empty relpath', () => {
  const client = new TodlLanguageClient(providerWithFakeResolver())
  client.registerProject('C:\\p1', 'P1', new FakeStorage('proj'))
  expect(client.uriFor('C:\\p1', '')).toBe(client.uriFor('C:\\p1', 'x.todl').replace('x.todl', ''))
})

test('resolveUri returns null for an unknown project', () => {
  const client = new TodlLanguageClient(providerWithFakeResolver())
  expect(client.resolveUri('todl://nope/x.todl')).toBeNull()
})

test('projectKey is lowercase hex so it survives Monaco Uri normalization', () => {
  // Monaco lowercases + percent-decodes a URI authority; a key with any other
  // character would make model.uri.toString() differ from the didOpen URI and
  // break every request (hover/definition/completion). Guard against regressing
  // to encodeURIComponent, whose `%3A`/`:` get mangled.
  const client = new TodlLanguageClient(providerWithFakeResolver())
  const key = client.projectKeyFor('C:\\Users\\Eugene\\proj')
  expect(key).toMatch(/^[0-9a-f]+$/)
})
