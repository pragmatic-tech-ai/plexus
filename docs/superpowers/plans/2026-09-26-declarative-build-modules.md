# Declarative build modules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give build systems, generators, and project factories a single token-based, DI-driven declarative organization reusable across every host and TODL's headless path, and make the npm-package build system self-contained (default baker in TODL; bundle + publish as build actions; registry sourced from the solution manager).

**Architecture:** Three token-based `*Definition` records feed three DI-singleton registries that resolve their `ServiceToken`s lazily. A single `ProjectSystemComposer` seeds those registries with TODL's built-ins, registers the built-in services + a default presentation baker, and wires the `ProjectEvents`/`GeneratorScheduler`; it is exposed as both a mural `IModule` and a headless `IContributionSource`. The concrete presentation baker moves into TODL. Publishing becomes two pipeline actions (`EmitBundleAction`, `PublishPackageAction`) with the `IPackageRegistry` reached through `TodlBuildContext.PublishRegistry`, sourced from `SolutionManagerService.PublishRegistry`.

**Tech Stack:** TypeScript (ESM, strict), `@pragmatic-tech-ai/todl-runtime` DI (`ServiceKey`/`ServiceToken`/`IServiceContainer`/`CompositionRoot`/`IModule`), `@pragmatic-tech-ai/mural` compiler, node:test + vitest.

**Spec:** https://github.com/pragmatic-tech-ai/todl/issues/1

## Global Constraints

- OOP only: no free functions or module-level mutable state; behavior lives on classes (static or instance methods). Module-level `const` for true constants/enums/tokens is fine.
- Allman braces everywhere (opening brace on its own line) for classes/interfaces/methods/control-flow; object literals and arrow bodies stay inline.
- No inline string literals: hoist labels/messages/keys/filenames to `private static readonly` PascalCase constants.
- Interfaces and new public methods are PascalCase. **Existing** camelCase members of `IProjectFactory` (`typeId`, `title`, `createProject`, `openProject`, `saveProject`, `formats`, `requiresMetaModel`, `offersLibraries`) stay as-is — wholesale re-casing of that interface is out of scope; match the existing casing when touching it, use PascalCase for anything new.
- View models extend `Observable`, never `MuralBase`.
- Enums, never string-literal unions, for any fixed value set.
- Every test file lives in a `tests/` subfolder next to its source.
- TODL must not depend on any host application; depending on `@pragmatic-tech-ai/mural` is allowed.
- `bundle.json`'s `type` discriminator stays exactly `'meta-model'` / `'library'` — Plexus consumers key on it.
- Commit attribution: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- dev-kit is public and secret-free (docs only).

## Review Focus

- **Publish flavor with no registry:** a publish build whose `PublishRegistry` is `undefined` must fail fast with a clear "no registry associated with this solution" diagnostic and write nothing — pinned in Task 9.
- **Missing icon still blocks:** a project declaring resources whose referenced icon file is unreadable must report an error and stop before promotion/publish, exactly as today — pinned in Task 4 (baker move) and re-asserted in Task 9.
- **Duplicate registration is safe:** composing two modules that register the same build-system id / project-type / generator id must not crash composition — `Register` idempotency pinned in Tasks 1–3.
- **Non-producer publish:** running `EmitBundleAction` for an architecture project (no producer classes/resource folders) must no-op cleanly, not throw — pinned in Task 8.
- **Package flavor never touches the registry:** a plain (non-publish) build must never read `PublishRegistry` even when one is set — pinned in Task 9.

---

## File Structure

New (TODL):
- `src/solution-services/project-services/core/project-factory-definition.ts` — `ProjectFactoryDefinition`.
- `src/solution-services/todl-build-system/build-system-definition.ts` — `BuildSystemDefinition`.
- `src/solution-services/project-services/generators/generator-definition.ts` — `GeneratorDefinition`.
- `src/solution-services/project-services/composition/project-system-composer.ts` — `ProjectSystemComposer`.
- `src/solution-services/project-services/composition/todl-project-system-module.ts` — `TodlProjectSystemModule` (IModule).
- `src/solution-services/project-services/composition/project-system-contribution.ts` — headless `IContributionSource`.
- `src/solution-services/project-services/core/default-presentation-baker.ts` — moved concrete baker.
- `src/solution-services/project-services/core/presentation-bake.ts` — moved publisher logic (from Plexus).
- `src/solution-services/todl-build-system/npm/emit-bundle-action.ts` — `EmitBundleAction`.
- `src/solution-services/todl-build-system/npm/publish-package-action.ts` — `PublishPackageAction`.

Modified (TODL):
- `.../generators/project-generator-registry.ts` (accept standalone defs, DI key already exists).
- `.../solution-manager/engine/project-factory-registry.ts` (token-based, mutable, DI).
- `.../todl-build-system/todl-build-system-registry.ts` (definition-populated).
- `.../todl-build-system/npm/npm-package-build-system.ts` (resolve default baker; publish flavor).
- `.../todl-build-system/npm/bake-resources-action.ts` (gate → resources-only).
- `.../todl-build-system/todl-build-context.ts` (`PublishRegistry`).
- `.../todl-build-system/todl-project-build-manager.ts` (thread `PublishRegistry`).
- `.../solution-manager/engine/solution-manager-service.ts` (`PublishRegistry`).
- `.../package-manager/package-registry-client.ts` (IStorage pack helper).
- `.../project-services/core/producer-project-factory-base.ts` (remove `publish()`).

Plexus (deletions + wiring), covered in Tasks 12–15.

---

## TODL workstream

### Task 1: ProjectFactoryDefinition + token-based ProjectFactoryRegistry

**Files:**
- Create: `src/solution-services/project-services/core/project-factory-definition.ts`
- Modify: `src/solution-services/solution-manager/engine/project-factory-registry.ts`
- Test: `src/solution-services/solution-manager/engine/tests/project-factory-registry.test.ts`

**Interfaces:**
- Consumes: `IProjectFactory` (`./project-factory.js`), `ServiceToken`/`IServiceProvider` (`@pragmatic-tech-ai/todl-runtime`), `IProjectFactoryRegistry` (`./host-services.js`).
- Produces: `ProjectFactoryDefinition { TypeId: string; Factory: ServiceToken<IProjectFactory> }`; `ProjectFactoryRegistry` gaining `constructor(provider: IServiceProvider)`, `Register(def: ProjectFactoryDefinition): void`, resolving lazily in `factoryFor`/`All`.

- [ ] **Step 1: Write the definition.**

```ts
// project-factory-definition.ts
import { type ServiceToken } from '@pragmatic-tech-ai/todl-runtime'
import { type IProjectFactory } from './project-factory.js'

// Declares "project type <TypeId> is served by the factory bound to <Factory>".
// Factory is a ServiceToken so registration never forces construction — the
// registry resolves it on first lookup.
export interface ProjectFactoryDefinition
{
    readonly TypeId: string
    readonly Factory: ServiceToken<IProjectFactory>
}
```

- [ ] **Step 2: Write the failing test.**

```ts
// tests/project-factory-registry.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectFactoryRegistry } from '../project-factory-registry.js'

class FakeFactory
{
    public readonly typeId: string
    public readonly title = 't'
    public readonly description = 'd'
    public readonly formats = []
    constructor(typeId: string) { this.typeId = typeId }
    createProject(): never { throw new Error('unused') }
    openProject(): never { throw new Error('unused') }
    saveProject(): never { throw new Error('unused') }
}

test('resolves a registered factory lazily by type id', () =>
{
    const provider = new ServiceProvider()
    let built = 0
    const token = { description: 'meta' } as never
    provider.register(token, () => { built++; return new FakeFactory('meta') as never })
    const registry = new ProjectFactoryRegistry(provider)
    registry.Register({ TypeId: 'meta', Factory: token })
    assert.equal(built, 0)                       // not constructed at Register
    assert.equal(registry.factoryFor('meta')!.typeId, 'meta')
    assert.equal(built, 1)                       // constructed on first lookup
})

test('duplicate type id is ignored (first wins), no throw', () =>
{
    const provider = new ServiceProvider()
    const a = { description: 'a' } as never
    const b = { description: 'b' } as never
    provider.register(a, () => new FakeFactory('meta') as never)
    provider.register(b, () => new FakeFactory('meta') as never)
    const registry = new ProjectFactoryRegistry(provider)
    registry.Register({ TypeId: 'meta', Factory: a })
    registry.Register({ TypeId: 'meta', Factory: b })
    assert.equal(registry.All().length, 1)
})
```

- [ ] **Step 3: Run it, verify it fails** (`ProjectFactoryRegistry` ctor still takes factories).

- [ ] **Step 4: Rewrite the registry token-based.**

```ts
// project-factory-registry.ts
import { type IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { type IProjectFactory } from './project-factory.js'
import { type IProjectFactoryRegistry } from './host-services.js'
import { type ProjectFactoryDefinition } from '../../project-services/core/project-factory-definition.js'

// The one project-factory registry: DI-resolved, definition-populated. Holds
// ProjectFactoryDefinitions and resolves each Factory token on demand (cached),
// so registration never forces construction. Indexed by TypeId; first definition
// to claim a type id wins (a later duplicate is ignored).
export class ProjectFactoryRegistry implements IProjectFactoryRegistry
{
    private readonly defs = new Map<string, ProjectFactoryDefinition>()
    private readonly cache = new Map<string, IProjectFactory>()

    constructor(private readonly provider: IServiceProvider)
    {
    }

    public Register(def: ProjectFactoryDefinition): void
    {
        if (this.defs.has(def.TypeId)) return
        this.defs.set(def.TypeId, def)
    }

    public factoryFor(typeId: string): IProjectFactory | undefined
    {
        const def = this.defs.get(typeId)
        if (def === undefined) return undefined
        return this.resolve(typeId, def)
    }

    public All(): readonly IProjectFactory[]
    {
        return [...this.defs.entries()].map(([id, def]) => this.resolve(id, def))
    }

    private resolve(typeId: string, def: ProjectFactoryDefinition): IProjectFactory
    {
        let f = this.cache.get(typeId)
        if (f === undefined)
        {
            f = this.provider.getRequired(def.Factory)
            this.cache.set(typeId, f)
        }
        return f
    }
}
```

- [ ] **Step 5: Update the `ProjectFactoryRegistryKey`.** If `host-services.ts` exports a `ServiceKey<IProjectFactoryRegistry>`, keep it. Grep for old `new ProjectFactoryRegistry(` call sites in TODL and update to the provider ctor + `Register` calls; the composer (Task 6) is the primary constructor. Leave Plexus call sites for Task 12.

- [ ] **Step 6: Run tests, verify pass. Commit.**

```bash
git add -A && git commit -m "feat(todl): token-based ProjectFactoryRegistry + ProjectFactoryDefinition"
```

### Task 2: BuildSystemDefinition + definition-populated build-system registry

**Files:**
- Create: `src/solution-services/todl-build-system/build-system-definition.ts`
- Modify: `src/solution-services/build-system-core/build-system-registry.ts` (add `RegisterDefinition`), `src/solution-services/todl-build-system/todl-build-system-registry.ts`
- Test: `src/solution-services/todl-build-system/tests/build-system-registry-defs.test.ts`

**Interfaces:**
- Consumes: `IBuildSystem`, `ServiceToken`/`IServiceProvider`, `TodlBuildContext`, `ProjectManifest`.
- Produces: `BuildSystemDefinition { Id: string; System: ServiceToken<IBuildSystem<TodlBuildContext, ProjectManifest>> }`; `BuildSystemRegistry.RegisterDefinition(provider, def)` resolving the token and delegating to the existing `Register(system)` (keeps consume-before-produce validation).

- [ ] **Step 1: Write the definition.**

```ts
// build-system-definition.ts
import { type ServiceToken } from '@pragmatic-tech-ai/todl-runtime'
import { type IBuildSystem } from '../build-system-core/build-system.js'
import { type TodlBuildContext } from './todl-build-context.js'
import { type ProjectManifest } from '../package-manager/manifest.js'

export interface BuildSystemDefinition
{
    readonly Id: string
    readonly System: ServiceToken<IBuildSystem<TodlBuildContext, ProjectManifest>>
}
```

- [ ] **Step 2: Add `RegisterDefinition` to `BuildSystemRegistry`** (generic base). It resolves the token via the provided provider and calls the existing `Register`, so validation + duplicate-id checks are unchanged. Because the base is generic and todl-agnostic, take a resolved system OR a `(provider, token)` — keep it generic:

```ts
// build-system-registry.ts — add method
public RegisterResolved(system: IBuildSystem<C, TProject>): void
{
    if (this.systems.has(system.Id)) return   // idempotent for composition
    BuildSystemRegistry.Validate(system)
    this.systems.set(system.Id, system)
}
```

Note: keep the existing `Register` (throws on duplicate) for existing callers; `RegisterResolved` is the idempotent composition path. The todl definition seeding (Task 6) resolves `def.System` from the provider and calls `RegisterResolved`.

- [ ] **Step 3: Write failing test** asserting `RegisterResolved` is idempotent (same id twice → one system, no throw) and preserves `Get`/`For`.

- [ ] **Step 4: Implement, run, verify pass.**

- [ ] **Step 5:** Leave `TodlBuildSystemRegistry` in place for now (Task 6 replaces its role); do not delete yet. Commit.

### Task 3: GeneratorDefinition + standalone generators in ProjectGeneratorRegistry

**Files:**
- Create: `src/solution-services/project-services/generators/generator-definition.ts`
- Modify: `src/solution-services/project-services/generators/project-generator-registry.ts`
- Test: `.../generators/tests/project-generator-registry.test.ts`

**Interfaces:**
- Produces: `GeneratorDefinition { ProjectType: string; Generator: ServiceToken<IProjectContentGenerator> }`; `ProjectGeneratorRegistry.RegisterDefinition(provider, def)` deduped by generator id against factory-sourced ones; `Register(projectType, generator)` stays for factory-sourced.

- [ ] **Step 1: Definition.**

```ts
// generator-definition.ts
import { type ServiceToken } from '@pragmatic-tech-ai/todl-runtime'
import { type IProjectContentGenerator } from './project-content-generator.js'

export interface GeneratorDefinition
{
    readonly ProjectType: string
    readonly Generator: ServiceToken<IProjectContentGenerator>
}
```

- [ ] **Step 2: Extend the registry.** Make `Register` idempotent-by-id (return instead of throw when the id is already present) and add a definition path:

```ts
// project-generator-registry.ts — replace Register body + add RegisterDefinition
import { type IServiceProvider, ServiceKey } from '@pragmatic-tech-ai/todl-runtime'
import { type GeneratorDefinition } from './generator-definition.js'

public Register(projectType: string, generator: IProjectContentGenerator): void
{
    if (this.byId.has(generator.Id)) return    // deduped: factory-sourced + standalone
    const list = this.byType.get(projectType) ?? []
    list.push(generator)
    this.byType.set(projectType, list)
    this.byId.set(generator.Id, generator)
}

public RegisterDefinition(provider: IServiceProvider, def: GeneratorDefinition): void
{
    this.Register(def.ProjectType, provider.getRequired(def.Generator))
}
```

- [ ] **Step 3: Write failing test** — a factory-sourced generator and a `GeneratorDefinition` with the same `Id` register once (no double-run); distinct ids both land under `For(type)`.

- [ ] **Step 4: Implement, run, verify pass. Commit.**

### Task 4: Move the presentation baker into TODL (+ dedup)

**Files:**
- Create: `src/solution-services/project-services/core/presentation-bake.ts` (moved publisher logic), `.../core/default-presentation-baker.ts`
- Modify: reuse `PresentationResourceEmitter` (`.../core/presentation-model.ts`)
- Delete (Plexus, in Task 13): `mural-presentation-baker.ts`, `presentation-publisher.ts`, `library-presentation-publisher.ts`, `presentation-generator.ts`
- Test: `.../core/tests/default-presentation-baker.test.ts`

**Interfaces:**
- Consumes: `IPresentationBaker`/`BakeOptions`/`BakeResult`/`PresentationBakerKey` (`./presentation-baker.js`), `PresentationResourceEmitter` (`./presentation-model.js`), `@pragmatic-tech-ai/mural/compiler` (`compile`, `DEFAULT_SYMBOLS`, `svgToGeometryJs`, `IncludeResolver`), `IStorage`, `TodlDocument`.
- Produces: `DefaultPresentationBaker implements IPresentationBaker`.

- [ ] **Step 1:** Move `presentation-publisher.ts` + `library-presentation-publisher.ts` content from Plexus into TODL `presentation-bake.ts`, rewriting imports to relative TODL paths (`@pragmatic-tech-ai/todl` → local `../../../publish/…`, `@pragmatic-tech-ai/todl-runtime` unchanged, `@pragmatic-tech-ai/mural/compiler` unchanged). Convert every free `function` into a `static` method on a `PresentationBake` class (house style: no module-level functions), hoisting the inline literals (`PRESENTATION_DIR`, `COMPILED_FILE`, dict names, `RASTER_MIME`, module names) to `private static readonly`.

- [ ] **Step 2: Dedup.** Replace the moved `distinctIcons` / `assignResourceKeys` / `stampResourceKeys` with calls to `PresentationResourceEmitter.DistinctIcons` / `.StampResourceKeys` (two-arg: own document + closure). Keep `readIcons` / `iconIncludeResolver` / `combinedSource` / `buildIconIndex` (icon-index) as static methods on `PresentationBake`. Confirm the `PresentationResourceEmitter` API matches (it already exposes `DistinctIcons(document, closure)`; if the key-assignment map is needed for `combinedSource`, add a `PresentationResourceEmitter.ResourceKeys(document, closure): Map<string,string>` static that returns the assigned keys, and use it in both `combinedSource` and `buildIconIndex`).

- [ ] **Step 3: Write `DefaultPresentationBaker`.**

```ts
// default-presentation-baker.ts
import { type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { type TodlDocument } from '../../../compiler-services/emit/json.js'
import { type IPresentationBaker, type BakeOptions, type BakeResult } from './presentation-baker.js'
import { PresentationBake } from './presentation-bake.js'

// The single default presentation baker for every TODL project type. Generic over
// BakeOptions (dictName + iconPrefix), which the producer factory / bake action
// supplies per project type. Reads icons out of `project`, compiles them via the
// mural include resolver, and writes presentation.compiled.json + icon-index.json
// into `dest` under `<base>/presentation/`. A referenced icon with no readable file
// blocks the bake (nothing written).
export class DefaultPresentationBaker implements IPresentationBaker
{
    public Bake(project: IStorage, dest: IStorage, base: string, doc: TodlDocument, options: BakeOptions): Promise<BakeResult>
    {
        return PresentationBake.Publish(project, dest, base, doc, options)
    }
}
```

`PresentationBake.Publish` folds the two former publishers into one, selecting keyspace/dict from `options` (no meta-model/library branching in a dispatcher — the options carry the difference).

- [ ] **Step 4: Port the tests** from Plexus's publisher tests into `tests/default-presentation-baker.test.ts`: both dict variants bake `presentation.compiled.json` + `icon-index.json` with the right keys; **a referenced-but-unreadable icon returns `{ ok: false, missing }` and writes nothing** (Review Focus: missing icon blocks). Use an in-memory `IStorage` fake.

- [ ] **Step 5: Run, verify pass. Commit.**

### Task 5: NpmPackageBuildSystem resolves the default baker; bake gate → resources-only

**Files:**
- Modify: `src/solution-services/todl-build-system/npm/npm-package-build-system.ts`, `.../npm/bake-resources-action.ts`
- Test: `.../npm/tests/bake-resources-action.test.ts` (update)

**Interfaces:**
- Produces: `NpmPackageBuildSystem` constructor `(baker: IPresentationBaker)` (required, no longer optional); `BakeResourcesAction` constructor `(baker: IPresentationBaker)` and the `if (this.baker === undefined) return;` skip removed.

- [ ] **Step 1:** In `bake-resources-action.ts`, change the ctor to take a required `IPresentationBaker` and delete the `if (this.baker === undefined) return;` line (line 50). The gate is now: no model → return; `!DeclaresResources` → return; `OptionsFor(type) === undefined` → return; else bake. Update the class header comment to say the baker is always supplied (the TODL default), the bake skips only when no resources are declared or the type has no options.

- [ ] **Step 2:** In `npm-package-build-system.ts`, change the ctor to `constructor(baker: IPresentationBaker)` and pass `baker` into `new BakeResourcesAction(baker)`. (The publish flavor is added in Task 9; keep the single flavor here for now.)

- [ ] **Step 3:** Update `bake-resources-action.test.ts`: construct with a fake baker; assert bake runs when resources are declared and skips (no write, no error) when none are; assert missing-icon → error diagnostic.

- [ ] **Step 4: Run, verify pass. Commit.**

### Task 6: ProjectSystemComposer

**Files:**
- Create: `src/solution-services/project-services/composition/project-system-composer.ts`
- Test: `.../composition/tests/project-system-composer.test.ts`

**Interfaces:**
- Consumes: `IServiceContainer`/`IServiceProvider`/`ServiceProvider` (todl-runtime); the three registries + their keys; the three `*Definition` types; `DefaultPresentationBaker` + `PresentationBakerKey`; the built-in factories (`MetaModelProjectFactory`, `LibraryProjectFactory`, `ArchitectureProjectFactory`), build systems (`NpmPackageBuildSystem`, `HtmlBundleBuildSystem`), generators (`DtoGenerator`, `UiPlaceholderGenerator`); `ProjectEvents`/`ProjectEventsKey`/`GeneratorScheduler`/`ProjectModelProvider`; `BuildSystemRegistryKey` (create if none exists), `IPackageSource`.
- Produces: `ProjectSystemComposer` with `static Compose(container: IServiceContainer, options?: { Source?: IPackageSource }): void`.

- [ ] **Step 1:** Confirm the built-in service tokens. Grep for the concrete factory/build-system/generator class names and their constructors, and for existing `ServiceKey`s (`ProjectGeneratorRegistryKey`, `ProjectEventsKey`, `PresentationBakerKey`, `PackageStoreKey`). Create `BuildSystemRegistryKey` and `ProjectFactoryRegistryKey` (if not already exported) as `new ServiceKey<…>('BuildSystemRegistry')` / `('ProjectFactoryRegistry')`.

- [ ] **Step 2: Write the composer.**

```ts
// project-system-composer.ts
import { type IServiceContainer, ServiceProvider } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectFactoryRegistry } from '../../solution-manager/engine/project-factory-registry.js'
import { ProjectFactoryRegistryKey } from '../../solution-manager/engine/host-services.js'
import { TodlBuildSystemRegistry } from '../../todl-build-system/todl-build-system-registry.js' // or a bare BuildSystemRegistry
import { BuildSystemRegistryKey } from '../../todl-build-system/build-system-registry-key.js'
import { ProjectGeneratorRegistry, ProjectGeneratorRegistryKey } from '../generators/project-generator-registry.js'
import { ProjectEvents, ProjectEventsKey, type ProjectEvent } from '../generators/project-events.js'
import { GeneratorScheduler } from '../generators/generator-scheduler.js'
import { ProjectModelProvider } from '../generators/project-model-provider.js'
import { type GeneratorContext, GeneratorTrigger } from '../generators/project-content-generator.js'
import { DiagnosticSink } from '../../build-system-core/diagnostic-sink.js'
import { DefaultPresentationBaker } from '../core/default-presentation-baker.js'
import { PresentationBakerKey } from '../core/presentation-baker.js'
import { type IPackageSource, type SourcedPackage } from '../../todl-build-system/package-source.js'
import { type PackageRef } from '../../../publish/publish.js'
// built-ins:
import { MetaModelProjectFactory } from '../../project-services/meta-model-project/meta-model-project-factory.js'
import { LibraryProjectFactory } from '../../project-services/library-project/library-project-factory.js'
import { ArchitectureProjectFactory } from '../../project-services/architecture-project/architecture-project-factory.js'
import { NpmPackageBuildSystem } from '../../todl-build-system/npm/npm-package-build-system.js'
import { HtmlBundleBuildSystem } from '../../todl-build-system/html-bundle/html-bundle-build-system.js'
import { DtoGenerator } from '../generators/dto-generator.js'
import { UiPlaceholderGenerator } from '../generators/ui-placeholder-generator.js'

// Seeds the three DI-singleton registries with TODL's built-in definitions,
// registers the built-in services + the default presentation baker, and wires the
// ProjectEvents bus + GeneratorScheduler. One method, self-contained (no
// cross-module ordering). Reused by the mural IModule and the headless contribution.
export class ProjectSystemComposer
{
    private static readonly MetaModel = 'meta-model'
    private static readonly Library = 'library'
    private static readonly Architecture = 'architecture'

    public static Compose(container: IServiceContainer, options: { Source?: IPackageSource } = {}): void
    {
        const provider = container as unknown as ServiceProvider

        // 1. Built-in services (resolved lazily via their class tokens).
        container.registerInstance(PresentationBakerKey, new DefaultPresentationBaker())
        container.register(MetaModelProjectFactory, (p) => new MetaModelProjectFactory(/* deps from p */))
        container.register(LibraryProjectFactory, (p) => new LibraryProjectFactory(/* deps */))
        container.register(ArchitectureProjectFactory, (p) => new ArchitectureProjectFactory(/* deps */))
        container.register(NpmPackageBuildSystem, (p) => new NpmPackageBuildSystem(p.getRequired(PresentationBakerKey)))
        container.register(HtmlBundleBuildSystem, () => new HtmlBundleBuildSystem())
        container.register(DtoGenerator, () => new DtoGenerator())
        container.register(UiPlaceholderGenerator, () => new UiPlaceholderGenerator())

        // 2. Registries as singletons.
        const factories = new ProjectFactoryRegistry(provider)
        const buildSystems = new TodlBuildSystemRegistry(/* empty ctor variant — see step 3 */)
        const generators = new ProjectGeneratorRegistry()
        container.registerInstance(ProjectFactoryRegistryKey, factories)
        container.registerInstance(BuildSystemRegistryKey, buildSystems)
        container.registerInstance(ProjectGeneratorRegistryKey, generators)

        // 3. Seed built-in definitions.
        factories.Register({ TypeId: ProjectSystemComposer.MetaModel, Factory: MetaModelProjectFactory })
        factories.Register({ TypeId: ProjectSystemComposer.Library, Factory: LibraryProjectFactory })
        factories.Register({ TypeId: ProjectSystemComposer.Architecture, Factory: ArchitectureProjectFactory })
        buildSystems.RegisterResolved(provider.getRequired(NpmPackageBuildSystem))
        buildSystems.RegisterResolved(provider.getRequired(HtmlBundleBuildSystem))
        generators.RegisterDefinition(provider, { ProjectType: ProjectSystemComposer.Architecture, Generator: DtoGenerator })
        generators.RegisterDefinition(provider, { ProjectType: ProjectSystemComposer.Architecture, Generator: UiPlaceholderGenerator })
        // plus factory-sourced generators (IGeneratingProjectFactory.Generators()) for each factory type.

        // 4. Lifecycle wiring.
        const events = new ProjectEvents()
        const scheduler = new GeneratorScheduler(
            generators,
            (event, reason) => ProjectSystemComposer.BuildContext(event, reason, options.Source),
        )
        events.Subscribe((event) => scheduler.Handle(event))
        container.registerInstance(ProjectEventsKey, events)
    }

    private static BuildContext(event: ProjectEvent, reason: GeneratorTrigger, source?: IPackageSource): GeneratorContext
    {
        const effective = source ?? new EmptyPackageSource()
        return {
            Project: event.Project,
            Manifest: event.Manifest,
            Model: new ProjectModelProvider(event.Project, event.Manifest, effective),
            Diagnostics: new DiagnosticSink(),
            Reason: reason,
        }
    }
}

class EmptyPackageSource implements IPackageSource
{
    public TryGet(_ref: PackageRef): Promise<SourcedPackage | undefined>
    {
        return Promise.resolve(undefined)
    }
}
```

> Implementer note: the exact constructor dependencies for the three factories and the two generators must be read from their current sources; wire each from `p` (the provider) or the existing seams (`PackageStoreKey`, `PresentationBakerKey`). This reuses the seams `GeneratorRegistryContribution` and `ProducerProjectFactory` already resolve; do not invent new ones.

- [ ] **Step 3: Add an empty-ctor path for the build-system registry.** Either give `TodlBuildSystemRegistry` a no-arg ctor that no longer self-registers (composition seeds it), or use the bare generic `BuildSystemRegistry` directly and drop `TodlBuildSystemRegistry`. Prefer using the bare `BuildSystemRegistry<TodlBuildContext, ProjectManifest>` and deleting `TodlBuildSystemRegistry` (its self-registration + baker comment are exactly what the composer replaces). Add `BuildSystemRegistryKey` in a new `build-system-registry-key.ts`.

- [ ] **Step 4: Write the composer test.** Compose a fresh `ServiceProvider`; assert `factoryFor('meta-model'|'library'|'architecture')` resolves; `BuildSystemRegistry.Get('npm-package'|'html-bundle')` resolves; `ProjectGeneratorRegistry.For('architecture')` includes both generators once; resolving `PresentationBakerKey` yields a `DefaultPresentationBaker`; raising a `Created` event on `ProjectEventsKey` runs the scheduler (spy a generator).

- [ ] **Step 5: Run, verify pass. Commit.**

### Task 7: TodlProjectSystemModule (IModule) + headless contribution

**Files:**
- Create: `.../composition/todl-project-system-module.ts`, `.../composition/project-system-contribution.ts`
- Test: `.../composition/tests/todl-project-system-module.test.ts`

**Interfaces:**
- Produces: `TodlProjectSystemModule implements IModule` (`Targets`, `RegisterServices`); `ProjectSystemContribution implements IContributionSource` (`Contribute`).

- [ ] **Step 1: The module.**

```ts
// todl-project-system-module.ts
import { type IModule, type IServiceContainer, HostKind } from '@pragmatic-tech-ai/todl-runtime'
import { ProjectSystemComposer } from './project-system-composer.js'

// TODL's project-system module: the head of a host's `.modules:` block. Delegates
// to ProjectSystemComposer, which seeds the registries + wires lifecycle. Targets
// every host kind (it registers no view). Hand-written (not a `.mu` `.services:`
// block) because seeding + event wiring are side effects `.services:` cannot express.
export class TodlProjectSystemModule implements IModule
{
    public readonly Targets: ReadonlySet<HostKind> = new Set<HostKind>()

    public RegisterServices(container: IServiceContainer): void
    {
        ProjectSystemComposer.Compose(container)
    }
}
```

> Confirm the `Targets` convention: an empty set may mean "no host" in `CompositionRoot.Admits`. Read `host-kind.js` + `CompositionRoot.Admits`; if a module must name host kinds to be admitted, expose the known `HostKind`s and include them (or a wildcard). Match how existing modules declare `Targets`.

- [ ] **Step 2: The headless contribution.**

```ts
// project-system-contribution.ts
import { type CompositionRoot } from '@pragmatic-tech-ai/todl-runtime'
import { type IContributionSource } from '../../../application/contribution-source.js'
import { ProjectSystemComposer } from './project-system-composer.js'
import { type IPackageSource } from '../../todl-build-system/package-source.js'

// The headless entry point (CLI, devUI main, smoke): seeds the identical registries
// with no mural app.Modules. Supersedes GeneratorRegistryContribution.
export class ProjectSystemContribution implements IContributionSource
{
    constructor(private readonly source?: IPackageSource)
    {
    }

    public Contribute(root: CompositionRoot): void
    {
        ProjectSystemComposer.Compose(root.Provider, { Source: this.source })
    }
}
```

- [ ] **Step 3:** Retire `GeneratorRegistryContribution` (`src/application/generator-registry-contribution.ts`) in favor of `ProjectSystemContribution`; update its consumers (grep `GeneratorRegistryContribution`). Keep `ProjectModelProvider`/`EmptySource` behavior (folded into the composer).

- [ ] **Step 4: Test** — `new TodlProjectSystemModule().RegisterServices(provider)` yields resolvable registries (reuse Task 6 assertions through the module surface); `ProjectSystemContribution.Contribute(new CompositionRoot())` does the same headlessly.

- [ ] **Step 5: Run, verify pass. Commit.**

### Task 8: EmitBundleAction

**Files:**
- Create: `.../todl-build-system/npm/emit-bundle-action.ts`
- Modify: `.../npm/npm-package-build-system.ts` (insert into pipeline after bake, before emit-layout)
- Test: `.../npm/tests/emit-bundle-action.test.ts`

**Interfaces:**
- Consumes: `NpmArtifacts.CompiledModel`, `PackageBundle`/`ProducerResources`/`PublishedClass` (`../../project-services/core/package-bundle.js`), `projectAnnotations` (`../../../publish/reflect.js`), `ProjectType`.
- Produces: `EmitBundleAction implements IBuildAction<TodlBuildContext>` writing `bundle.json` into `ctx.Sandbox`.

- [ ] **Step 1: Write the action**, porting the bundle-building block from the deprecated `publish()` (producer-project-factory-base.ts lines 142–159) — derive classes via `ProducerResources.DeriveClasses(pkg.document)`, `ProducerResources.Scan(ctx.Project, classIds)`, attach template/thumbnail/doc, assemble `PackageBundle` with `type` = the producer discriminator, and write `bundle.json` into `ctx.Sandbox`. **Non-producer types (architecture) no-op**: gate on `ctx.Manifest.type` being MetaModel or Library, else return without writing (Review Focus: non-producer publish).

```ts
// emit-bundle-action.ts (shape)
export class EmitBundleAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = 'emit-bundle'
    private static readonly BundleFileName = 'bundle.json'
    private static readonly MetaModelType = 'meta-model'
    private static readonly LibraryType = 'library'

    public readonly Name = EmitBundleAction.ActionName
    public readonly Consumes: readonly ArtifactKey<unknown>[] = [NpmArtifacts.CompiledModel]
    public readonly Produces: readonly ArtifactKey<unknown>[] = []

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const type = EmitBundleAction.DiscriminatorFor(ctx.Manifest.type)
        if (type === undefined) return                       // architecture etc. — no bundle
        const pkg = ctx.Artifacts.Get(NpmArtifacts.CompiledModel)
        if (pkg === undefined) return
        // derive classes, scan resources, assemble PackageBundle (type, id, version,
        // name, metaModels, libraries, classes, assets, docs, samples, annotations),
        // write JSON into ctx.Sandbox under BundleFileName.
    }

    private static DiscriminatorFor(t: ProjectType): string | undefined { /* MetaModel→'meta-model', Library→'library', else undefined */ }
}
```

> The `metaModels`/`libraries` bindings come from `ctx.Manifest` (read the manifest's binding fields the deprecated `publish()` read). `annotations` via `projectAnnotations(pkg.document, PACKAGE_NODE)`.

- [ ] **Step 2:** Insert `new EmitBundleAction()` into `NpmPackageBuildSystem`'s action list between `BakeResourcesAction` and `EmitPackageLayoutAction`.

- [ ] **Step 3: Test** — meta-model fixture → `bundle.json` with `type: 'meta-model'` + classes; library fixture → `type: 'library'`; architecture fixture → **no `bundle.json` written, no throw**.

- [ ] **Step 4: Run, verify pass. Commit.**

### Task 9: Publish action + IStorage registry contract + PublishRegistry on context + publish flavor

**Files:**
- Create: `.../npm/publish-package-action.ts`
- Modify: `.../todl-build-context.ts`, `.../todl-project-build-manager.ts`, `.../npm/npm-package-build-system.ts`, `.../package-manager/package-registry-client.ts`
- Test: `.../npm/tests/publish-package-action.test.ts`

**Interfaces:**
- Consumes: `IPackageRegistry`/`PublishablePackage`/`PackageManifestJson` (`../../package-manager/engine/package-registry.js`), `createTgz`/`TarEntry` (`../../package-manager/registry/tar.js`), `StorageTree` (`../../build-system-core/storage-tree.js`), `IStorage`.
- Produces: `PublishPackageAction implements IBuildAction<TodlBuildContext>`; `TodlBuildContext.PublishRegistry?: IPackageRegistry`; `TodlBuildRequest.PublishRegistry?`; `NpmPackageBuildSystem` publish flavor.

- [ ] **Step 1:** Add `PublishRegistry?: IPackageRegistry` to `TodlBuildContext` and `TodlBuildRequest` (import the type). Thread it in `TodlProjectBuildManager.Build`: `(base) => ({ ...base, Manifest: request.Manifest, Source: request.Source, PublishRegistry: request.PublishRegistry })`.

- [ ] **Step 2:** Add an `IStorage` pack helper. In `package-registry-client.ts`, add a static that builds a `PublishablePackage` from an `IStorage` layout (read all files via `StorageTree.Files`, tar under `package/`, parse `package.json` as the manifest) — mirroring `packDir` but `IStorage`-based and async:

```ts
public static async PackStorage(layout: IStorage): Promise<PublishablePackage>
{
    const entries: TarEntry[] = []
    let manifest: PackageManifestJson | undefined
    for (const path of await StorageTree.Files(layout))
    {
        const bytes = await layout.ReadBytes(path)
        if (path === 'package.json') manifest = JSON.parse(new TextDecoder().decode(bytes)) as PackageManifestJson
        entries.push({ path: `package/${path}`, bytes })
    }
    if (manifest === undefined) throw new Error('no package.json in build output')
    return { Manifest: manifest, Tarball: createTgz(entries) }
}
```

- [ ] **Step 3: Write `PublishPackageAction`.**

```ts
// publish-package-action.ts
export class PublishPackageAction implements IBuildAction<TodlBuildContext>
{
    private static readonly ActionName = 'publish-package'
    private static readonly NoRegistryMessage = 'no registry associated with this solution'

    public readonly Name = PublishPackageAction.ActionName
    public readonly Consumes: readonly ArtifactKey<unknown>[] = []
    public readonly Produces: readonly ArtifactKey<unknown>[] = []

    public async Execute(ctx: TodlBuildContext): Promise<void>
    {
        const registry = ctx.PublishRegistry
        if (registry === undefined)
        {
            ctx.Diagnostics.Report({ severity: Severity.Error, message: PublishPackageAction.NoRegistryMessage, source: PublishPackageAction.ActionName })
            return
        }
        const pkg = await PackageRegistryClient.PackStorage(ctx.Sandbox)
        await registry.Publish(pkg)
    }
}
```

- [ ] **Step 4: Add the publish flavor.** `NpmPackageBuildSystem.Flavors()` returns two `StaticBuildFlavor`s: the existing package flavor (`Id = 'npm-package'`) and a publish flavor (`Id = 'npm-publish'`, same `OutputName`) whose actions are the package actions **+** `new PublishPackageAction()`. Keep the action list built once in the ctor; append the publish action for the second flavor.

- [ ] **Step 5: Tests** — publish flavor with a fake `IPackageRegistry` and an in-memory sandbox → `Publish` called once with a tarball whose manifest is the layout's `package.json`; **publish flavor with `PublishRegistry` undefined → error diagnostic, `Publish` never called, nothing written** (Review Focus); **package flavor with a registry set → `Publish` never called** (Review Focus: package flavor never touches the registry).

- [ ] **Step 6: Run, verify pass. Commit.**

### Task 10: SolutionManagerService.PublishRegistry + solution-build-manager threads it

**Files:**
- Modify: `.../solution-manager/engine/solution-manager-service.ts`, `.../todl-build-system/solution/solution-build-manager.ts`
- Test: `.../solution-manager/engine/tests/solution-manager-service.test.ts` (or the build-manager test)

**Interfaces:**
- Produces: `SolutionManagerService.PublishRegistry: IPackageRegistry | undefined` (settable); the solution build manager reads it and sets `request.PublishRegistry` when invoking a publish flavor.

- [ ] **Step 1:** Add `public PublishRegistry: IPackageRegistry | undefined` to `SolutionManagerService` (read the class first; if it exposes observable state via `Observable`, add it as a plain settable property — it is infrastructure, not bound UI, so a raw field is fine; match the class's existing style). Document that it is set from the solution's configured registry connection (host wiring) or directly by headless callers.

- [ ] **Step 2:** In `solution-build-manager.ts`, where it constructs the `TodlBuildRequest` for a member build, set `PublishRegistry: this.solutionManager.PublishRegistry` (read the file for the exact wiring; the manager already holds the solution manager or can be given it). Only the publish flavor consumes it; the package flavor ignores it.

- [ ] **Step 3: Test** — set `PublishRegistry` on the service, run a publish build through the manager against a fixture, assert the fake registry's `Publish` was called; unset → publish fails with the no-registry diagnostic.

- [ ] **Step 4: Run, verify pass. Commit.**

### Task 11: Retire factory.publish(); switch smoke + build-lifecycle to the publish flavor

**Files:**
- Modify: `.../project-services/core/producer-project-factory-base.ts` (remove `publish()`), `.../project-services/core/project-factory.ts` (remove `IPublishableProjectFactory`/`isPublishable` if now unused in TODL), `user-smoke-tests/architecture-bundle.smoke.test.ts`, `.../solution-manager/engine/tests/build-lifecycle.test.ts`, `.../html-bundle/tests/html-bundle.test.ts`
- Test: existing suites above

- [ ] **Step 1:** Remove `publish()` from `ProducerProjectFactory` and its now-dead imports (`BlobPackageStore`, `PackageBundle` assembly, `PresentationBakerKey` usage there, `ProducerResources` if only used by publish — it now lives in `EmitBundleAction`). Keep everything the build actions still need.
- [ ] **Step 2:** `IPublishableProjectFactory`/`isPublishable`: grep TODL for remaining users. If Plexus still needs the guard temporarily, leave the interface exported but mark that Plexus migrates in Task 15; otherwise remove. Record the ruling in the ledger.
- [ ] **Step 3:** Switch the smoke + build-lifecycle + html-bundle tests that call `client.publish(outputPath)` to build the publish flavor with a fake/local `IPackageRegistry` (or call `PackageRegistryClient.PackStorage` + a local registry). Assert the same published artifacts appear.
- [ ] **Step 4:** Run the **full TODL suite**; confirm zero net new `tsc` errors vs main (compare counts/kinds as in Phase 2). Commit.

---

## Plexus workstream (after TODL lands and is consumable)

### Task 0A: TODL — make project-system composition + the publish path browser-safe (prerequisite, runs first, in the TODL worktree)

> Added by the controller on 2026-09-26 (ledger ruling). The spec (todl#1) binds: Plexus's `app.mu` `.modules:` gains `TodlProjectSystemModule` at the head, and the publish pipeline's pack step moves "off Node fs … so publish is testable over in-memory IStorage". Plexus composes and publishes in its Electron RENDERER (browser bundle, no nodeIntegration; `factory.publish()` ran there over IPC-backed `IStorage`). The TODL run (Task 7 fix) moved `TodlProjectSystemModule`/`ProjectSystemContribution` to the node-only `./project-system` subpath because the composer graph reaches `HtmlBundleBuildSystem` (esbuild) and node fs; and Task 9 put `PackStorage` on `PackageRegistryClient`, which imports `node:fs`/`node:path` and gzips via `tar.ts`'s `node:zlib` `gzipSync`. Plexus's publish target will be `LocalNpmRegistry` over its packages `IStorage` (preserving today's "publish into the local package store" UX), whose `Publish` unpacks via `TarReader` (`node:zlib` `gunzipSync`). None of this can load in the renderer.

**Work in:** `C:\Users\Eugene\Projects\architecture-agent\TODL\.claude\worktrees\build-modules` (branch `worktree-build-modules`, HEAD 1e1bfd2). TODL suite green at 1269/1269 before you start.

**Required outcome:**
1. **Browser-safe composition.** The main (browser-safe) `@pragmatic-tech-ai/todl` barrel exports a `TodlProjectSystemModule` whose `Compose` path imports NO node builtins and NO esbuild: it registers the factories, generators, default baker, `NpmPackageBuildSystem` (package + publish flavors), registries, and lifecycle wiring. The html-bundle build system (esbuild / node) is registered by a node-only addition exported from the `./project-system` subpath (e.g. a node module/contribution that composes the core then `RegisterResolved`s `HtmlBundleBuildSystem`) so headless/devUI/CLI keep html-bundle. Keep one composer (no duplicated seeding logic): split it into the browser-safe core + a node extension that calls the core. `ProjectSystemContribution` (headless) stays on the node subpath and includes html-bundle.
2. **Browser-safe pack/publish.** Move the IStorage pack out of `PackageRegistryClient` into a browser-safe class (e.g. under `package-manager/registry/`) that `PublishPackageAction` uses; gzip via the web-standard `CompressionStream('gzip')` (available in browsers and Node ≥18), async. Make `LocalNpmRegistry.Publish`'s unpack browser-safe the same way (`DecompressionStream('gzip')`) — add an async tar read path if `TarReader` is sync/node-bound; keep the existing node-side `TarReader`/`createTgz` APIs working for their current callers (npm-registry, CLI) unless trivially shareable. The resulting tarball must stay npm-compatible (still gunzip-able by node:zlib — test that round-trip).
3. **Guard it.** Add a test that fails if the browser barrel's composition graph reaches a node builtin or esbuild — follow the existing html-bundle "failed to bundle the app" guard (it bundles the app for the browser platform) or an equivalent esbuild browser-platform bundle of `src/index.ts`'s `TodlProjectSystemModule` entry. Existing Review-Focus tests (no-registry publish fails fast, package flavor never touches the registry, missing icon blocks) stay green.
4. Full TODL suite green; `npm run typecheck` zero net-new errors vs 1e1bfd2. Commit on `worktree-build-modules`.

### Task 0B: Plexus — absorb TODL main's API drift since 0.36.0 (prerequisite, runs before Task 12)

> Added by the controller on 2026-09-26 (ledger ruling). Plexus is pinned to the PUBLISHED `@pragmatic-tech-ai/todl@0.36.0` (built at TODL d465c61). TODL main has since moved 179 commits, including breaking removals unrelated to this plan's Tasks 1–11. Against a local build of the build-modules branch (0.36.0 version string, new content) Plexus has 38 type errors and ~all plexus-app vitest suites fail to load. Baseline against published 0.36.0 is fully green (typecheck 0 errors; plexus-core 44+1 skipped, devUI 53, plexus 1513+1 skipped). Tasks 12–15 cannot be verified until Plexus loads against the new TODL, so this task restores a verifiable baseline.

**Setup already done by the controller:** Plexus branch `build-modules-integration`; `node_modules/@pragmatic-tech-ai/todl` replaced by an extracted `npm pack` of the TODL build-modules branch HEAD 1e1bfd2 (NOT a symlink — deps resolve from Plexus's own node_modules). Do not run `npm install` (it would restore the published 0.36.0). If you need to refresh it, ask the controller.

**Scope — fix exactly these three drift classes, nothing from Tasks 12–15:**

1. **Vitest cannot load the new TODL.** Every plexus-app suite fails with `Stripping types is currently unsupported for files under node_modules, for ".../node_modules/@pragmatic-tech-ai/mural/src/<x>/index.ts"` (devUI's `build-manager-compiler.test.ts` hits the same for `mural/src/compiler`). mural's exports carry an `import.development → ./src/*.ts` condition; the vitest configs alias mural/todl-runtime/todl-root to `dist` and inline todl so its mural imports route through the aliases. The new TODL adds subpaths (`./project-system`, `./graph-api`) and possibly new mural subpath imports that escape this. Diagnose the exact escaping import edge and fix it in the Plexus vitest config(s) (apps/plexus, apps/devUI, packages/plexus-core as needed), following the file's existing pattern and comments. Do not modify TODL or mural.
2. **`Element` / `toElement` / `ToElementOptions` / `PresentationHint` were removed** from `@pragmatic-tech-ai/todl` (TODL commit 2f9976a: "retire the dead Element/toElement projection (replaced by Snapshot)"; the deleted source is visible via `git -C ../TODL show 2f9976a`). Plexus still uses them in `apps/plexus/src/renderer/src/modules/architecture-projects/` (element-view-model.ts, element-selection-bridge.ts, element-presentation.ts, arch-navigation-service.ts + their tests). Ruling order: (a) migrate to TODL's replacement (Snapshot / reflection read API) if it covers the same data with a mechanical rewrite; (b) otherwise port the minimal projection Plexus needs into Plexus's architecture-projects module as a class (OOP, Allman, no free functions). Behavior and existing tests' expectations must be preserved. Do not modify TODL.
3. **`regeneratePresentation` / `canGeneratePresentation` / `IPresentationProjectFactory` were removed** (TODL 4f73ff7: "remove user-driven regeneratePresentation; presentation is a build artifact"). Remove Plexus's user-driven regenerate-presentation path (plexus-core `projects/project-factory.ts` re-exports, the project-explorer-service command/menu entry, and their tests) — presentation is now produced by the build.

**Out of scope (leave the errors in place for later tasks):** `publish()` on factories / `IPublishableProjectFactory` (Task 15); `MuralPresentationBaker` vs `IPresentationBaker` signature (Task 13); `AppProjectFactoryRegistry` ctor (Task 12). If a failing test lives only in files owned by those tasks, leave it.

**Acceptance gate:** `npm run typecheck` at the Plexus root shows ONLY errors in the out-of-scope files named above (list them in the report); `npm test` at the root: plexus-core and devUI fully green; plexus app green except suites that exercise the out-of-scope files (list them with the reason). Commit on `build-modules-integration`.

### Task 12: Compose via TodlProjectSystemModule; delete the duplicate factory registries

**Files:**
- Modify: `apps/plexus/src/renderer/src/app.mu`
- Delete: `apps/plexus/src/renderer/src/modules/project-factories/app-project-factory-registry.ts`, `.../project-factories/project-factories.module.mu`, and any `DefaultProjectFactoryRegistry` (grep `packages/plexus-core/.../projects/project-factory.ts` + `project-explorer-service.ts` usages)
- Test: Plexus factory/registry tests

- [ ] **Step 1:** Add `TodlProjectSystemModule` at the head of `app.mu`'s `.modules:` block (import from `@pragmatic-tech-ai/todl`). Verify it is exported from TODL's `src/index.ts` (add the export in Task 7 if missing).
- [ ] **Step 2:** Delete `AppProjectFactoryRegistry` + `project-factories.module.mu` + `DefaultProjectFactoryRegistry`; replace their consumers (project-explorer-service, solution-services) with resolution of the composed `ProjectFactoryRegistryKey`.
- [ ] **Step 3:** Update Plexus tests that constructed the old registries; run the Plexus suite for this area. Commit.

### Task 13: Delete the Plexus baker; baking resolves the TODL default

**Files:**
- Delete: `apps/plexus/src/renderer/src/services/projects/mural-presentation-baker.ts`, `.../modules/meta-model/services/presentation-publisher.ts`, `.../modules/library/services/library-presentation-publisher.ts`, `.../modules/meta-model/services/presentation-generator.ts`
- Modify: `apps/plexus/src/renderer/src/modules/meta-model/meta-model.module.mu` (remove the `MuralPresentationBaker` line + import)
- Test: Plexus meta-model/library suites

- [ ] **Step 1:** Delete the four files + the `.services:` baker registration + import. Any Plexus code importing `presentation-generator` helpers now imports from TODL (`PresentationResourceEmitter` / `PresentationBake`) or is removed if it was only feeding the old baker.
- [ ] **Step 2:** Confirm the composed `PresentationBakerKey` (TODL default) is what the build resolves; run the Plexus meta-model/library tests. Commit.

### Task 14: Raise lifecycle events onto the bus; retire the old generator contribution

**Files:**
- Modify: Plexus project-lifecycle services (grep where projects are created / references change / opened), Plexus composition (remove any `GeneratorRegistryContribution` wiring)
- Test: Plexus generator/lifecycle tests

- [ ] **Step 1:** From Plexus's project create/open/reference-change paths, resolve `ProjectEventsKey` and `Raise` the matching `ProjectEvent` (`Created`/`Opened`/`ReferencesChanged`).
- [ ] **Step 2:** Remove Plexus's direct use of the retired `GeneratorRegistryContribution`; the composer now owns scheduler wiring.
- [ ] **Step 3:** Test that creating a project triggers the generators (DTO/UI) via the bus. Commit.

### Task 15: Rewire Publish command + devUI to the publish flavor

**Files:**
- Modify: `packages/plexus-core/src/renderer/modules/project-explorer/services/project-explorer-service.ts` (the `op.Factory.publish(...)` call site, line ~1093), `apps/devUI/src/renderer/modules/package-compiler/package-compiler-service.ts`, `apps/devUI/src/main/registry/registry-bridge.ts`
- Test: Plexus/devUI publish tests

- [ ] **Step 1:** Replace the `isPublishable`/`factory.publish()` path with: resolve the build manager + the solution's `PublishRegistry`, run the `npm-publish` flavor for the selected project, surface the diagnostics as the command status. Remove the now-dead `IPublishableProjectFactory` usage (coordinate with Task 11's ruling).
- [ ] **Step 2:** Point devUI's publish at the publish flavor (or `PackStorage` + its registry), preserving its existing UX.
- [ ] **Step 3:** Run the Plexus + devUI suites green (migration acceptance gate). Commit.

### Task 16: dev-kit docs

**Files:**
- Modify: `dev-kit/docs/projects/todl/architecture/build-system.md`, `.../content-generators.md`, `.../walkthroughs.md`, and any index touching the pipeline
- (dev-kit is a separate public repo; commit + push is explicitly the user's call — leave push to the finishing step)

- [ ] **Step 1:** Update the build-system + content-generators pages: the default baker now ships in TODL and is registered unconditionally; `bundle.json` + publish are pipeline actions; the registry comes from the solution manager via the build context; publish is a distinct flavor.
- [ ] **Step 2:** Update walkthrough B (producer → package) to end at emit-bundle + the optional publish flavor, and note the headless self-contained bake. Commit (do not push).

---

## Self-review notes

- **Spec coverage:** S1 → Tasks 1–3; S2 → Tasks 6–7; S3 (baker + Plexus) → Tasks 4–5, 12–14; S4 (publish/bundle/registry/PublishRegistry) → Tasks 8–10, 15; S5 (testing) → each task's tests + the migration gate in Tasks 11/15.
- **Type consistency:** `ServiceToken<T>` used uniformly in all three definitions; `PublishRegistry` typed `IPackageRegistry | undefined` on both context and request and the service; `RegisterResolved`/`RegisterDefinition`/`Register` names fixed across Tasks 2/3/6.
- **Ordering:** Tasks 1–5 are independent leaves; Task 6 depends on 1–5; 7 on 6; 8 independent; 9 on 8 (pipeline) + context; 10 on 9; 11 on 8–10; Plexus 12–15 on the whole TODL workstream; 16 last.
