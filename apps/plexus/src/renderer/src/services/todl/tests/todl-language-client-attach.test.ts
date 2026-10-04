import { test, expect } from 'vitest'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeServiceHarness, FakeLanguageService } from './fake-language-service.js'
import { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

class Fixture
{
  private constructor(
    public readonly client: TodlLanguageClient,
    public readonly service: FakeLanguageService,
    public readonly diagnostics: DiagnosticsService,
    public readonly storage: FakeStorage,
  ) {}

  public static async Attach(): Promise<Fixture>
  {
    const storage = new FakeStorage('proj')
    await storage.WriteText('a.todl', 'namespace demo {\n}')
    await storage.WriteText('sub/b.todl', 'namespace two {\n}')
    const service = new FakeLanguageService()
    service.SetDiagnostics('proj/a.todl', [FakeLanguageService.Diag('boom')])
    const { provider, diagnostics } = FakeServiceHarness.Provider(service)
    const client = new TodlLanguageClient(provider)
    await client.AttachProject('C:\\proj', 'Proj', storage)
    return new Fixture(client, service, diagnostics, storage)
  }
}

test('AttachProject feeds every project .todl into the service as a live buffer', async () =>
{
  const { service } = await Fixture.Attach()
  expect(service.Buffers.get('proj/a.todl')).toBe('namespace demo {\n}')
  expect(service.Buffers.get('proj/sub/b.todl')).toBe('namespace two {\n}')
})

test('AttachProject publishes whole-project diagnostics pulled from the service (1-based, relpath)', async () =>
{
  const { diagnostics } = await Fixture.Attach()
  const forFile = diagnostics.ForUri('a.todl')
  expect(forFile).toHaveLength(1)
  expect(forFile[0]!.projectId).toBe('C:\\proj')
  expect(forFile[0]!.projectName).toBe('Proj')
  expect(forFile[0]!.span).toEqual({ startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 })
})

test('DetachProject clears the project diagnostics and drops the registry', async () =>
{
  const { client, diagnostics, storage } = await Fixture.Attach()
  expect(diagnostics.ForUri('a.todl')).toHaveLength(1)
  client.DetachProject(storage)
  expect(diagnostics.ForUri('a.todl')).toHaveLength(0)
  expect(client.resolveUri(client.uriFor('C:\\proj', 'a.todl'))).toBeNull()
})
