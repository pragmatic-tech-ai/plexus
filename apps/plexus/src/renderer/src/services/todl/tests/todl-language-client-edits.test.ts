import { test, expect } from 'vitest'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeServiceHarness } from './fake-language-service.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

class Fixture
{
  private constructor(
    public readonly client: TodlLanguageClient,
    public readonly storage: FakeStorage,
  ) {}

  public static async Attach(): Promise<Fixture>
  {
    const storage = new FakeStorage('proj')
    await storage.WriteText('open.todl', 'aaa')
    await storage.WriteText('closed.todl', 'zzz')
    const client = new TodlLanguageClient(FakeServiceHarness.Provider().provider)
    await client.AttachProject('C:\\proj', 'Proj', storage)
    return new Fixture(client, storage)
  }
}

test('closed-file edits apply through storage, offset-descending', async () =>
{
  const { client, storage } = await Fixture.Attach()
  await client.applyWorkspaceEdit({ changes: { [client.uriFor('C:\\proj', 'closed.todl')]: [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'Z' },
    { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }, newText: 'Z' },
  ] } })
  expect(await storage.ReadText('closed.todl')).toBe('ZzZ')
})

test('open-buffer edits go through the model, not storage', async () =>
{
  const { client, storage } = await Fixture.Attach()
  const applied: unknown[] = []
  client.setModelFinder((uri) => uri.endsWith('open.todl') ? { applyEdits: (e: unknown[]) => { applied.push(...e) } } : null)
  await client.applyWorkspaceEdit({ changes: { [client.uriFor('C:\\proj', 'open.todl')]: [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'X' },
  ] } })
  expect(applied).toHaveLength(1)
  expect(await storage.ReadText('open.todl')).toBe('aaa') // untouched on disk
})

test('multi-line closed-file edit computes offsets across lines', async () =>
{
  const { client, storage } = await Fixture.Attach()
  await storage.WriteText('m.todl', 'line0\nline1\nline2')
  // Re-sync the project so m.todl resolves through the registry.
  await client.ResyncProject('C:\\proj', storage)
  await client.applyWorkspaceEdit({ changes: { [client.uriFor('C:\\proj', 'm.todl')]: [
    { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, newText: 'LINE1' },
  ] } })
  expect(await storage.ReadText('m.todl')).toBe('line0\nLINE1\nline2')
})
