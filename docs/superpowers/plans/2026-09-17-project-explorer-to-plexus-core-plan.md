# Project Explorer → plexus-core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the Project Explorer module and its private substrate from `apps/plexus` into `packages/plexus-core`, inverting every reach *up* into an app feature module to a plain DI interface defined in core and implemented in `apps/plexus`.

**Architecture:** Plain shared-token DI on the existing (eager-register, lazy-instantiate) `ServiceProvider`. Core defines capability interfaces + `ServiceKey`s; the app registers impls under those keys with the existing `Impl -> Key` alias in `app.mu`; the explorer resolves them with `Provider.get`/`getRequired`. No demand-driven resolution, no compiler change. Execution order keeps each phase compilable: move substrate first (service stays in app), invert couplings, then move the coupling-free service last.

**Tech Stack:** TypeScript (ESM, strict), mural `.mu` compiler, todl-runtime `ServiceProvider`, electron-vite, Vitest, Playwright (e2e smoke).

**Spec:** [docs/superpowers/specs/2026-09-17-project-explorer-to-plexus-core-design.md](../specs/2026-09-17-project-explorer-to-plexus-core-design.md)

## Global Constraints

- `plexus-core` MUST NOT import any `apps/plexus` module. Dependency direction is `apps/plexus → plexus-core` only.
- `plexus-core` keeps its dependency floor: `todl-runtime` only, **no `@pragmatic-tech-ai/todl`**. Anything todl-heavy (`WorkspaceBaseResolver`, `TodlLanguageClient`, published-bases backends) stays app-side behind an interface.
- No behavioral change to the explorer. Same tree, commands, dialogs, drag/drop, rename/delete, publish/version, export, run-agent, references.
- No lambda/"participant bag" abstractions — injected dependencies are real, method-bearing interfaces. Rewrite the existing `NewFileParticipant`/`NodeCommandContributor` bags to real interfaces while relocating them.
- New VM classes derive from `Observable`, not `MuralBase` (except where the framework API demands `MuralBase`, e.g. dialog content).
- Every test file lives in a `tests/` subfolder next to its source.
- Enums over string-literal unions.
- This is a refactor: the per-task "test" is usually `tsc --noEmit` + the existing suites staying green + a build. New code (impls, guards) gets real unit tests.

**Commands (run from the named package dir):**
- Core typecheck: `cd packages/plexus-core && npm run typecheck`
- Core build (`.mu` + tsc): `cd packages/plexus-core && npm run build`
- App renderer typecheck: `cd apps/plexus && npx tsc -p tsconfig.web.json --noEmit`
- App unit tests: `cd apps/plexus && npx vitest run`
- App build (`.mu` + all targets): `cd apps/plexus && npx electron-vite build`

---

## Phase A — Relocate the substrate to core (service stays in app)

Move the explorer's dependency-light model/VMs/stores/helpers/behaviors into `plexus-core`, leaving `ProjectExplorerService` and the `.mu` module/resources in `apps/plexus` for now. The app's service then imports the substrate from core (`app → core`, allowed). Core stays compilable because the substrate is core-safe — with one coupling to break (`open-project.ts` → `AgentSkillChoice`).

**New core home:** `packages/plexus-core/src/renderer/projects/` (source) — exported via a new `./renderer/projects` subpath in Task A6.

### Task A1: Break the OpenProject → AgentSkillChoice coupling

`open-project.ts` types `AgentSkillChoices: ObservableCollection<AgentSkillChoice>`, importing the app's agent-chat module. Replace that with a core-owned `ProjectMenuChoice` value type so `open-project.ts` is core-safe.

**Files:**
- Create: `packages/plexus-core/src/renderer/projects/project-menu-choice.ts`
- Modify: `apps/plexus/src/renderer/src/services/projects/open-project.ts` (the `AgentSkillChoices`/`HasAgentSkills` members + import)
- Modify: `apps/plexus/src/renderer/src/modules/project-explorer/services/project-explorer-service.ts:520-540` (`wireAgentSkillChoices` builds `AgentSkillChoice`)
- Modify: `apps/plexus/src/renderer/src/modules/project-explorer/project-explorer.resources.mu` (`AgentSkillChoiceTemplate` DataType)

**Interfaces:**
- Produces: `ProjectMenuChoice { readonly Label: string; readonly Command: ICommand }` (a plain class, `Observable`-free — immutable value).

- [ ] **Step 1: Write the core value type**

```ts
// packages/plexus-core/src/renderer/projects/project-menu-choice.ts
import type { ICommand } from '@pragmatic-tech-ai/mural/runtime'

// One extra project-header menu row contributed by the host (e.g. the app's
// "Run Agent / Skill" entries). A plain immutable value: a label + the command
// to run. Rendered by a DataTemplate[ProjectMenuChoice] (Header=$Label,
// Command=$Command).
export class ProjectMenuChoice {
  constructor(public readonly Label: string, public readonly Command: ICommand) {}
}
```

- [ ] **Step 2: Retype OpenProject's members**

In `open-project.ts`: replace `import type { AgentSkillChoice } from '../../modules/agent-chat/services/agent-skill-choice.js'` with `import { ProjectMenuChoice } from '@pragmatic-tech-ai/plexus-core/renderer/projects'`, and rename `AgentSkillChoices`→`ProjectMenuChoices`, `HasAgentSkills`→`HasProjectMenu`, retyping the DP to `ObservableCollection<ProjectMenuChoice>`. Keep the `MuralBase.RegisterProperty` shape.

- [ ] **Step 3: Update the service builder**

In `project-explorer-service.ts` `wireAgentSkillChoices`, build `new ProjectMenuChoice(s.label, cmd)` into an `ObservableCollection<ProjectMenuChoice>` and assign `op.ProjectMenuChoices` / `op.HasProjectMenu`. (This method becomes the app-side ProjectMenuSource impl in Phase C; here just retype it.)

- [ ] **Step 4: Update the template**

In `project-explorer.resources.mu`, change `DataTemplate x:key="AgentSkillChoiceTemplate" [ DataType = AgentSkillChoice ]` → `[ DataType = ProjectMenuChoice ]` and the import to `ProjectMenuChoice from "@pragmatic-tech-ai/plexus-core/renderer/projects"`; rename the `Visibility = $HasAgentSkills`/`ItemsSource = $AgentSkillChoices` bindings to `$HasProjectMenu`/`$ProjectMenuChoices`.

- [ ] **Step 5: Verify**

Run: `cd apps/plexus && npx tsc -p tsconfig.web.json --noEmit` — Expected: no errors referencing `AgentSkillChoice` from `open-project.ts`. (`project-menu-choice.ts` isn't exported yet; Task A6 wires the subpath — until then import via a relative path `../../../../../../packages/plexus-core/src/renderer/projects/project-menu-choice.js` is NOT allowed; instead do A6's export first if the resolver complains. See A6.)

- [ ] **Step 6: Commit**

```bash
git add packages/plexus-core/src/renderer/projects/project-menu-choice.ts apps/plexus/src/renderer/src/services/projects/open-project.ts apps/plexus/src/renderer/src/modules/project-explorer/
git commit -m "refactor(explorer): core ProjectMenuChoice replaces OpenProject's AgentSkillChoice coupling"
```

### Task A2: Move the model, dialog VMs, stores, helpers, and behaviors to core

Relocate the substrate files verbatim into `packages/plexus-core/src/renderer/projects/`, fixing only import specifiers. This is one batched mechanical move; `tsc` is the gate.

**Files — move (git mv) from `apps/plexus/src/renderer/src/services/projects/` to `packages/plexus-core/src/renderer/projects/`:**
`project.ts`, `open-project.ts`, `project-factory.ts`, `base-binding.ts`, `new-item-choice.ts`, `new-project-dialog-model.ts`, `open-project-dialog-model.ts`, `set-version-dialog-model.ts`, `manage-references-dialog-model.ts`, `open-projects-store.ts`, `recent-projects-service.ts`, `semver-bump.ts`, `node-move.ts`, `project-node-icon.ts`, `shorten-path.ts`, `tree-selection-behavior.ts`, `tree-drag-drop-behavior.ts`, `project-tree-template-behavior.ts`.

**Also move (generic infra the substrate/service needs), into `packages/plexus-core/src/renderer/`:**
- `apps/plexus/src/renderer/src/services/documents/document-factory.ts` → `packages/plexus-core/src/renderer/documents/document-factory.ts`
- `.../services/documents/document-close-guard.ts` → `packages/plexus-core/src/renderer/documents/document-close-guard.ts`
- `.../services/documents/new-file-participant.ts` → `.../renderer/documents/new-file-participant.ts`
- `.../services/documents/node-command-contributor.ts` → `.../renderer/documents/node-command-contributor.ts`
- `.../services/diagnostics/diagnostic.ts` + `diagnostics-service.ts` → `.../renderer/diagnostics/`
- `.../services/storage/storage-provider-registry.ts` → `.../renderer/storage-provider-registry.ts` (co-locate with the existing `renderer/services/storage`)
- `.../services/dialogs/confirm-dialog-model.ts` → `.../renderer/dialogs/confirm-dialog-model.ts`

**Interfaces:**
- Consumes: `ProjectMenuChoice` (A1), `IStorage`/`ServiceKey` (todl-runtime), mural runtime.
- Produces: all the above types re-homed under `@pragmatic-tech-ai/plexus-core/renderer/projects` (and `/documents`, `/diagnostics`, `/dialogs`).

- [ ] **Step 1: git mv the files** (batch the list above). Do NOT edit contents yet.

- [ ] **Step 2: Fix intra-move import specifiers**

Within the moved files, rewrite sibling imports to their new relative paths, and rewrite any remaining `../../modules/...` or `../<appservice>` imports. Expected remaining cross-references after the move:
- `project-tree-template-behavior.ts`, `tree-selection-behavior.ts`, `tree-drag-drop-behavior.ts` import `ProjectExplorerService` (still in app) — these behaviors reference the service. **Break this** by having the behaviors depend on a narrow core interface `IProjectTreeHost` (Task A3) instead of the concrete service.
- `open-project.ts` imports `ProjectMenuChoice` (now a sibling in core) — fix to `./project-menu-choice.js`.
- `EnvironmentService`, `path-utils` references (from `open-projects-store`, behaviors) — move `environment-service.ts` + `file-watch/path-utils.ts` too, or depend on a core copy (fold into this task's move list if `tsc` flags them).

- [ ] **Step 3: Verify core typecheck**

Run: `cd packages/plexus-core && npm run typecheck` — Expected: PASS after A3 lands the behavior interface. If it flags a still-app import, either the file belongs app-side (revert its move) or its dependency also moves — decide per file, prefer moving generic infra, keeping feature/todl code app-side.

- [ ] **Step 4: Verify app typecheck**

Run: `cd apps/plexus && npx tsc -p tsconfig.web.json --noEmit` — Expected: PASS; app files now import the substrate from `@pragmatic-tech-ai/plexus-core/renderer/projects` (wired in A6). Where the resolver can't find the subpath yet, complete A6 first.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(explorer): relocate model/dialogs/stores/behaviors substrate to plexus-core"
```

### Task A3: Decouple the tree behaviors from ProjectExplorerService

The three behaviors call back into `ProjectExplorerService` (`ApplyTreeSelection`, `OwnerOf`, `MoveNodesCommand`, `AddRevealListener`). Define a narrow core interface they depend on; the service implements it.

**Files:**
- Create: `packages/plexus-core/src/renderer/projects/project-tree-host.ts`
- Modify: the three behavior files (import the interface instead of the service)
- Modify (later, Phase C): `ProjectExplorerService` declares `implements IProjectTreeHost`

- [ ] **Step 1: Define the interface** — include exactly the members the behaviors call:

```ts
// packages/plexus-core/src/renderer/projects/project-tree-host.ts
import type { OpenProject } from './open-project.js'
import type { ProjectNode } from './project.js'

export interface IProjectTreeHost {
  readonly OpenProjects: import('@pragmatic-tech-ai/mural/runtime').ObservableCollection<OpenProject>
  OwnerOf(node: ProjectNode): OpenProject | undefined
  ApplyTreeSelection(items: readonly unknown[], primary: unknown): void
  AddRevealListener(listener: (folder: ProjectNode) => void): () => void
}

export const ProjectTreeHostKey =
  new (await import('@pragmatic-tech-ai/mural/runtime')).ServiceKey<IProjectTreeHost>('IProjectTreeHost')
```
*(If a top-level `await import` is undesirable, use a normal `import { ServiceKey, ObservableCollection } from '@pragmatic-tech-ai/mural/runtime'`.)*

- [ ] **Step 2: Point the behaviors at `ProjectTreeHostKey`** — resolve `provider.getRequired(ProjectTreeHostKey)` instead of `ProjectExplorerService.Key`. The concrete service (still in app) will be alias-registered under `ProjectTreeHostKey` in Phase D; until then the behaviors compile against the interface.

- [ ] **Step 3: Verify** — `cd packages/plexus-core && npm run typecheck` PASS.

- [ ] **Step 4: Commit** — `git commit -am "refactor(explorer): behaviors depend on core IProjectTreeHost, not the service"`

### Task A6: Wire core `exports` for the new subpaths

**Files:** Modify `packages/plexus-core/package.json` (`exports`).

- [ ] **Step 1: Add exports**

```jsonc
"./renderer/projects":    "./dist/renderer/projects/index.js",
"./renderer/documents":   "./dist/renderer/documents/index.js",
"./renderer/diagnostics": "./dist/renderer/diagnostics/index.js",
"./renderer/dialogs":     "./dist/renderer/dialogs/index.js"
```

- [ ] **Step 2: Add `index.ts` barrels** re-exporting each folder's public types.

- [ ] **Step 3: Verify** — `cd packages/plexus-core && npm run build` PASS; `cd apps/plexus && npx tsc -p tsconfig.web.json --noEmit` PASS.

- [ ] **Step 4: Commit** — `git commit -am "build(plexus-core): export renderer/projects,documents,diagnostics,dialogs subpaths"`

---

## Phase B — Define the core capability interfaces

Define the interfaces the explorer resolves (implemented app-side in Phase D). One file per capability under `packages/plexus-core/src/renderer/projects/capabilities/`, barrel-exported via `./renderer/projects`.

### Task B1: The capability interfaces + keys

**Files:** Create under `packages/plexus-core/src/renderer/projects/capabilities/`: `published-bases.ts`, `live-validation.ts`, `base-resolver.ts`, `diagram-tree-export.ts`, `project-menu-source.ts`, `problems-dock.ts`; barrel `index.ts`.

**Interfaces (Produces):**

- [ ] **Step 1: PublishedBases**

```ts
// published-bases.ts
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { BaseRef } from '../base-binding.js'
export interface IPublishedBases {
  listMetaModels(): Promise<BaseRef[]>
  listLibraries(): Promise<BaseRef[]>
}
export const PublishedBasesKey = new ServiceKey<IPublishedBases>('IPublishedBases')
```

- [ ] **Step 2: LiveValidation**

```ts
// live-validation.ts
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
export interface ILiveValidation {
  attachProject(rootPath: string, name: string, storage: IStorage): void
  detachProject(storage: IStorage): void
  resyncProject(rootPath: string, storage: IStorage): void
  refreshBases(storage: IStorage): Promise<void> | void
}
export const LiveValidationKey = new ServiceKey<ILiveValidation>('ILiveValidation')
```

- [ ] **Step 3: BaseResolver**

```ts
// base-resolver.ts
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { BaseRef } from '../base-binding.js'
import { ProducerKind } from '../project-factory.js'
export interface IBaseResolver {
  workspaceProducers(kind: ProducerKind): Promise<BaseRef[]>
  producedIdOf(storage: IStorage): string | undefined
  refreshDependentsOfIds(ids: readonly string[]): Promise<void>
}
export const BaseResolverKey = new ServiceKey<IBaseResolver>('IBaseResolver')
```

- [ ] **Step 4: DiagramTreeExport** (single method; app impl does render+save)

```ts
// diagram-tree-export.ts
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { OpenProject } from '../open-project.js'
export enum DiagramExportFormat { Svg = 'svg', Pptx = 'pptx' }
export interface IDiagramTreeExport {
  export(op: OpenProject, path: string, format: DiagramExportFormat): Promise<void>
}
export const DiagramTreeExportKey = new ServiceKey<IDiagramTreeExport>('IDiagramTreeExport')
```

- [ ] **Step 5: ProjectMenuSource**

```ts
// project-menu-source.ts
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { OpenProject } from '../open-project.js'
import type { ProjectMenuChoice } from '../project-menu-choice.js'
export interface IProjectMenuSource {
  menuFor(op: OpenProject): Promise<readonly ProjectMenuChoice[]>
}
export const ProjectMenuSourceKey = new ServiceKey<IProjectMenuSource>('IProjectMenuSource')
```

- [ ] **Step 6: ProblemsDock**

```ts
// problems-dock.ts
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
export interface IProblemsDock { expand(): void }
export const ProblemsDockKey = new ServiceKey<IProblemsDock>('IProblemsDock')
```

- [ ] **Step 7: Barrel + verify** — export all from `capabilities/index.ts` and re-export from `renderer/projects/index.ts`. Run `cd packages/plexus-core && npm run typecheck` — PASS.

- [ ] **Step 8: Commit** — `git commit -am "feat(plexus-core): capability interfaces for the project explorer (DI seams)"`

---

## Phase C — Rewrite the service's couplings (service still in app)

Rewrite each feature call-site in `project-explorer-service.ts` (still in app) to resolve the core interface; apply the two non-DI cleanups; delete every app-feature import. After this the service depends only on core + generic infra, so Phase E can move it.

### Task C1: Swap the four hard couplings to interfaces

**File:** Modify `apps/plexus/src/renderer/src/modules/project-explorer/services/project-explorer-service.ts`.

- [ ] **Step 1: PublishedBases** — replace `ensureMetaModelsBackend`/`ensureLibrariesBackend` (used in `publishedMetaModels`/`publishedLibraries`, lines ~1291-1317) with `this.Provider.getRequired(PublishedBasesKey).listMetaModels()` / `.listLibraries()`. Delete the two backend imports.

- [ ] **Step 2: ProjectMenuSource** — replace the `SkillCatalog`/`SkillRunner`/`SkillChoiceBuilder` body of `wireAgentSkillChoices` (lines ~520-540) with `op.ProjectMenuChoices = new ObservableCollection(...(await this.Provider.get(ProjectMenuSourceKey)?.menuFor(op) ?? []))`; set `op.HasProjectMenu` from its length. Delete the skills/agent-chat imports + `ProjectType`.

- [ ] **Step 3: DiagramTreeExport** — replace `exportNode` (lines ~1402-1415) + the `wireNodes` export gate (lines ~1388-1394) with `this.Provider.get(DiagramTreeExportKey)` (gate `HasExport` on its presence; `exportNode` calls `.export(op, node.Path, format)`). Delete `DiagramExportService`/`DiagramHeadlessRenderer`/`ExportFormat` imports; use `DiagramExportFormat` from core.

- [ ] **Step 4: ProblemsDock + LiveValidation + BaseResolver** — replace `this.Provider.get(ProblemsService.Key)?.Expand()` with `...get(ProblemsDockKey)?.expand()`; `TodlLanguageClient.Key` calls with `LiveValidationKey`; `WorkspaceBaseResolver.Key` calls with `BaseResolverKey`. Delete those three imports. (These were already optional `Provider.get` — only the token + method-name casing change.)

- [ ] **Step 5: Verify** — `cd apps/plexus && npx tsc -p tsconfig.web.json --noEmit` PASS (impls not yet registered, but resolution is by key — compiles). Run `npx vitest run` — the explorer's existing unit tests may now need the keys registered; if a test constructs the service, register fakes in the test. Fix those tests.

- [ ] **Step 6: Commit** — `git commit -am "refactor(explorer): resolve feature capabilities via core interfaces"`

### Task C2: The two non-DI cleanups

**File:** same service file.

- [ ] **Step 1: `isTodlProject` → capability guard.** Replace `import { isTodlProject } ...` + its uses (`updateAgentMetadata`, the `UpdateAgentMetadataCommand` guard) with a local guard:

```ts
function supportsScaffold(f: IProjectFactory): f is IProjectFactory & { updateScaffold(s: IStorage): Promise<readonly string[]> } {
  return typeof (f as { updateScaffold?: unknown }).updateScaffold === 'function'
}
```

- [ ] **Step 2: `CodeDocument` instanceof → duck-type.** In `FindOpenCodeDocByOsPath` (lines ~172-183) replace `doc instanceof CodeDocument` with a guard mirroring `isRevealable`:

```ts
function isReloadable(doc: unknown): doc is { IsDirty: boolean; Reload(): Promise<void> } {
  const d = doc as Partial<{ IsDirty: boolean; Reload: unknown }>
  return typeof d?.Reload === 'function'
}
```
Return type of `FindOpenCodeDocByOsPath` becomes that structural type; update the one consumer (`editor-reload-service.ts`, which calls `.IsDirty`/`.Reload()` — already structural). Delete the `CodeDocument` import.

- [ ] **Step 3: `implements IProjectTreeHost`** — add to the class declaration (members already exist: `OpenProjects`, `OwnerOf`, `ApplyTreeSelection`, `AddRevealListener`).

- [ ] **Step 4: Verify** — `cd apps/plexus && npx tsc -p tsconfig.web.json --noEmit` PASS; `grep` the service file for any `modules/` or `services/` app import — expected: only core + generic-infra imports remain.

- [ ] **Step 5: Commit** — `git commit -am "refactor(explorer): duck-type CodeDocument + factory scaffold guard; drop last app imports"`

---

## Phase D — Register the impls app-side

Provide each core interface from `apps/plexus` via the existing `Impl -> Key` alias in `app.mu`. Two impls are thin new adapters; the rest are alias-registrations of existing services.

### Task D1: Adapter impls (PublishedBases, DiagramTreeExport, ProjectMenuSource)

**Files:** Create under `apps/plexus/src/renderer/src/modules/.../` (co-located with the feature they wrap):
- `modules/meta-model/services/published-bases.ts` — `class PublishedBases implements IPublishedBases` wrapping `ensureMetaModelsBackend`/`ensureLibrariesBackend` (move the enumeration logic from the old `publishedMetaModels`/`publishedLibraries`).
- `modules/diagram-export/services/diagram-tree-export.ts` — `class DiagramTreeExport implements IDiagramTreeExport` doing the old `exportNode` render+save (resolve `DiagramHeadlessRenderer`/`DiagramExportService` internally; map `DiagramExportFormat`→`ExportFormat`).
- `modules/skills/services/project-menu-source.ts` — `class SkillProjectMenuSource implements IProjectMenuSource` with the old `wireAgentSkillChoices` discovery/filter logic, returning `ProjectMenuChoice[]`.

- [ ] **Step 1:** Write each adapter (`ServiceBase`, ctor `IServiceProvider`, resolves its collaborators). Add a `tests/` unit test per adapter asserting it delegates (fake the wrapped services).
- [ ] **Step 2:** Verify — `cd apps/plexus && npx vitest run` PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat(plexus): app-side impls of PublishedBases/DiagramTreeExport/ProjectMenuSource"`

### Task D2: Register all impls in the composition root

CONFIRMED: mural's `.mu` `Impl -> Key` lowers to `register(Key, p => new Impl(p))` — a **fresh instance** under the alias token ([compiler.ts:3785]). So the alias form is correct only for services registered *solely* under the interface key (the 3 new adapters). Services already registered under their own token (the 4 shared ones) need an **instance-sharing** alias, which `.mu` can't express — register those **code-side** in `main.js`.

**Files:** Modify `apps/plexus/src/renderer/src/app.mu` (`.services:`) and `apps/plexus/src/main/index.ts` (or the renderer bootstrap `main.js` that holds `app`).

- [ ] **Step 1: New adapters via `.mu` alias** — in `app.mu` `.services:`, import each adapter + key and add:

```
PublishedBases         -> PublishedBasesKey
DiagramTreeExport      -> DiagramTreeExportKey
SkillProjectMenuSource -> ProjectMenuSourceKey
```
Each is registered only under its key ⇒ one instance. Correct.

- [ ] **Step 2: Shared services via code-side instance-sharing alias** — in the bootstrap that owns `app`, after modules compose, register a factory that resolves the EXISTING singleton:

```ts
import { LiveValidationKey, BaseResolverKey, ProblemsDockKey, ProjectTreeHostKey }
  from '@pragmatic-tech-ai/plexus-core/renderer/projects'
import { TodlLanguageClient } from '../renderer/src/services/todl/todl-language-client.js'
import { WorkspaceBaseResolver } from '../renderer/src/services/projects/... ' // core path after E
import { ProblemsService } from '../renderer/src/modules/problems/problems-service.js'
import { ProjectExplorerService } from '@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer' // after E

app.Services.register(LiveValidationKey,  p => p.getRequired(TodlLanguageClient.Key))
app.Services.register(BaseResolverKey,    p => p.getRequired(WorkspaceBaseResolver.Key))
app.Services.register(ProblemsDockKey,    p => p.getRequired(ProblemsService.Key))
app.Services.register(ProjectTreeHostKey, p => p.getRequired(ProjectExplorerService.Key))
```
The factory returns the same instance the class-token resolves — no duplicate LSP client / resolver / tree host. (`TodlLanguageClient`, `WorkspaceBaseResolver`, `ProblemsService` conform structurally to `ILiveValidation`/`IBaseResolver`/`IProblemsDock`; if a method name differs from the interface, add a thin adapter method or a tiny adapter class rather than renaming the service's public API.)

- [ ] **Step 3: Verify** — `cd apps/plexus && npx electron-vite build` PASS; launch smoke (`npx electron-vite dev`): open a project → tree; New Project pickers (PublishedBases); Export a diagram (DiagramTreeExport); Run Agent/Skill (ProjectMenuSource); Publish→Problems (ProblemsDock); tree drag/select (ProjectTreeHost). All work, no duplicate-instance symptoms.
- [ ] **Step 4: Commit** — `git commit -am "feat(plexus): register core capability impls (adapters + instance-sharing aliases)"`

---

## Phase E — Move the coupling-free service + module to core

### Task E1: Relocate the service + `.mu` module/resources

**Files — git mv to `packages/plexus-core/src/renderer/modules/project-explorer/`:**
- `project-explorer-service.ts`, `project-explorer.module.mu`, `project-explorer.resources.mu`, and the service's `tests/`.

- [ ] **Step 1:** git mv the four; fix intra-move imports (substrate/interfaces now core-relative `../../projects/...`; the `.mu` imports resolve to core-resident VMs). The `.resources.mu` imports (`OpenProject`, `ProjectNode`, dialog models, behaviors, `project-node-icon`, `shorten-path`, `NewItemChoice`, `ProjectMenuChoice`) are all core now.
- [ ] **Step 2:** Add `./renderer/modules/project-explorer` to core `exports` + `compile:mu` picks up the `.mu` automatically (globs `src/**/*.mu`).
- [ ] **Step 3: Verify** — `cd packages/plexus-core && npm run build` PASS (compiles the moved `.mu` + tsc).
- [ ] **Step 4: Commit** — `git commit -am "refactor(explorer): relocate the service + module .mu into plexus-core"`

### Task E2: Repoint reverse-dependency imports (~32 files)

**Files:** every `apps/plexus` file importing `ProjectExplorerService` / the moved substrate (see `git grep`).

- [ ] **Step 1:** Rewrite imports from `./modules/project-explorer/services/project-explorer-service.js` (and moved `services/projects/*`) to `@pragmatic-tech-ai/plexus-core/renderer/modules/project-explorer` / `@pragmatic-tech-ai/plexus-core/renderer/projects`. Batch via search/replace; `app.mu` imports too.
- [ ] **Step 2: Verify** — `cd apps/plexus && npx tsc -p tsconfig.web.json --noEmit` PASS; `npx electron-vite build` PASS.
- [ ] **Step 3: Commit** — `git commit -am "refactor: repoint project-explorer consumers to plexus-core"`

---

## Phase F — Verify end to end

### Task F1: Full build + suites + smoke

- [ ] **Step 1:** `cd packages/plexus-core && npm run build && npm test` — PASS.
- [ ] **Step 2:** `cd apps/plexus && npx vitest run` — PASS.
- [ ] **Step 3:** `cd apps/plexus && npx electron-vite build` — PASS.
- [ ] **Step 4:** e2e smoke: `cd apps/plexus && npx playwright test` (or a manual `dev` pass) — open/create/close a project, rename/delete/move a node, New Project with a meta-model + libraries, Export a diagram from the tree, Run Agent/Skill, Publish→Problems, Manage References. All behave as before.
- [ ] **Step 5:** Confirm the constraint: `cd packages/plexus-core && git grep -n "apps/plexus" src/` returns nothing; `grep '@pragmatic-tech-ai/todl"' package.json` absent (todl-runtime only).
- [ ] **Step 6: Commit** — `git commit -am "test: verify project-explorer move end to end"`

---

## Self-Review

**Spec coverage:** move manifest → Phase A2; injected interfaces → Phase B1 (all six) + contribution points kept as core `new-file-participant`/`node-command-contributor` (A2, rewritten as real interfaces in E1 cleanup if still bag-shaped); non-DI cleanups (`isTodlProject`, `CodeDocument`) → C2; registration → D2; reverse-dep repoint + exports/compile:mu → A6/E1/E2; todl-runtime-only constraint → F1 Step 5. Compiler change is out of scope per spec (independent).

**Placeholder scan:** relocation tasks (A2, E1, E2) are batched mechanical moves gated by `tsc`/build rather than per-file edits — legitimate for a rename refactor where the compiler is the exhaustive check; each names its exact file list and verification command.

**Type consistency:** `ProjectMenuChoice` (A1) is consumed by `IProjectMenuSource` (B1) and `OpenProject.ProjectMenuChoices` (A1); `DiagramExportFormat` defined in B1 and mapped in D1; interface method names match their call-site rewrites in C1. `IProjectTreeHost` members (A3) match the service members asserted in C2 Step 3.

**Open risk:** the `Impl -> Key` alias must share the existing singleton (D2 Step 1) — verify, else use an explicit factory alias.
