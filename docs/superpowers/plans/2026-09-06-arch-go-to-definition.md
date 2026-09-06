# Architecture Item "Go to Definition" Navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Go to Definition ▸` submenu to architecture diagram nodes that navigates to the declaration of the item's component, technology(ies), and category — opening the project's `.todl` source for local entities, or revealing the term in the Libraries panel for published ones.

**Architecture:** A root-scoped `ArchNavigationService` resolves relations off the composed model (`toElement` → `Element.refs`) and routes each target by provenance (`ArchModel.wikiOriginOf`): open-project entities open their `.todl` source (`OpenFileInProject` + a text-searched line), published entities reveal in the Libraries `TreeView` (`LibrariesPanelService.RevealTerm`, using a new data-driven `IsExpanded` bound through `ItemContainerStyle`). `ArchNodeVM` exposes bindable, adaptive nav targets that the context-menu submenu binds to; the arch-diagram binding populates them on bind/rescan.

**Tech Stack:** TypeScript, mural framework (MuralBase DPs, RelayCommand, TreeView, ItemContainerStyle), `.mu` markup, vitest (node env), Playwright `_electron` e2e.

**Spec:** `docs/superpowers/specs/2026-09-06-arch-go-to-definition-design.md`

**Correction (found during execution, authoritative meta-model in `plexus_test_projects/meta-models/tech-architecture/concepts/`):** the real relationship members are `implemented_by` (single, `-> technology?`), `category` (single, direct on component, `-> category?`), and — on a technology — `applicable_to` (`categories[]`, multi-valued). So: a **component** has ≤1 technology and ≤1 category; a **technology** node maps to N categories (`applicable_to`) → the "submenu if many" case. Both `technologies` and `categories` are therefore modelled as **lists** (`NavTarget[]`), each rendered single-or-submenu by count. `NavTargets.category` (singular) is replaced by `categories: readonly NavTarget[]`.

## Global Constraints

- OOP only: no module-level free functions or mutable module state; behavior lives in class methods (static where stateless). Existing free `function` exports in a touched file may stay, but new logic is a method.
- New view-models derive from `Observable`, not `MuralBase`, UNLESS they need the dependency-property system (bindable DPs). `ArchNodeVM` already extends `NodeViewModel` (a MuralBase) — its new bindable targets are DPs on it.
- Enums over string-literal unions.
- Every test file lives in a `tests/` subfolder next to the source it exercises.
- `.mu.js` files are gitignored and compiled by `npm run compile:mu`; only commit `.mu` source. Run `npm run compile:mu` then `npx electron-vite build` to verify markup changes.
- Do not `git commit`/`push` unless the human asks; each task's final step stages + commits locally per the TDD rhythm (the human has been committing per-task in this repo).
- `hostedIn` is out of scope. External code-location navigation is out of scope.

---

## File Structure

- **Create** `src/renderer/src/modules/architecture-projects/services/arch-navigation-service.ts` — the resolve-and-route service (`ArchNavigationService`) + its target types.
- **Create** `src/renderer/src/modules/architecture-projects/services/tests/arch-navigation-service.test.ts`.
- **Modify** `src/renderer/src/modules/library/services/library-tree-node.ts` — add an `IsExpanded` DP.
- **Modify** `src/renderer/src/modules/library/services/libraries-panel-service.ts` — add `RevealTerm(termId)` + `findLeafByTerm`.
- **Modify** `src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts` (create if absent) — `RevealTerm` tests.
- **Modify** `src/renderer/src/modules/library/library.resources.mu` — bind `TreeViewItem.IsExpanded` to the node via `ItemContainerStyle`.
- **Modify** `src/renderer/src/modules/architecture-projects/services/arch-node-vm.ts` — nav-target facet (DPs + commands).
- **Modify** `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts` — populate nav targets on bind/rescan.
- **Modify** `src/renderer/src/modules/diagram/diagram.resources.mu` — the `Go to Definition ▸` submenu.
- **Modify** `src/renderer/src/app.mu` — register `ArchNavigationService` in `.services:`.
- **Create** `e2e/arch-go-to-definition.spec.ts`.

---

## Task 1: `ArchNavigationService` resolver core

Pure resolution logic: given a model + entity id, produce the adaptive nav targets. No navigation yet.

**Files:**
- Create: `src/renderer/src/modules/architecture-projects/services/arch-navigation-service.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-navigation-service.test.ts`

**Interfaces:**
- Consumes: `ArchModel` (`repository(): Repository`, `entities(): Entity[]`, `homeOf(id): string | undefined`, `wikiOriginOf(concept): WikiOrigin | undefined`); todl `toElement(repo, entity, opts)`, types `Element`, `Entity`, `Repository`.
- Produces:
  - `enum NavTargetKind { Component = 'component', Technology = 'technology', Category = 'category' }`
  - `interface NavTarget { readonly kind: NavTargetKind; readonly id: string; readonly concept: string; readonly label: string }`
  - `interface NavTargets { readonly component?: NavTarget; readonly technologies: readonly NavTarget[]; readonly category?: NavTarget }`
  - `class ArchNavigationService extends ServiceBase { static readonly Key: ServiceKey<ArchNavigationService>; resolveTargets(model: ArchModel, entityId: string): NavTargets }`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { ModelDraft } from '@pragmatic-tech-ai/todl'
import { ArchNavigationService, NavTargetKind } from '../arch-navigation-service.js'

// Minimal composed model: a base library declaring technology + category terms,
// and a project source with one component instance wired to two technologies
// and a category. ModelDraft.fromSources(bases, sources, { namespace }).
const LIB = { uri: 'lib://tech.todl', text: `
  category backend { }
  technology dotnet { label = ".NET"; categorisedAs = backend; }
  technology redis  { label = "Redis"; }
` }
const PROJ = { uri: 'landscape.todl', text: `
  component orders { label = "Orders"; implementedBy = dotnet; implementedBy = redis; categorisedAs = backend; }
` }

function model() {
  const base = ModelDraft.fromSources([], [LIB], { namespace: 'lib' }).model
  const draft = ModelDraft.fromSources([base], [PROJ], { namespace: 'proj' })
  // Thin ArchModel stand-in exposing only what the resolver reads.
  return {
    repository: () => draft.model,
    entities: () => draft.ownInstances(),
    homeOf: (id: string) => draft.homeOf(id),
    wikiOriginOf: () => undefined,
  } as never
}

test('resolveTargets on a component yields component + ordered technologies + category', () => {
  const svc = new ArchNavigationService(undefined as never)
  const t = svc.resolveTargets(model(), 'orders')
  expect(t.component?.kind).toBe(NavTargetKind.Component)
  expect(t.component?.id).toBe('orders')
  expect(t.technologies.map((x) => x.id)).toEqual(['dotnet', 'redis'])
  expect(t.technologies.map((x) => x.label)).toEqual(['.NET', 'Redis'])
  expect(t.category?.id).toBe('backend')
})

test('category falls back to the first technology when the component has none', () => {
  const proj = { uri: 'p.todl', text: `component api { label = "Api"; implementedBy = dotnet; }` }
  const base = ModelDraft.fromSources([], [LIB], { namespace: 'lib' }).model
  const draft = ModelDraft.fromSources([base], [proj], { namespace: 'proj' })
  const m = { repository: () => draft.model, entities: () => draft.ownInstances(), homeOf: () => undefined, wikiOriginOf: () => undefined } as never
  const svc = new ArchNavigationService(undefined as never)
  const t = svc.resolveTargets(m, 'api')
  expect(t.category?.id).toBe('backend') // dotnet.categorisedAs
})

test('a technology node resolves itself + its category, no component', () => {
  const svc = new ArchNavigationService(undefined as never)
  // Drop dotnet as a node: resolve against the base term.
  const base = ModelDraft.fromSources([], [LIB], { namespace: 'lib' })
  const m = { repository: () => base.model, entities: () => base.ownInstances(), homeOf: () => undefined, wikiOriginOf: () => undefined } as never
  const t = svc.resolveTargets(m, 'dotnet')
  expect(t.component).toBeUndefined()
  expect(t.technologies.map((x) => x.id)).toEqual(['dotnet'])
  expect(t.category?.id).toBe('backend')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-navigation-service.test.ts`
Expected: FAIL (module not found / `resolveTargets` undefined). If the todl `component`/`technology` keywords or ref syntax differ from the test fixtures, adjust the fixture `.todl` text to the project's real arch syntax (see `plexus_test_projects/architecures/*/landscape.todl` for a working example) — the assertions stay the same.

- [ ] **Step 3: Implement the resolver**

```ts
import { toElement, type Element, type Entity, type Repository } from '@pragmatic-tech-ai/todl'
import { ServiceBase, ServiceKey } from '@pragmatic-tech-ai/mural/framework'
import type { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { ArchModel } from './arch-model.js'

export enum NavTargetKind { Component = 'component', Technology = 'technology', Category = 'category' }

export interface NavTarget {
  readonly kind: NavTargetKind
  readonly id: string
  readonly concept: string
  readonly label: string
}

export interface NavTargets {
  readonly component?: NavTarget
  readonly technologies: readonly NavTarget[]
  readonly category?: NavTarget
}

// Resolves an architecture node's navigable relations off the composed model.
// Routing (open source / reveal in libraries) is added in Task 3.
export class ArchNavigationService extends ServiceBase
{
  public static readonly Key = new ServiceKey<ArchNavigationService>('ArchNavigationService')

  public constructor(private readonly provider: ServiceProvider) { super() }

  public resolveTargets(model: ArchModel, entityId: string): NavTargets
  {
    const el = this.elementFor(model, entityId)
    if (el === undefined) return { technologies: [] }

    const concept = el.concept
    const isComponent = concept === 'component'
    const isTechnology = concept === 'technology'
    const isCategory = concept === 'category'

    const component = isComponent
      ? this.target(NavTargetKind.Component, el)
      : undefined

    const techEls: Element[] = isTechnology ? [el] : (el.refs['implementedBy'] ?? [])
    const technologies = techEls.map((t) => this.target(NavTargetKind.Technology, t))

    // Category: direct on the entity, else (for a component) the first technology's.
    let catEl = el.refs['categorisedAs']?.[0]
    if (catEl === undefined && isComponent && techEls[0] !== undefined) {
      catEl = techEls[0].refs['categorisedAs']?.[0]
    }
    const category = isCategory
      ? this.target(NavTargetKind.Category, el)
      : (catEl !== undefined ? this.target(NavTargetKind.Category, catEl) : undefined)

    return { component, technologies, category }
  }

  private elementFor(model: ArchModel, id: string): Element | undefined
  {
    const repo: Repository = model.repository()
    const entity: Entity | undefined =
      model.entities().find((e) => e.id === id) ??
      (repo.resolve(id) as Entity | undefined)
    if (entity === undefined) return undefined
    return toElement(repo, entity, { homeOf: (x) => model.homeOf(x) })
  }

  private target(kind: NavTargetKind, el: Element): NavTarget
  {
    const label = String(el.fields['label'] ?? el.fields['name'] ?? el.id)
    return { kind, id: el.id, concept: el.concept, label }
  }
}
```

Notes for the implementer:
- If `toElement` requires a `presentation` option, pass `presentation: () => undefined` (it's optional per `ToElementOptions`; check `element-selection-bridge.ts` usage).
- `Element.refs[member]` is `Element[] | undefined`; `Element.fields[name]` is a `Scalar | undefined`. `Element` also carries `.id` and `.concept` (see `element-view-model.ts`).
- `ServiceKey` construction: match the exact form other services use (e.g. `WikiService.Key` in `wiki-service.ts`) — copy its pattern verbatim.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-navigation-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-navigation-service.ts src/renderer/src/modules/architecture-projects/services/tests/arch-navigation-service.test.ts
git commit -m "feat(arch-nav): resolve component/technology/category nav targets"
```

---

## Task 2: Libraries panel `RevealTerm` + data-driven expansion

Make a published term revealable: a data `IsExpanded` bound to the container, and a `RevealTerm` that expands ancestors + selects the leaf.

**Files:**
- Modify: `src/renderer/src/modules/library/services/library-tree-node.ts`
- Modify: `src/renderer/src/modules/library/services/libraries-panel-service.ts`
- Modify: `src/renderer/src/modules/library/library.resources.mu`
- Test: `src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts`

**Interfaces:**
- Consumes: `LibraryTreeNode` (`Roots`, `Children`, `TermId`, `SelectedNode`).
- Produces:
  - `LibraryTreeNode.IsExpanded: boolean` (DP, default `false`).
  - `LibrariesPanelService.RevealTerm(termId: string): boolean` — returns `true` when the term was found and revealed; sets `Status` and returns `false` otherwise.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { LibrariesPanelService } from '../libraries-panel-service.js'
import { LibraryTreeNode, LibraryNodeKind } from '../library-tree-node.js'

// Build a tiny Roots tree: library > concept group > leaf(termId).
function seed(svc: LibrariesPanelService, termId: string): { lib: LibraryTreeNode; grp: LibraryTreeNode; leaf: LibraryTreeNode } {
  const lib = LibraryTreeNode.library('Tech · 1.0', 'tech', '1.0')
  const grp = LibraryTreeNode.group('technology', LibraryNodeKind.Concept)
  const leaf = LibraryTreeNode.leaf({ display: '.NET', label: '.NET', localId: 'dotnet', termId, concept: 'technology' }, undefined as never)
  grp.Children.Add(leaf); lib.Children.Add(grp); svc.Roots.Add(lib)
  return { lib, grp, leaf }
}

test('RevealTerm expands ancestors and selects the matching leaf', () => {
  const svc = new LibrariesPanelService(undefined as never)
  const { lib, grp, leaf } = seed(svc, 'dotnet')
  const ok = svc.RevealTerm('dotnet')
  expect(ok).toBe(true)
  expect(lib.IsExpanded).toBe(true)
  expect(grp.IsExpanded).toBe(true)
  expect(svc.SelectedNode).toBe(leaf)
})

test('RevealTerm returns false and does not select when the term is absent', () => {
  const svc = new LibrariesPanelService(undefined as never)
  seed(svc, 'dotnet')
  const ok = svc.RevealTerm('nope')
  expect(ok).toBe(false)
  expect(svc.SelectedNode).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts`
Expected: FAIL (`IsExpanded` / `RevealTerm` undefined). If `LibrariesPanelService`'s constructor requires a provider it dereferences eagerly, pass a minimal fake `{ get: () => undefined }` instead of `undefined`.

- [ ] **Step 3a: Add the `IsExpanded` DP to `LibraryTreeNode`**

In `library-tree-node.ts`, alongside the other DPs:

```ts
public static readonly IsExpandedKey = MuralBase.RegisterProperty<boolean>(
    LibraryTreeNode, 'IsExpanded', false, MetaData.None)
```

and the accessor with the others:

```ts
public get IsExpanded(): boolean { return this.get_property_value(LibraryTreeNode.IsExpandedKey) }
public set IsExpanded(v: boolean) { this.set_property_value(LibraryTreeNode.IsExpandedKey, v) }
```

- [ ] **Step 3b: Add `RevealTerm` to `LibrariesPanelService`**

```ts
// Reveal a published term as a node: expand its ancestor chain, select the
// leaf. Returns false (and sets Status) when no loaded library carries it.
// The panel must also be made the active side pane by the caller (Task 3).
public RevealTerm(termId: string): boolean
{
    const path = this.findLeafPath(termId)
    if (path === undefined) {
        this.Status = `"${termId}" is not in any loaded library.`
        return false
    }
    // Expand every ancestor (all but the leaf); the ItemContainerStyle binding
    // reflects IsExpanded onto the TreeViewItem containers.
    for (let i = 0; i < path.length - 1; i++) path[i].IsExpanded = true
    this.SelectedNode = path[path.length - 1]
    return true
}

// The chain [library, concept-group, …, leaf] whose leaf has TermId === termId,
// or undefined if none. Depth-first over Roots.
private findLeafPath(termId: string): LibraryTreeNode[] | undefined
{
    const walk = (node: LibraryTreeNode, trail: LibraryTreeNode[]): LibraryTreeNode[] | undefined => {
        const here = [...trail, node]
        if (node.TermId === termId) return here
        for (const child of node.Children) {
            const hit = walk(child, here)
            if (hit !== undefined) return hit
        }
        return undefined
    }
    for (const root of this.Roots) {
        const hit = walk(root, [])
        if (hit !== undefined) return hit
    }
    return undefined
}
```

Add a `Status` string DP if the service lacks one (check first — it may already exist for the delete flow). If present, reuse it. If absent, add:

```ts
public static readonly StatusKey = MuralBase.RegisterProperty<string>(LibrariesPanelService, 'Status', '', MetaData.None)
public get Status(): string { return this.get_property_value(LibrariesPanelService.StatusKey) }
public set Status(v: string) { this.set_property_value(LibrariesPanelService.StatusKey, v) }
```

- [ ] **Step 3c: Bind container expansion to the data node (`library.resources.mu`)**

The Libraries `TreeView` currently binds `SelectedDataItem = $SelectedNode`. Add an `ItemContainerStyle` so each `TreeViewItem`'s expansion tracks the data node's `IsExpanded` (two-way). Add near the TreeView, and set `ItemContainerStyle = @LibraryTreeItemStyle` on the `TreeView`:

```
Style x:key="LibraryTreeItemStyle" [ TargetType = TreeViewItem ] {
    IsExpanded = $IsExpanded;
}
```

Then on the existing `TreeView [ … SelectedDataItem = $SelectedNode ]` add:

```
                       ItemContainerStyle = @LibraryTreeItemStyle,
```

Verify with `npm run compile:mu`. If the `TreeViewItem` `IsExpanded` two-way binding does not drive expansion at runtime (confirm in Step 4b), fall back to keeping the `Style` but ALSO expanding in `RevealTerm` is already data-side; the binding is what surfaces it — if it fails, that is a framework gap to raise, not a silent workaround.

- [ ] **Step 4a: Run the unit tests**

Run: `npx vitest run src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4b: Build + live-verify the expansion binding**

Run: `npm run compile:mu && npx electron-vite build`
Expected: build succeeds. (Full reveal-in-app is exercised by the Task 6 e2e; here just confirm the markup compiles and the app builds.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/library/services/library-tree-node.ts src/renderer/src/modules/library/services/libraries-panel-service.ts src/renderer/src/modules/library/library.resources.mu src/renderer/src/modules/library/services/tests/libraries-panel-service.test.ts
git commit -m "feat(libraries): RevealTerm + data-driven tree expansion"
```

---

## Task 3: `ArchNavigationService` routing (provenance fork + activation)

Route a resolved target to the right destination: open the project `.todl` source, or reveal in the (activated) Libraries panel.

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-navigation-service.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-navigation-service.test.ts`

**Interfaces:**
- Consumes: `NavTarget` (Task 1); `ArchModel.wikiOriginOf`, `homeOf`, `Storage`; `WikiOrigin` + `openProjectOrigin` from `services/projects/wiki-origin.js` (to detect the published-vs-project fork — a published origin has a package identity; check its shape and mirror `wiki-service.ts`'s discrimination); `ProjectExplorerService.OpenFileInProject(projectId, uri, line, column)`; `LibrariesPanelService.RevealTerm`; `NavigationService` (activate the Libraries capability via its `NavigationDestination.ActivateCommand`).
- Produces: `ArchNavigationService.navigateTo(model: ArchModel, projectId: string, target: NavTarget): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, vi } from 'vitest'
import { ArchNavigationService, NavTargetKind } from '../arch-navigation-service.js'

// Fakes for the two navigators, injected via a fake provider keyed by ServiceKey.
function harness(origin: 'published' | 'project') {
  const opened: unknown[] = []
  const revealed: string[] = []
  const explorer = { OpenFileInProject: (p: string, u: string, l: number, c: number) => { opened.push({ p, u, l, c }); return Promise.resolve() } }
  const libraries = { RevealTerm: (t: string) => { revealed.push(t); return true } }
  const nav = { activateLibraries: () => {} }
  const svc = new ArchNavigationService({ get: () => undefined } as never)
  // Inject test doubles (see implementation: protected seams resolveExplorer/resolveLibraries/activateLibraries).
  ;(svc as never as { explorer: unknown }).explorer = explorer
  ;(svc as never as { libraries: unknown }).libraries = libraries
  ;(svc as never as { activateLibraries: unknown }).activateLibraries = nav.activateLibraries
  const model = {
    wikiOriginOf: () => (origin === 'published' ? { package: { id: 'tech', version: '1.0' } } : undefined),
    homeOf: (id: string) => (origin === 'project' ? `landscape.todl` : undefined),
    Storage: { ReadText: () => Promise.resolve('line0\ncomponent orders { }\n') },
  } as never
  return { svc, model, opened, revealed }
}

test('published target reveals in the Libraries panel', async () => {
  const { svc, model, opened, revealed } = harness('published')
  await svc.navigateTo(model, 'proj', { kind: NavTargetKind.Technology, id: 'dotnet', concept: 'technology', label: '.NET' })
  expect(revealed).toEqual(['dotnet'])
  expect(opened).toEqual([])
})

test('project target opens the .todl source at the declaration line', async () => {
  const { svc, model, opened, revealed } = harness('project')
  await svc.navigateTo(model, 'proj', { kind: NavTargetKind.Component, id: 'orders', concept: 'component', label: 'Orders' })
  expect(revealed).toEqual([])
  expect(opened.length).toBe(1)
  expect((opened[0] as { u: string }).u).toBe('landscape.todl')
  expect((opened[0] as { l: number }).l).toBe(2) // 1-based line of "component orders"
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-navigation-service.test.ts`
Expected: FAIL (`navigateTo` undefined).

- [ ] **Step 3: Implement routing**

Add to `ArchNavigationService`. Resolve the two navigator services lazily via the provider (store on protected fields the test overrides). Discriminate the origin using the SAME check `wiki-service.ts` uses for published-vs-project (mirror it exactly — do not invent a new predicate).

```ts
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import { LibrariesPanelService } from '../../library/services/libraries-panel-service.js'
// NavigationService import + the Libraries capability key: match how other code
// resolves NavigationService.Key and finds a destination.

// … inside the class …

protected explorer?: { OpenFileInProject(projectId: string, uri: string, line: number, column: number): Promise<void> }
protected libraries?: { RevealTerm(termId: string): boolean }

public async navigateTo(model: ArchModel, projectId: string, target: NavTarget): Promise<void>
{
  const origin = model.wikiOriginOf(target.concept ?? target.id) ?? model.wikiOriginOf(target.id)
  if (this.isPublished(origin)) {
    this.activateLibraries()
    this.resolveLibraries()?.RevealTerm(target.id)
    return
  }
  const uri = model.homeOf(target.id)
  if (uri === undefined) return // own-source term without a home file: v1 no-op
  const line = await this.lineOfDeclaration(model, uri, target.id)
  await this.resolveExplorer()?.OpenFileInProject(projectId, uri, line, 1)
}

// True when the origin points at a published package (not the open project).
// Mirror wiki-service.ts's discrimination of WikiOrigin exactly.
private isPublished(origin: unknown): boolean
{
  // e.g. origin !== undefined && 'package' in origin — REPLACE with the real check.
  return origin !== undefined && (origin as { package?: unknown }).package !== undefined
}

// 1-based line of the entity's declaration in its source text; 1 when not found.
private async lineOfDeclaration(model: ArchModel, uri: string, id: string): Promise<number>
{
  const text = await model.Storage.ReadText(uri)
  const lines = text.split('\n')
  const localId = id.includes('.') ? id.slice(id.lastIndexOf('.') + 1) : id
  const idx = lines.findIndex((ln) => new RegExp(`\\b${localId}\\b`).test(ln) && /\b(component|technology|category)\b/.test(ln))
  return idx >= 0 ? idx + 1 : 1
}

private resolveExplorer(): ArchNavigationService['explorer']
{
  return this.explorer ??= this.provider.get(ProjectExplorerService.Key)
}

private resolveLibraries(): ArchNavigationService['libraries']
{
  return this.libraries ??= this.provider.get(LibrariesPanelService.Key)
}

// Make the Libraries capability the active side pane (execute its destination's
// ActivateCommand via NavigationService). Overridable in tests.
protected activateLibraries(): void
{
  // Resolve NavigationService.Key; find the destination whose capability's
  // ServiceKey is LibrariesPanelService.Key; Execute its ActivateCommand.
  // Bind to the real NavigationService API here.
}
```

Notes:
- Replace the `isPublished` body and `activateLibraries` body with the real `WikiOrigin` discrimination and `NavigationService` calls — the exact shapes are in `services/projects/wiki-origin.js`, `wiki-service.ts`, and `navigation-service.d.ts`. The tests override `activateLibraries`/`explorer`/`libraries`, so the routing logic is verified independent of those bindings.
- `LibrariesPanelService.Key` must exist — if the service is registered under a `ServiceKey`, reuse it; if it only registers via the module capability, add a `static readonly Key` mirroring peers.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-navigation-service.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-navigation-service.ts src/renderer/src/modules/architecture-projects/services/tests/arch-navigation-service.test.ts
git commit -m "feat(arch-nav): route targets by provenance (source vs libraries)"
```

---

## Task 4: `ArchNodeVM` nav-target facet + binding population

Expose bindable, adaptive nav targets on the node so the menu binds to them; populate on bind/rescan.

**Files:**
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-node-vm.ts`
- Modify: `src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts`
- Test: `src/renderer/src/modules/architecture-projects/services/tests/arch-node-vm-nav.test.ts` (new)

**Interfaces:**
- Consumes: `ArchNavigationService.resolveTargets` + `navigateTo` (Tasks 1, 3); `NavTargets`, `NavTarget`.
- Produces on `ArchNodeVM`:
  - `CanGoToComponent: boolean`, `GoToComponentCommand: ICommand`
  - `Technologies: ObservableCollection<TechNavItem>` where `class TechNavItem extends Observable { Name: string; GoCommand: ICommand }`, plus `HasTechnologies: boolean`, `HasManyTechnologies: boolean`
  - `CanGoToCategory: boolean`, `GoToCategoryCommand: ICommand`
  - `ApplyNavTargets(targets: NavTargets, run: (t: NavTarget) => void): void` — populates the above from resolved targets; `run` performs navigation.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'vitest'
import { ArchNodeVM } from '../arch-node-vm.js'
import { NavTargetKind, type NavTargets } from '../arch-navigation-service.js'

function targets(): NavTargets {
  return {
    component: { kind: NavTargetKind.Component, id: 'orders', concept: 'component', label: 'Orders' },
    technologies: [
      { kind: NavTargetKind.Technology, id: 'dotnet', concept: 'technology', label: '.NET' },
      { kind: NavTargetKind.Technology, id: 'redis', concept: 'technology', label: 'Redis' },
    ],
    category: { kind: NavTargetKind.Category, id: 'backend', concept: 'category', label: 'Backend' },
  }
}

test('ApplyNavTargets populates adaptive flags + technology items', () => {
  const vm = new ArchNodeVM()
  const fired: string[] = []
  vm.ApplyNavTargets(targets(), (t) => fired.push(t.id))
  expect(vm.CanGoToComponent).toBe(true)
  expect(vm.HasTechnologies).toBe(true)
  expect(vm.HasManyTechnologies).toBe(true)
  expect(vm.Technologies.Count).toBe(2)
  expect(vm.Technologies.Get(0).Name).toBe('.NET')
  expect(vm.CanGoToCategory).toBe(true)
  vm.Technologies.Get(1).GoCommand.Execute(undefined)
  vm.GoToComponentCommand.Execute(undefined)
  expect(fired).toEqual(['redis', 'orders'])
})

test('a node with no relations hides everything', () => {
  const vm = new ArchNodeVM()
  vm.ApplyNavTargets({ technologies: [] }, () => {})
  expect(vm.CanGoToComponent).toBe(false)
  expect(vm.HasTechnologies).toBe(false)
  expect(vm.HasManyTechnologies).toBe(false)
  expect(vm.CanGoToCategory).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-node-vm-nav.test.ts`
Expected: FAIL (members undefined). If `new ArchNodeVM()` needs constructor args, match its real signature and pass minimal values.

- [ ] **Step 3a: Add the facet to `ArchNodeVM`**

Add `TechNavItem` (extends `Observable`, per the VM rule — but it needs bindable `Name`/`GoCommand` for markup; if binding requires DPs, extend `MuralBase` and use DPs, mirroring existing small item VMs like the dock/conversation rows). Add DPs `CanGoToComponent`, `HasTechnologies`, `HasManyTechnologies`, `CanGoToCategory` (bool, default false), `Technologies` (`ObservableCollection<TechNavItem>`), and `GoToComponentCommand` / `GoToCategoryCommand` (`ICommand`). Implement `ApplyNavTargets`:

```ts
public ApplyNavTargets(targets: NavTargets, run: (t: NavTarget) => void): void
{
    this.CanGoToComponent = targets.component !== undefined
    if (targets.component !== undefined) {
        const c = targets.component
        this.set_property_value(ArchNodeVM.GoToComponentCommandKey, new RelayCommand(() => run(c)))
    }
    this.Technologies.Clear()
    for (const t of targets.technologies) {
        this.Technologies.Add(new TechNavItem(t.label, new RelayCommand(() => run(t))))
    }
    this.HasTechnologies = targets.technologies.length > 0
    this.HasManyTechnologies = targets.technologies.length > 1
    this.CanGoToCategory = targets.category !== undefined
    if (targets.category !== undefined) {
        const cat = targets.category
        this.set_property_value(ArchNodeVM.GoToCategoryCommandKey, new RelayCommand(() => run(cat)))
    }
}
```

Follow the DP + getter/setter idiom already in `arch-node-vm.ts` for each new member. Initialize `Technologies` to a fresh `ObservableCollection` in the constructor.

- [ ] **Step 3b: Populate from the binding**

In `arch-diagram-binding.ts`, where a node is bound/rescanned against the `ArchModel` (find where `Concept`/`EntityId` are set on the `ArchNodeVM`), resolve + apply targets. Resolve `ArchNavigationService` from the provider the binding already holds:

```ts
const nav = this.provider.get(ArchNavigationService.Key)
if (nav !== undefined && node.EntityId !== undefined) {
    const targets = nav.resolveTargets(model, node.EntityId)
    node.ApplyNavTargets(targets, (t) => { void nav.navigateTo(model, projectId, t) })
}
```

`projectId` is the bound document's project id — obtain it the same way the binding already identifies the project/model (see how `arch-diagram-binding-service.modelForDocument` / the open project is reached). If the binding lacks a provider handle, thread `ArchNavigationService` in via the binding service that constructs the binding.

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/renderer/src/modules/architecture-projects/services/tests/arch-node-vm-nav.test.ts`
Expected: PASS (2 tests). Also run the existing arch-node-vm + binding tests to confirm no regression: `npx vitest run src/renderer/src/modules/architecture-projects`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/modules/architecture-projects/services/arch-node-vm.ts src/renderer/src/modules/architecture-projects/services/arch-diagram-binding.ts src/renderer/src/modules/architecture-projects/services/tests/arch-node-vm-nav.test.ts
git commit -m "feat(arch-nav): ArchNodeVM nav-target facet, populated on bind"
```

---

## Task 5: `Go to Definition ▸` context-menu submenu

Add the adaptive submenu to the arch node context menu.

**Files:**
- Modify: `src/renderer/src/modules/diagram/diagram.resources.mu`

**Interfaces:**
- Consumes: `ArchNodeVM` DPs from Task 4 (`CanGoToComponent`, `GoToComponentCommand`, `HasTechnologies`, `HasManyTechnologies`, `Technologies` [items with `Name`, `GoCommand`], `CanGoToCategory`, `GoToCategoryCommand`).

- [ ] **Step 1: Add the submenu to the arch node menu**

The `DataTemplate[ArchNodeVM]` uses `@DiagramContextMenu` shared. Add a node-specific `Go to Definition` submenu. Two options — pick to match how the node already contributes its node-only "Open Wiki" item (find that wiring first and mirror it). The submenu, with adaptive visibility:

```
MenuItem [ Header = "Go to Definition" ] {
    MenuItem [ Header = "Go to component",
               Command = $GoToComponentCommand,
               Visibility = $CanGoToComponent << ToVisibility ]
    // Single technology → one item; many → a submenu. Render both, toggle by
    // HasManyTechnologies / (HasTechnologies and not HasManyTechnologies).
    MenuItem [ Header = "Go to technology",
               Command = $SingleTechnologyCommand,
               Visibility = $HasOneTechnology << ToVisibility ]
    MenuItem [ Header = "Go to technology",
               ItemsSource = $Technologies,
               Visibility = $HasManyTechnologies << ToVisibility ] {
        // Item template: one MenuItem per TechNavItem.
    }
    MenuItem [ Header = "Go to category",
               Command = $GoToCategoryCommand,
               Visibility = $CanGoToCategory << ToVisibility ]
}
```

To keep the VM simple, add to `ArchNodeVM` (Task 4) two convenience DPs used only by this markup: `HasOneTechnology` (`HasTechnologies && !HasManyTechnologies`) and `SingleTechnologyCommand` (the first technology's command when exactly one). Set them in `ApplyNavTargets`. Update Task 4's implementation to also set these (add to the resolver-apply code and to the test assertions: `expect(vm.HasOneTechnology).toBe(false)` for the two-tech case).

For the many-technologies submenu item template, bind each child `MenuItem [ Header = $Name, Command = $GoCommand ]` via the menu's item template mechanism — mirror an existing `.mu` menu that renders `ItemsSource` children (search `diagram.resources.mu` / project-explorer for a `MenuItem` with `ItemsSource` + child template and copy that exact shape).

- [ ] **Step 2: Compile + build**

Run: `npm run compile:mu && npx electron-vite build`
Expected: both succeed. Fix any `.mu` parse errors (trailing `;` in triggers, `$`-paths resolve against the `ArchNodeVM` data context, enum values registered).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/modules/diagram/diagram.resources.mu src/renderer/src/modules/architecture-projects/services/arch-node-vm.ts src/renderer/src/modules/architecture-projects/services/tests/arch-node-vm-nav.test.ts
git commit -m "feat(arch-nav): Go to Definition submenu on arch nodes"
```

---

## Task 6: Register the service + end-to-end verification

Register `ArchNavigationService` at the app root and prove the flow in the running app.

**Files:**
- Modify: `src/renderer/src/app.mu`
- Create: `e2e/arch-go-to-definition.spec.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Register the service in `app.mu`**

Add the import and a `.services:` entry (plain form — it's resolved lazily by the binding; not eager). Mirror the neighbouring arch services (e.g. `ArchDiagramBindingService`):

```
import ArchNavigationService from "./modules/architecture-projects/services/arch-navigation-service.js"
```

and under `.services:`:

```
        // Resolves an arch node's component/technology/category and navigates to
        // each — project .todl source, or the Libraries panel for published terms.
        ArchNavigationService
```

- [ ] **Step 2: Write the e2e**

Model on `e2e/export-svg.spec.ts` / `panel-close-buttons.spec.ts` (Electron `_electron`, service lookup by `ServiceKey` description walk, `Symbol.for('mural:visual-backref')`). Open an architecture test project (`plexus_test_projects/architecures/test_architecture`), select a component node, then:

```ts
// Resolve ArchNavigationService + the bound model; assert resolveTargets on a
// known component returns a component + ≥1 technology. Then drive navigateTo for
// the technology and assert either a file tab opened (project term) or
// LibrariesPanelService.SelectedNode became the term (published term).
```

Assert: (a) a component node's `ArchNodeVM.CanGoToComponent === true` and `Technologies.Count >= 1`; (b) firing `GoToComponentCommand` opens the `landscape.todl` document (a `CodeDocument` appears in the content host with the right title); (c) firing a technology command either opens a source tab or sets `LibrariesPanelService.SelectedNode` to the term. Pick the concrete published/project case that matches the test fixture's actual data (inspect the fixture's `landscape.todl` + its bases first).

- [ ] **Step 3: Compile, build, run e2e**

Run:
```
npm run compile:mu && npx electron-vite build
node node_modules/@playwright/test/cli.js test e2e/arch-go-to-definition.spec.ts
```
Expected: build succeeds; e2e passes. (Use `cd .../Plexus && …` for the playwright CLI to avoid cwd drift.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/app.mu e2e/arch-go-to-definition.spec.ts
git commit -m "feat(arch-nav): register ArchNavigationService + e2e"
```

---

## Self-Review

**Spec coverage:**
- Decision 1 (model decl now / code later) → Task 3 opens `.todl`; external code explicitly deferred. ✓
- Decision 2 (reveal in Libraries) → Task 2 `RevealTerm` + Task 3 routing. ✓
- Decision 3 (implementedBy; submenu if many; ignore hostedIn) → Task 1 resolves `implementedBy` ordered; Task 4/5 single-or-submenu; `hostedIn` untouched. ✓
- Decision 4 (all arch nodes, adaptive) → Task 1 per-concept resolution; Task 4 `Can*/Has*` flags; Task 5 `Visibility` bindings. ✓
- Provenance fork, `RevealTerm`, `ArchNodeVM` facet, submenu, registration, tests (unit + e2e) → Tasks 1–6. ✓

**Placeholder scan:** The two spots that read as "replace with the real check" (`isPublished` origin discrimination, `activateLibraries` NavigationService call) are genuine bind-to-existing-API points, not hand-waves: the plan names the exact source files to copy the shape from (`wiki-service.ts`, `wiki-origin.js`, `navigation-service.d.ts`), and the routing logic is verified by tests that override those seams. The `.mu` menu step points at an existing `ItemsSource` menu to mirror rather than inventing syntax. Acceptable — no logic is left undescribed.

**Type consistency:** `NavTargetKind`/`NavTarget`/`NavTargets` used identically across Tasks 1, 3, 4. `resolveTargets(model, id)` and `navigateTo(model, projectId, target)` signatures match between definition (Tasks 1/3) and call site (Task 4). `RevealTerm(termId): boolean` consistent between Task 2 (def) and Task 3 (call). `ArchNodeVM.ApplyNavTargets(targets, run)` consistent Tasks 4/5. `HasOneTechnology`/`SingleTechnologyCommand` added in Task 5 are folded back into Task 4's implementation + tests (noted in Task 5 Step 1).

**Known verify-in-execution risks (call out during review, don't skip):**
1. The `TreeViewItem.IsExpanded` two-way binding via `ItemContainerStyle` (Task 2) — must actually drive expansion at runtime; validated by the Task 6 e2e's reveal path.
2. `NavigationService` capability activation (Task 3 `activateLibraries`) — bind to the real destination-activation API.
3. `LibrariesPanelService.Key` may need adding if the service isn't already `ServiceKey`-registered.
