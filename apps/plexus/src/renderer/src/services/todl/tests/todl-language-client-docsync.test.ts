import { test, expect } from 'vitest'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeServiceHarness, FakeLanguageService } from './fake-language-service.js'
import { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import { CodeDocument } from '../../../modules/code-editor/code-document.js'
import { StorageCodeFile } from '../../../modules/code-editor/code-file.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

class Fixture
{
  private constructor(
    public readonly client: TodlLanguageClient,
    public readonly service: FakeLanguageService,
    public readonly diagnostics: DiagnosticsService,
    public readonly storage: FakeStorage,
    public readonly doc: CodeDocument,
  ) {}

  public static async AttachedDoc(): Promise<Fixture>
  {
    const storage = new FakeStorage('proj')
    await storage.WriteText('a.todl', 'namespace demo {\n}')
    const service = new FakeLanguageService()
    const { provider, diagnostics } = FakeServiceHarness.Provider(service)
    const client = new TodlLanguageClient(provider)
    await client.AttachProject('C:\\proj', 'Proj', storage)
    const doc = new CodeDocument(new StorageCodeFile(storage, 'a.todl'))
    await new Promise((r) => setTimeout(r, 0)) // let load() settle
    return new Fixture(client, service, diagnostics, storage, doc)
  }

  public static async Settle(): Promise<void>
  {
    await new Promise((r) => setTimeout(r, 0))
  }
}

test('editing an attached doc pushes a full-text DidChange to its service uri', async () =>
{
  const { client, storage, doc, service } = await Fixture.AttachedDoc()
  client.AttachDocument(doc, storage)
  service.DidChangeCalls.length = 0
  doc.Content = 'namespace demo {\n  concept x { }\n}'
  const change = service.DidChangeCalls.find((c) => c.uri === 'proj/a.todl')
  expect(change).toBeTruthy()
  expect(change!.text).toContain('concept x')
})

test('editing an attached doc re-pulls and updates the project diagnostics', async () =>
{
  const { client, storage, doc, service, diagnostics } = await Fixture.AttachedDoc()
  client.AttachDocument(doc, storage)
  service.SetDiagnostics('proj/a.todl', [FakeLanguageService.Diag('edited')])
  doc.Content = 'namespace demo {\n  concept x { }\n}'
  await Fixture.Settle() // the edit's fire-and-forget diagnostics re-pull
  const forFile = diagnostics.ForUri('a.todl')
  expect(forFile).toHaveLength(1)
  expect(forFile[0]!.message).toBe('edited')
})

test('ResyncProject pushes a newly created file and forgets a removed one', async () =>
{
  const { client, storage, service } = await Fixture.AttachedDoc()
  await storage.WriteText('b.todl', 'namespace two {\n}')
  await storage.Delete('a.todl')
  service.DidChangeCalls.length = 0
  await client.ResyncProject('C:\\proj', storage)
  const pushed = service.DidChangeCalls.map((c) => c.uri)
  expect(pushed).toContain('proj/b.todl')
  expect(pushed).not.toContain('proj/a.todl') // removed ⇒ no longer pushed
})
