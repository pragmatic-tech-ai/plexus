import { test, expect } from 'vitest'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeServiceHarness, FakeLanguageService } from './fake-language-service.js'
import { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostic.js'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'

class Fixture
{
  private constructor(
    public readonly client: TodlLanguageClient,
    public readonly service: FakeLanguageService,
    public readonly diagnostics: DiagnosticsService,
    public readonly storage: FakeStorage,
  ) {}

  public static async Attach(service: FakeLanguageService): Promise<Fixture>
  {
    const storage = new FakeStorage('proj')
    await storage.WriteText('a.todl', 'aaa')
    const { provider, diagnostics } = FakeServiceHarness.Provider(service)
    const client = new TodlLanguageClient(provider)
    await client.AttachProject('C:\\proj', 'Proj', storage)
    return new Fixture(client, service, diagnostics, storage)
  }
}

test('a pulled LSP diagnostic reaches DiagnosticsService as canonical (1-based, relpath)', async () =>
{
  const service = new FakeLanguageService()
  service.SetDiagnostics('proj/a.todl', [{ range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } }, message: 'boom', severity: 1 }])
  const { diagnostics } = await Fixture.Attach(service)
  const forFile = diagnostics.ForUri('a.todl')
  expect(forFile).toHaveLength(1)
  expect(forFile[0]!.projectId).toBe('C:\\proj')
  expect(forFile[0]!.severity).toBe(DiagnosticSeverity.Error)
  expect(forFile[0]!.span).toEqual({ startLine: 2, startColumn: 3, endLine: 2, endColumn: 6 })
})

test('maps LSP severities to canonical severities', async () =>
{
  const service = new FakeLanguageService()
  service.SetDiagnostics('proj/a.todl', [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'warn', severity: 2 }])
  const { diagnostics } = await Fixture.Attach(service)
  expect(diagnostics.ForUri('a.todl')[0]!.severity).toBe(DiagnosticSeverity.Warning)
})

test('a re-pull returning no diagnostics clears the file slice', async () =>
{
  const service = new FakeLanguageService()
  service.SetDiagnostics('proj/a.todl', [FakeLanguageService.Diag('x')])
  const { client, service: svc, diagnostics, storage } = await Fixture.Attach(service)
  expect(diagnostics.ForUri('a.todl')).toHaveLength(1)
  svc.SetDiagnostics('proj/a.todl', [])
  await client.ResyncProject('C:\\proj', storage) // re-pulls the whole project
  expect(diagnostics.ForUri('a.todl')).toHaveLength(0)
})
