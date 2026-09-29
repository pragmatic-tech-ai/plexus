# Solution Engine — testing strategy & harness

> Companion to `c:\tmp\solution-engine-scope.md`. `todl` is the full **headless** engine
> (Option A), so tests are plain `node:test` — but the scenario tests run against **real
> filesystem storage, real project fixtures, and a real local package registry in a temp
> folder**, so they exercise the actual factories / compile / package flow, not mocks.

## Two tiers of tests

1. **Fast unit tests (in-memory).** Pure `SolutionManager` logic that doesn't need real
   files — dirty tracking, discard-guard, recents dedup, Name change. Keep `FakeStorage`
   for these; they stay millisecond-fast.
2. **Scenario integration tests (real FS + real registry).** Everything factory/compile/
   package/reference-shaped. Real `NodeFsStorage` rooted in an OS temp dir, real fixture
   projects, a real local package registry in a temp folder. Slower but faithful.

## Prerequisites this approach surfaces (flag before building)

- **A headless Node-fs `IStorage` must exist in todl/todl-runtime.** Today the local-FS
  `IStorage` lives in **plexus-core** and goes through Electron (`window.api.fs`) — unusable
  in a node test *and* unusable for `todl` to run headless on a CLI/server at all. A plain
  `NodeFsStorage` (fs/promises) belongs in `todl-runtime` (or `todl`). This is needed for the
  engine to be genuinely headless, not just for tests — call it out as engine work, not test
  scaffolding.
- **Headless factories for the core project types must be reachable by the engine.** The
  meta-model / library / architecture factories currently live in **plexus app modules**. For
  a headless build (Scenario 4/5) and for these tests, their **lifecycle + compile** halves
  must live in `todl` (Option A: todl is the full engine); the UI halves (scaffold dialogs,
  presentation) stay in plexus. The engine tests use the real headless factories against the
  fixtures below.

## Fixtures — checked-in test projects (one per type)

Real, minimal, valid projects of each type — the ground truth the factories open/compile:

```
src/solution/engine/tests/fixtures/
  meta-model-project/       # manifest + core.todl (a tiny meta-model)
  library-project/          # manifest + a term/library .todl
  architecture-project/     # manifest + a model .todl (+ .diagram if relevant)
```

Kept small and stable; each is a real project the corresponding factory can `openProject` +
compile. A test stages a *copy* of the fixture into a temp working dir (never mutates the
checked-in original).

## Temp lifecycle

```ts
import { test, beforeEach, afterEach } from 'node:test'
import { mkdtemp, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let work: string          // temp solution root
let registryDir: string   // temp local package registry

beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), 'todl-sln-'))
    registryDir = await mkdtemp(join(tmpdir(), 'todl-reg-'))
})
afterEach(async () => {
    await rm(work, { recursive: true, force: true })
    await rm(registryDir, { recursive: true, force: true })
})
```

## Harness — `src/solution/engine/tests/harness.ts` (helper, not a `.test.ts`)

```ts
import { cp } from 'node:fs/promises'
import { join } from 'node:path'
import { ServiceProvider, NodeFsStorage, type IStorage,
         ConfirmAsk, type Ask, type IPromptService } from '@pragmatic-tech-ai/todl-runtime'  // NodeFsStorage = prereq
import { SolutionManagerService } from '../solution-manager-service.js'
import { SolutionManifest } from '../solution-manifest.js'
import { type IStorageProviderRegistry, type IProjectFactoryRegistry } from '../host-services.js'
import { type IProjectFactory } from '../project-factory.js'
import { type INotificationService } from '../notification-service.js'
import { LocalPackageRegistry } from '../../packages/local-package-registry.js'  // real, temp-rooted
import { type PackageSource } from '../../domain/domain.js'
import { type Diagnostic } from '../../diagnostics/diagnostic.js'

// Real filesystem storage rooted at an absolute path. CreateStorage(loc) → fs-backed IStorage.
export class FsStorageRegistry implements IStorageProviderRegistry {
    public CreateStorage(location: string): IStorage { return new NodeFsStorage(location) }
    public at(location: string): IStorage { return this.CreateStorage(location) }
}

// The REAL factories (headless halves), registered by type. No mock factory — the point is
// to test the real create/open/save/compile against the fixtures.
export class FactoryRegistry implements IProjectFactoryRegistry {
    private readonly byType = new Map<string, IProjectFactory>()
    public set(type: string, factory: IProjectFactory): this { this.byType.set(type, factory); return this }
    public factoryFor(typeId: string): IProjectFactory | undefined { return this.byType.get(typeId) }
}

export class RecordingNotifications implements INotificationService {
    public readonly statuses: string[] = []
    public readonly reports: Array<{ owner: string; diagnostics: readonly Diagnostic[] }> = []
    public Status(m: string): void { this.statuses.push(m) }
    public Progress(): void {}
    public Report(o: string, d: readonly Diagnostic[]): void { this.reports.push({ owner: o, diagnostics: d }) }
}

export class ScriptedPrompts implements IPromptService {
    constructor(private readonly a: { confirm?: boolean; folder?: string } = {}) {}
    public async Ask<R>(req: Ask<R>): Promise<R> {
        return (req instanceof ConfirmAsk ? (this.a.confirm ?? true) : this.a.folder) as R
    }
    public Confirm(): Promise<boolean> { return this.Ask(new ConfirmAsk('', '')) }
    public PickFolder(): Promise<string | undefined> { return Promise.resolve(this.a.folder) }
    public PickFile(): Promise<string | undefined> { return Promise.resolve(undefined) }
    public PromptText(): Promise<string | undefined> { return Promise.resolve(undefined) }
    public Choose<T>(): Promise<T | undefined> { return Promise.resolve(undefined) }
}

export interface Harness {
    manager: SolutionManagerService
    storages: FsStorageRegistry
    factories: FactoryRegistry
    registry: LocalPackageRegistry          // local package registry in a temp dir
    notifications: RecordingNotifications
    provider: ServiceProvider
}

// registryDir + the real factories come from the test (fixtures + temp lifecycle above).
export function makeManager(setup: {
    factories: FactoryRegistry
    registryDir: string
    prompts?: IPromptService
}): Harness {
    const provider = new ServiceProvider()
    const storages = new FsStorageRegistry()
    const registry = new LocalPackageRegistry(setup.registryDir)      // real, temp-rooted
    const notifications = new RecordingNotifications()
    provider.registerInstance(SolutionManagerService.StorageRegistryKey, storages)
    provider.registerInstance(SolutionManagerService.ProjectFactoryRegistryKey, setup.factories)
    provider.registerInstance(SolutionManagerService.PromptServiceKey, setup.prompts ?? new ScriptedPrompts())
    provider.registerInstance(SolutionManagerService.PackageSourceKey, registry.AsPackageSource())
    provider.registerInstance(SolutionManagerService.NotificationServiceKey, notifications)
    return { manager: new SolutionManagerService(provider), storages, factories: setup.factories, registry, notifications, provider }
}

// seedSolution USES THE FACTORY to materialise member projects into the temp solution:
// either scaffold a fresh one (factory.createProject) or stage a checked-in fixture copy,
// then write solution.json. Real files, real factory — nothing hand-written.
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname

export async function seedSolution(h: Harness, root: string, members: Array<{
    type: string; name: string; path: string
    from?: 'factory' | 'fixture'          // default 'factory'
    fixture?: string                       // fixture dir name when from === 'fixture'
}>): Promise<void> {
    for (const m of members) {
        const dir = join(root, m.path)
        if ((m.from ?? 'factory') === 'fixture')
            await cp(join(FIXTURES, m.fixture ?? `${m.type}-project`), dir, { recursive: true })
        else
            await h.factories.factoryFor(m.type)!.createProject(h.storages.at(dir), m.name)   // REAL create
    }
    await h.storages.at(root).WriteText('solution.json',
        new SolutionManifest('S', members.map((m) => ({ path: m.path, type: m.type })), {}).stringify())
}
```

## Later-phase test seams

- **Content store (E2)** runs over the same `NodeFsStorage`; external-change tests either
  write directly to the temp dir behind the store and let its watcher fire, or inject a fake
  watcher and poke it — real files either way.
- **Local registry (E3/E4/E5)** is real: compile fixture projects, `publish` them into
  `registryDir`, and let `Domain` load from it. Recompile-count for the incremental guarantee
  comes from the real compiler (instrument it) or a spy wrapper around the factory's compile.

## Example tests (per scenario)

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeManager, seedSolution, FactoryRegistry } from './harness.js'
import { MetaModelFactory, LibraryFactory, ArchitectureFactory } from '../../projects/factories/index.js'  // headless factories (prereq)
import { MemberStatus } from '../solution-member.js'  // enum added in E1

function factories(): FactoryRegistry {
    return new FactoryRegistry()
        .set('meta-model', new MetaModelFactory())
        .set('library', new LibraryFactory())
        .set('architecture', new ArchitectureFactory())
}

// Scenario 2 — open the three real fixture projects
test('open: all three fixture project types resolve', async () => {
    const h = makeManager({ factories: factories(), registryDir })
    await seedSolution(h, work, [
        { type: 'meta-model', name: 'M', path: 'meta',    from: 'fixture' },
        { type: 'library',    name: 'L', path: 'lib',     from: 'fixture' },
        { type: 'architecture', name: 'A', path: 'arch',  from: 'fixture' },
    ])
    await h.manager.OpenSolution(work)
    assert.equal(h.manager.ActiveSolution!.Members.ToArray().every((m) => m.IsResolved), true)
})

// Scenario 2 — resilient open (TDD bug #1): a fixture with a corrupt manifest → LoadFailed,
// siblings still resolve, no reject.  (Corrupt one member's project.json before open.)

// Scenario 1 — new → AddProject (real createProject) → save → reopen round-trips on disk.

// Scenario 4 — build: compile the fixtures, publish into the temp registry, compose a Domain;
// assert Domain contents + deps-first order.

// Scenario 5 — edit a fixture file on disk → adjust → only that member + dependents recompile.
```

## Test-first mapping to phases

| Phase | Tests written first |
|---|---|
| E0 | harness compiles; **`NodeFsStorage`** lands; existing tests green after DI reroute |
| E1 | resilient open (#1) via corrupt fixture, unknown-type, missing solution.json (#6), settings-bind, SaveAs (#2) on real FS, dispose-on-close (#5) |
| E2 | NewSolution persist, AddProject via real `createProject` (#4), content store CRUD + deltas on real FS, member save (#3) |
| E3 | build → compile fixtures → publish to temp registry → compose deps-first; compile-failure diagnostic |
| E4 | references add/remove/list/resolve (local sibling + package from temp registry); missing-ref diagnostic |
| E5 | edit fixture on disk → incremental recompile of changed + dependents; Domain invalidation |
```
