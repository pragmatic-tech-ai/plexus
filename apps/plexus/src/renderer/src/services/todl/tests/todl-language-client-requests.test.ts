import { test, expect } from 'vitest'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeServiceHarness, FakeLanguageService } from './fake-language-service.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

// A project with an open + a closed .todl, so request dispatch (URI translation)
// and the WorkspaceEdit apply path can both be exercised.
class Fixture
{
  private constructor(
    public readonly client: TodlLanguageClient,
    public readonly service: FakeLanguageService,
    public readonly storage: FakeStorage,
  ) {}

  public static async Attach(): Promise<Fixture>
  {
    const storage = new FakeStorage('proj')
    await storage.WriteText('open.todl', 'aaa')
    await storage.WriteText('closed.todl', 'zzz')
    const service = new FakeLanguageService()
    const { provider } = FakeServiceHarness.Provider(service)
    const client = new TodlLanguageClient(provider)
    await client.AttachProject('C:\\proj', 'Proj', storage)
    return new Fixture(client, service, storage)
  }

  // A position request params object for a project file.
  public PositionParams(relpath: string): unknown
  {
    return { textDocument: { uri: this.client.uriFor('C:\\proj', relpath) }, position: { line: 0, character: 0 } }
  }
}

const ZERO_RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

test('sendRequest(hover) returns the service hover unchanged', async () =>
{
  const f = await Fixture.Attach()
  f.service.HoverResult = { contents: { kind: 'markdown', value: 'hi' } }
  const res = await f.client.sendRequest('textDocument/hover', f.PositionParams('open.todl'))
  expect(res).toEqual({ contents: { kind: 'markdown', value: 'hi' } })
})

test('sendRequest(definition) rewrites the result Location.uri back to todl://', async () =>
{
  const f = await Fixture.Attach()
  f.service.DefinitionResult = { uri: 'proj/closed.todl', range: ZERO_RANGE }
  const res = (await f.client.sendRequest('textDocument/definition', f.PositionParams('open.todl'))) as { uri: string }
  expect(res.uri).toBe(f.client.uriFor('C:\\proj', 'closed.todl'))
})

test('sendRequest(references) rewrites every Location.uri back to todl://', async () =>
{
  const f = await Fixture.Attach()
  f.service.ReferenceResults = [
    { uri: 'proj/open.todl', range: ZERO_RANGE },
    { uri: 'proj/closed.todl', range: ZERO_RANGE },
  ]
  const params = { ...(f.PositionParams('open.todl') as object), context: { includeDeclaration: true } }
  const res = (await f.client.sendRequest('textDocument/references', params)) as Array<{ uri: string }>
  expect(res.map((l) => l.uri)).toEqual([
    f.client.uriFor('C:\\proj', 'open.todl'),
    f.client.uriFor('C:\\proj', 'closed.todl'),
  ])
})

test('sendRequest(rename) returns a todl://-keyed WorkspaceEdit that applyWorkspaceEdit can apply to open + closed files', async () =>
{
  const f = await Fixture.Attach()
  f.service.RenameResult = { changes: {
    'proj/open.todl': [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'X' }],
    'proj/closed.todl': [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: 'Z' }],
  } }
  const params = { ...(f.PositionParams('open.todl') as object), newName: 'Y' }
  const edit = (await f.client.sendRequest('textDocument/rename', params)) as { changes: Record<string, unknown> }
  expect(Object.keys(edit.changes)).toEqual([
    f.client.uriFor('C:\\proj', 'open.todl'),
    f.client.uriFor('C:\\proj', 'closed.todl'),
  ])

  const applied: unknown[] = []
  f.client.setModelFinder((uri) => uri.endsWith('open.todl') ? { applyEdits: (e: unknown[]) => { applied.push(...e) } } : null)
  await f.client.applyWorkspaceEdit(edit)
  expect(applied).toHaveLength(1)                       // open buffer edited via model
  expect(await f.storage.ReadText('closed.todl')).toBe('Zzz') // closed file edited via storage
  expect(await f.storage.ReadText('open.todl')).toBe('aaa')   // open file untouched on disk
})

test('sendRequest(rename) returns null when the service returns a RenameError', async () =>
{
  const f = await Fixture.Attach()
  f.service.RenameResult = { Error: 'cannot rename' }
  const params = { ...(f.PositionParams('open.todl') as object), newName: 'Y' }
  expect(await f.client.sendRequest('textDocument/rename', params)).toBeNull()
})

test('sendRequest rejects an unknown method', async () =>
{
  const f = await Fixture.Attach()
  await expect(f.client.sendRequest('textDocument/unknown', f.PositionParams('open.todl'))).rejects.toThrow()
})
