import { test, expect } from 'vitest'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { Observable, FakeStorage, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { SolutionBaseResolver, SolutionManagerService } from '@pragmatic-tech-ai/todl'
import { TodlLanguageClient } from '../todl-language-client.js'

// A JSON-RPC connection double: records every outgoing notification so a test can
// assert exactly what the client pushed to the server.
class FakeConnection
{
  public readonly notifications: Array<{ method: string; params: unknown }> = []

  public sendNotification(method: string, params: unknown): Promise<void>
  {
    this.notifications.push({ method, params })
    return Promise.resolve()
  }

  public sendRequest(): Promise<unknown> { return Promise.resolve(null) }
  public onNotification(): { dispose(): void } { return { dispose(): void {} } }
  public listen(): void {}

  public NotificationsFor(method: string): unknown[]
  {
    return this.notifications.filter((n) => n.method === method).map((n) => n.params)
  }
}

// A minimal SolutionMember double: the client's mapping only reads .Storage.
class FakeMember
{
  public constructor(public readonly Storage: IStorage | undefined) {}
}

// A minimal SolutionManagerService double: ActiveSolution.Members is the only
// surface the client's staleStoragesFor reads.
class FakeSolutionManager
{
  public constructor(private readonly members: readonly FakeMember[]) {}
  public get ActiveSolution(): { Members: readonly FakeMember[] } { return { Members: this.members } }
}

// A fake SolutionBaseResolver: a bare Observable exposing StaleMemberIds and a
// RaiseStaleMembers() driver for the same PropertyChanged('StaleMemberIds') signal
// the real SolutionBaseResolver.Invalidate raises (verified against its .js body —
// RaisePropertyChanged(SolutionBaseResolver.StaleMemberIdsPropertyName, old, evicted)).
// ProducedIdOf counts its calls so a test can assert the client does one pass over
// Members per raise, not one pass per stale id.
class FakeSolutionBaseResolver extends Observable
{
  private static readonly StaleMemberIdsPropertyName = 'StaleMemberIds'

  private staleMemberIds: ReadonlySet<string> = new Set()
  private producedIdCalls = 0

  public constructor(private readonly producedIds: ReadonlyMap<IStorage, string>) { super() }

  public get StaleMemberIds(): ReadonlySet<string> { return this.staleMemberIds }
  public get ProducedIdOfCallCount(): number { return this.producedIdCalls }

  public ProducedIdOf(storage: IStorage): Promise<string | undefined>
  {
    this.producedIdCalls++
    return Promise.resolve(this.producedIds.get(storage))
  }

  public ResolveBasesFor(): Promise<{ bases: unknown[]; problems: string[] }>
  {
    return Promise.resolve({ bases: [], problems: [] })
  }

  public RaiseStaleMembers(ids: ReadonlySet<string>): void
  {
    const old = this.staleMemberIds
    this.staleMemberIds = ids
    this.RaisePropertyChanged(FakeSolutionBaseResolver.StaleMemberIdsPropertyName, old, ids)
  }
}

// Builds a TodlLanguageClient wired to a fake resolver + fake manager, with `mm`/`lib`
// already AttachProject-ed (so RefreshBases finds a registered project for each
// storage) and subscribed via SubscribeToStaleMembers — the method under test.
class TestHarness
{
  private constructor(
    public readonly client: TodlLanguageClient,
    public readonly conn: FakeConnection,
    public readonly resolver: FakeSolutionBaseResolver,
  ) {}

  public static async Build(): Promise<TestHarness>
  {
    const mmStorage = new FakeStorage('C:/mm')
    const libStorage = new FakeStorage('C:/lib')
    const resolver = new FakeSolutionBaseResolver(new Map([[mmStorage, 'mm'], [libStorage, 'lib']]))
    const manager = new FakeSolutionManager([new FakeMember(mmStorage), new FakeMember(libStorage)])

    const provider = new ServiceProvider()
    provider.registerInstance(SolutionBaseResolver.Key, resolver as unknown as SolutionBaseResolver)
    provider.registerInstance(SolutionManagerService.Key, manager as unknown as SolutionManagerService)

    const client = new TodlLanguageClient(provider)
    const conn = new FakeConnection()
    await client.Initialize(conn as never)
    await client.AttachProject('C:/mm', 'MM', mmStorage)
    await client.AttachProject('C:/lib', 'Lib', libStorage)
    conn.notifications.length = 0 // AttachProject's own setBases/didOpen notices don't count

    client.SubscribeToStaleMembers()
    return new TestHarness(client, conn, resolver)
  }

  // Lets a raise's fire-and-forget async handler chain (ProducedIdOf → RefreshBases →
  // basesFor) settle before assertions — the same pattern used elsewhere in this test
  // suite for fire-and-forget async work (see todl-language-client-docsync.test.ts).
  public static async Settle(): Promise<void>
  {
    await new Promise((r) => setTimeout(r, 0))
  }
}

test('raising StaleMemberIds refreshes exactly the matching member storages', async () => {
  const { client, conn, resolver } = await TestHarness.Build()

  resolver.RaiseStaleMembers(new Set(['mm', 'lib']))
  await TestHarness.Settle()

  const refreshed = conn.NotificationsFor('todl/refreshBases') as Array<{ rootUri: string }>
  expect(refreshed).toHaveLength(2)
  const rootUris = refreshed.map((r) => r.rootUri)
  expect(rootUris).toContain(client.uriFor('C:/mm', ''))
  expect(rootUris).toContain(client.uriFor('C:/lib', ''))
})

test('a stale id with no matching member storage is a no-op, not a throw', async () => {
  const { conn, resolver } = await TestHarness.Build()

  expect(() => resolver.RaiseStaleMembers(new Set(['unknown-id']))).not.toThrow()
  await TestHarness.Settle()

  expect(conn.NotificationsFor('todl/refreshBases')).toHaveLength(0)
})

test('two stale ids in one raise drive one refresh pass per storage, not per id', async () => {
  const { conn, resolver } = await TestHarness.Build()

  resolver.RaiseStaleMembers(new Set(['mm', 'lib']))
  await TestHarness.Settle()

  // One ProducedIdOf call per member (2 members) — not one per (member, staleId) pair,
  // which a naive per-id loop over Members would produce (would be 4 here).
  expect(resolver.ProducedIdOfCallCount).toBe(2)
  expect(conn.NotificationsFor('todl/refreshBases')).toHaveLength(2)
})
