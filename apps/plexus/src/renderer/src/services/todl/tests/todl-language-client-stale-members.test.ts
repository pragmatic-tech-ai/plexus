import { test, expect, vi } from 'vitest'
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime'
import { TodlLanguageClient } from '../todl-language-client.js'
import { FakeServiceHarness, FakeLanguageService } from './fake-language-service.js'
import { DiagnosticsService } from '@pragmatic-tech-ai/plexus-core/renderer/diagnostics/diagnostics-service.js'

// The client reacts to the service's StaleMembers PropertyChanged push by
// re-pulling diagnostics for every registered project (over-refresh is acceptable;
// there are few open projects) and firing the semantic-stale fan-out.
class Fixture
{
  private constructor(
    public readonly client: TodlLanguageClient,
    public readonly service: FakeLanguageService,
    public readonly diagnostics: DiagnosticsService,
  ) {}

  public static async Build(): Promise<Fixture>
  {
    const service = new FakeLanguageService()
    const { provider, diagnostics } = FakeServiceHarness.Provider(service)
    const mm = new FakeStorage('C:/mm')
    const lib = new FakeStorage('C:/lib')
    await mm.WriteText('m.todl', 'namespace mm {\n}')
    await lib.WriteText('l.todl', 'namespace lib {\n}')
    const client = new TodlLanguageClient(provider)
    await client.AttachProject('C:/mm', 'MM', mm)
    await client.AttachProject('C:/lib', 'Lib', lib)
    client.SubscribeToStaleMembers()
    return new Fixture(client, service, diagnostics)
  }

  public static async Settle(): Promise<void>
  {
    await new Promise((r) => setTimeout(r, 0))
  }
}

test('a StaleMembers raise re-pulls diagnostics for every registered project', async () =>
{
  const { service, diagnostics } = await Fixture.Build()
  service.SetDiagnostics('C:/mm/m.todl', [FakeLanguageService.Diag('stale-mm')])
  service.SetDiagnostics('C:/lib/l.todl', [FakeLanguageService.Diag('stale-lib')])

  service.RaiseStaleMembers(new Set(['mm']))
  await Fixture.Settle()

  expect(diagnostics.ForUri('m.todl').some((d) => d.message === 'stale-mm')).toBe(true)
  expect(diagnostics.ForUri('l.todl').some((d) => d.message === 'stale-lib')).toBe(true)
})

test('a StaleMembers raise fires the semantic-stale event', async () =>
{
  const { client, service } = await Fixture.Build()
  const stale = vi.fn()
  client.onSemanticTokensStale(stale)

  service.RaiseStaleMembers(new Set(['mm']))
  await Fixture.Settle()

  expect(stale).toHaveBeenCalled()
})

test('SubscribeToStaleMembers is idempotent — a re-call disposes the prior subscription', async () =>
{
  const { client, service } = await Fixture.Build()
  const stale = vi.fn()
  client.onSemanticTokensStale(stale)

  client.SubscribeToStaleMembers() // second subscription; must drop the first
  service.RaiseStaleMembers(new Set(['mm']))
  await Fixture.Settle()

  expect(stale).toHaveBeenCalledTimes(1) // not twice
})
