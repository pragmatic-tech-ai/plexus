# P5a — References Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a project's declared references as an editable `References` branch (first child) under each resolved project row in the Solution Explorer, with full inline add/remove/set-version parity to the Manage References modal, plus resolved/live/unresolved decoration.

**Architecture:** Approach A — a `ProjectBranchesProvider` (composite `IHierarchyProvider`) owns the Project subtree, emits `References` as child[0] delegated to a `ReferencesProvider`, and delegates the file subtree to the existing `ProjectContentProvider`. Reads/mutations/refresh route through a new plexus-core `IReferenceView` seam implemented by `ProjectExplorerService` (reusing its manifest + `SolutionBaseResolver` access). No Mural framework and no TODL engine API changes.

**Tech Stack:** TypeScript, Mural hierarchy framework (`@pragmatic-tech-ai/mural/framework/hierarchy`), TODL solution-services (`@pragmatic-tech-ai/todl`), vitest (plexus-core unit), Playwright + Electron (e2e).

**Spec:** `docs/superpowers/specs/2026-09-30-solution-hierarchy-p5a-references-branch-design.md`

## Global Constraints

- **House style:** Allman braces; OOP (methods on classes, no module-level free functions/vars — the one allowed exception is an `is<X>` type-guard, as used in `file-tree-contributor.ts`); PascalCase for interfaces and public methods; enums over string-literal unions; no inline string literals (hoist reused/user-facing text to `private static readonly` constants); new VMs extend `Observable` not `MuralBase`.
- **Manifest-shaped types keep their serialized lowercase** (`BaseRef` = `{ id, version }`, `BaseBindings` = `{ metaModels?, libraries? }`). New non-serialized view types use PascalCase members.
- **No Mural or TODL source changes.** All code lands in `Plexus/packages/plexus-core` and `Plexus/apps/plexus`.
- **Test runners:** plexus-core unit — from `Plexus/packages/plexus-core`: `npx vitest run <path>`. e2e — from `Plexus/apps/plexus` after `npm run build` at repo root: `PLEXUS_TEST_CORPUS="C:/Users/Eugene/Projects/architecture-agent/plexus_test_projects" npx playwright test solution-explorer-references`.
- **Tests live in a `tests/` subfolder** next to the source (existing convention: `services/tests/*.test.ts`).
- **Every project type gates the branch:** the `References` node appears only for a resolved references-consumer member (`ReferencesViewFor` → not `undefined`).

## Review Focus

1. **Non-consumer project** — a project type binding no references shows *no* References node (`ReferencesViewFor` returns `undefined`), not an empty branch. → Task 3 test.
2. **Library project** — meta-models group only, no Libraries group (`OffersLibraries=false`); the written manifest omits `libraries`. → Task 3 test.
3. **Version-drift pin** — a declared version differing from the live workspace producer's version resolves `LiveWorkspace` by id (local-first), *not* `Unresolved`; the same drift against a published-only producer is `Unresolved`. → Task 3 test.
4. **Concurrent modal + tree edits** — both route through `writeReferences` and raise `OnReferencesViewChanged`; the provider re-fetches from disk each time, so the tree matches the manifest (last write wins, no stale in-memory delta). → Task 1 test (re-fetch on signal) + Task 3 test (modal routes through the tail).
5. **Empty available / versions submenus, multi-kind Remove** — Add with nothing addable and Set Version with only the current version render a disabled item, not an empty/crashing menu; multi-select Remove spanning kinds removes each from its correct list. → Task 4 tests.

---

## File Structure

**Create (plexus-core, `src/renderer/modules/solution-explorer/services/`):**
- `reference-view.ts` — `IReferenceView` seam + view types (`ReferenceResolution`, `DeclaredReference`, `MemberReferencesView`) + `ReferenceViewKey`.
- `reference-node-key.ts` — `ReferenceNodeKey` provider-scoped family (`Group`, `Leaf`).
- `references-provider.ts` — `ReferencesProvider` (`IHierarchyProvider` for the References subtree).
- `project-branches-provider.ts` — `ProjectBranchesProvider` (composite provider).
- `reference-actions-contributor.ts` — `ReferenceActionsContributor` (`IHierarchyActionContributor`).
- Tests under `services/tests/`: `references-provider.test.ts`, `project-branches-provider.test.ts`, `reference-actions-contributor.test.ts`.

**Modify (plexus-core):**
- `modules/project-explorer/services/project-explorer-service.ts` — implement `IReferenceView`; extract `writeReferences`; refactor `manageReferences` onto it.
- `modules/solution-explorer/services/file-tree-contributor.ts` — `SetReferenceView`; `Contribute` returns cached `ProjectBranchesProvider`.
- `modules/solution-explorer/services/solution-explorer-service.ts` — inject `IReferenceView` into `FileTreeContributor`; register `ReferenceActionsContributor`; `Delete` key-dispatch.
- `modules/solution-explorer/services/icon-key-to-geometry.ts` — `IconKeyGlyphs.For` cases for reference keys.
- `modules/solution-explorer/solution-explorer.resources.mu` — (no structural change; reference rows reuse existing templates. Verified only via e2e.)
- Tests: extend `project-explorer-service.test.ts`, `solution-explorer-service.test.ts`, `file-tree-contributor-actions.test.ts`, `icon-key-to-geometry.test.ts` (create if absent).

**Create (apps/plexus):**
- `e2e/solution-explorer-references.spec.ts`.

---

## Task 1: ReferencesProvider + view types + node key

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/reference-view.ts`
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/reference-node-key.ts`
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/references-provider.ts`
- Test: `packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/references-provider.test.ts`

**Interfaces:**
- Consumes: Mural `IHierarchyProvider`, `HierarchyItemId`, `HierarchyChange` (`ChildAdded`/`ChildRemoved`/`ChildUpdated`), `HierarchyNode`, `HierarchyPropertyId`, `NodeSeverity`, `NodeKey`; TODL `SolutionMember`, `ProjectType`, `Disposable`; plexus `BaseRef`.
- Produces:
  - `enum ReferenceResolution { Published, LiveWorkspace, Unresolved }`
  - `interface DeclaredReference { readonly Ref: BaseRef; readonly Resolution: ReferenceResolution }`
  - `interface MemberReferencesView { readonly OffersLibraries: boolean; readonly MetaModels: readonly DeclaredReference[]; readonly Libraries: readonly DeclaredReference[] }`
  - `interface IReferenceView { ReferencesViewFor(member): Promise<MemberReferencesView | undefined>; AvailableReferencesFor(member, kind: ProjectType): Promise<readonly BaseRef[]>; AvailableVersionsFor(member, kind: ProjectType, id: string): Promise<readonly string[]>; AddMemberReference(member, kind: ProjectType, ref: BaseRef): Promise<void>; RemoveMemberReference(member, kind: ProjectType, ref: BaseRef): Promise<void>; SetMemberReferenceVersion(member, kind: ProjectType, id: string, version: string): Promise<void>; OnReferencesViewChanged(handler: (affected: SolutionMember | undefined) => void): Disposable }`
  - `const ReferenceViewKey = new ServiceKey<IReferenceView>('IReferenceView')`
  - `class ReferenceNodeKey { static readonly Group = 'reference-group'; static readonly Leaf = 'reference-leaf' }`
  - `class ReferencesProvider implements IHierarchyProvider` with `constructor(member: SolutionMember, view: IReferenceView, resolver?: undefined)` — signal comes from `view.OnReferencesViewChanged`. Public: `Owns(id: HierarchyItemId): boolean`, `ReferencesRootId(): HierarchyItemId`, `dispose(): void`.

**Notes for the implementer:**
- `ReferenceNodeKey` mirrors TODL's `ContentNodeKey` (provider-scoped presentation family, never contributor-matched).
- `ReferencesProvider` is *async-seeded*: `ObserveChildren` returns the disposer synchronously and pushes `ChildAdded`s after the async `ReferencesViewFor`/available fetch resolves — the same pattern `ProjectContentProvider` uses (the model's `patch` handles late deltas).
- Leaf identity for interning is `kind@id` (a version repin is a `ChildUpdated`, not remove+add). The provider caches minted ids by group and by `kind@id`.
- Decoration → node fields: `LiveWorkspace`/`Published` → `NodeSeverity.Ok`; `Unresolved` → `NodeSeverity.Warning` + `Error` = the constant message. Leaf `IconKey`: `ReferenceNodeKey.Leaf` (icon variance by resolution is deferred to Task 6's glyph mapping which reads resolution off... — keep `IconKey = ReferenceNodeKey.Leaf` here; the live/published glyph split is a Task 6 concern keyed off a leaf-icon suffix constant `-live`/`-published` set here). Set leaf `IconKey` to `ReferenceNodeKey.Leaf + '-live'` / `+ '-published'` / `+ '-unresolved'` accordingly, so Task 6 maps them.
- `OnReferencesViewChanged(affected)`: re-fetch the whole view when `affected === undefined` (resolution changed globally) or `affected === this.member` (this member's manifest changed); diff against current leaves — `ChildRemoved` for gone `kind@id`, `ChildAdded` for new, `ChildUpdated` when the same `kind@id` differs in version or resolution.
- Groups: always emit `Meta-models`; emit `Libraries` only when `view` reports `OffersLibraries` (read from the fetched `MemberReferencesView.OffersLibraries`). A group node's `ExtObject` is a stable per-provider sentinel (e.g. `{ group: ProjectType.MetaModel }`).

- [ ] **Step 1: Write the failing test** — `references-provider.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
    HierarchyItemId, ChildAdded, ChildUpdated, ChildRemoved, NodeSeverity, NodeKey,
    HierarchyPropertyId, type HierarchyChange,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ProjectType, type SolutionMember, type Disposable } from '@pragmatic-tech-ai/todl'
import { ReferencesProvider } from '../references-provider.js'
import { ReferenceNodeKey } from '../reference-node-key.js'
import {
    ReferenceResolution, type IReferenceView, type MemberReferencesView,
} from '../reference-view.js'
import type { BaseRef } from '../../../../projects/base-binding.js'

const tick = () => new Promise((r) => setTimeout(r, 10))

// A fake IReferenceView returning a fixed view + capturing the change handler.
function fakeView(view: MemberReferencesView | undefined): IReferenceView & { fire: (m: SolutionMember | undefined) => void }
{
    let handler: ((m: SolutionMember | undefined) => void) | undefined
    return {
        fire: (m) => handler?.(m),
        ReferencesViewFor: async () => view,
        AvailableReferencesFor: async () => [],
        AvailableVersionsFor: async () => [],
        AddMemberReference: async () => {},
        RemoveMemberReference: async () => {},
        SetMemberReferenceVersion: async () => {},
        OnReferencesViewChanged: (h) => { handler = h; return { dispose() { handler = undefined } } as Disposable },
    }
}

const member = {} as SolutionMember
const ref = (id: string, version: string): BaseRef => ({ id, version })
const viewOf = (metas: [BaseRef, ReferenceResolution][], offersLibraries = true, libs: [BaseRef, ReferenceResolution][] = []): MemberReferencesView => ({
    OffersLibraries: offersLibraries,
    MetaModels: metas.map(([Ref, Resolution]) => ({ Ref, Resolution })),
    Libraries: libs.map(([Ref, Resolution]) => ({ Ref, Resolution })),
})

// Realize the provider fully: subscribe root, then each group.
async function realize(p: ReferencesProvider)
{
    const changes: { parent: HierarchyItemId; c: HierarchyChange }[] = []
    const record = (parent: HierarchyItemId) => (c: HierarchyChange) => changes.push({ parent, c })
    p.ObserveChildren(p.ReferencesRootId(), record(p.ReferencesRootId()))
    await tick()
    const groups = changes.filter((x) => x.c instanceof ChildAdded).map((x) => (x.c as ChildAdded).Id)
    for (const g of groups) p.ObserveChildren(g, record(g))
    await tick()
    return { changes, groups }
}

describe('ReferencesProvider', () =>
{
    it('emits Meta-models + Libraries groups then a leaf per declared ref, decorated', async () =>
    {
        const view = fakeView(viewOf(
            [[ref('core', '1.2.0'), ReferenceResolution.Published], [ref('w', '0.3.0'), ReferenceResolution.Unresolved]],
            true, [[ref('ui', '2.0.0'), ReferenceResolution.LiveWorkspace]]))
        const p = new ReferencesProvider(member, view)
        const { changes, groups } = await realize(p)
        expect(groups.length).toBe(2)   // Meta-models + Libraries
        const leaves = changes.filter((x) => x.c instanceof ChildAdded && (x.c as ChildAdded).Node.Key === ReferenceNodeKey.Leaf)
            .map((x) => (x.c as ChildAdded).Node)
        expect(leaves.map((n) => n.Caption).sort()).toEqual(['core@1.2.0', 'ui@2.0.0', 'w@0.3.0'])
        const unresolved = leaves.find((n) => n.Caption === 'w@0.3.0')!
        expect(unresolved.Severity).toBe(NodeSeverity.Warning)
        expect(unresolved.Error).toContain('Unresolved')
        expect(leaves.find((n) => n.Caption === 'core@1.2.0')!.Severity).toBe(NodeSeverity.Ok)
    })

    it('omits the Libraries group when OffersLibraries is false', async () =>
    {
        const p = new ReferencesProvider(member, fakeView(viewOf([[ref('core', '1.0.0'), ReferenceResolution.Published]], false)))
        const { groups } = await realize(p)
        expect(groups.length).toBe(1)
    })

    it('on OnReferencesViewChanged re-fetch: a version repin is a ChildUpdated (same id), a removal is ChildRemoved', async () =>
    {
        let current = viewOf([[ref('core', '1.0.0'), ReferenceResolution.Published], [ref('x', '1.0.0'), ReferenceResolution.Published]])
        const view: IReferenceView & { fire: (m: SolutionMember | undefined) => void } = { ...fakeView(current) }
        // Re-point ReferencesViewFor at a mutable `current`.
        ;(view as { ReferencesViewFor: () => Promise<MemberReferencesView | undefined> }).ReferencesViewFor = async () => current
        const p = new ReferencesProvider(member, view)
        const { changes, groups } = await realize(p)
        const metaGroup = groups[0]!
        changes.length = 0
        current = viewOf([[ref('core', '1.2.0'), ReferenceResolution.Published]])   // core repinned, x removed
        view.fire(member)
        await tick()
        const kinds = changes.filter((x) => x.parent === metaGroup).map((x) => x.c.constructor.name)
        expect(kinds).toContain('ChildUpdated')   // core@1.0.0 -> core@1.2.0, same id
        expect(kinds).toContain('ChildRemoved')   // x gone
    })

    it('GetProperty on the References root reports Caption/Key/expandable', () =>
    {
        const p = new ReferencesProvider(member, fakeView(viewOf([])))
        const root = p.ReferencesRootId()
        expect(p.GetProperty(root, HierarchyPropertyId.Caption)).toBe('References')
        expect(p.GetProperty(root, HierarchyPropertyId.IsExpandable)).toBe(true)
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/references-provider.test.ts` (from `packages/plexus-core`)
Expected: FAIL — modules `../references-provider.js`, `../reference-node-key.js`, `../reference-view.js` not found.

- [ ] **Step 3: Create `reference-view.ts`** (types + interface + key). Members PascalCase; `ReferenceViewKey` via `ServiceKey` from `@pragmatic-tech-ai/mural/runtime`. `UnresolvedMessage` constant lives on `ReferencesProvider` (Step 5), not here.

- [ ] **Step 4: Create `reference-node-key.ts`** — `ReferenceNodeKey` with `Group`/`Leaf` string constants (mirror `ContentNodeKey`).

- [ ] **Step 5: Create `references-provider.ts`** — implement `IHierarchyProvider`. Hoist all literals to `private static readonly` (`RootCaption = 'References'`, `MetaModelsGroupLabel = 'Meta-models'`, `LibrariesGroupLabel = 'Libraries'`, `UnresolvedMessage = 'Unresolved: not published and no workspace producer'`, `LiveIconSuffix = '-live'`, etc.). Mint the References-root id and group ids once (cached); mint leaf ids keyed by `kind@id`. Subscribe `view.OnReferencesViewChanged` in the constructor; `dispose()` disposes it. Implement `Owns(id)` against the minted-id set. `GetCanonicalName`/`ParseCanonicalName`: `references`, `references/<group>`, `references/<group>/<id@version>`. `CanAccept` → always `false`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/references-provider.test.ts`
Expected: PASS (4/4).

- [ ] **Step 7: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/reference-view.ts \
        packages/plexus-core/src/renderer/modules/solution-explorer/services/reference-node-key.ts \
        packages/plexus-core/src/renderer/modules/solution-explorer/services/references-provider.ts \
        packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/references-provider.test.ts
git commit -m "feat(p5a): ReferencesProvider + IReferenceView seam + node keys"
```

---

## Task 2: ProjectBranchesProvider (composite)

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/project-branches-provider.ts`
- Test: `packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/project-branches-provider.test.ts`

**Interfaces:**
- Consumes: `IHierarchyProvider`, `HierarchyItemId`, `ChildAdded`, `HierarchyPropertyId`, `NodeKey`, `NodeSeverity`; `ReferencesProvider` (Task 1, its `Owns`/`ReferencesRootId`).
- Produces: `class ProjectBranchesProvider implements IHierarchyProvider` with `constructor(files: IHierarchyProvider, refs: ReferencesProvider)`, `dispose(): void`. `ProviderId` fixed. On `ObserveChildren(rootId)` it emits `ChildAdded(referencesRoot)` first (via `refs.ReferencesRootId()`), then forwards `files.ObserveChildren(rootId)`. Dispatch rule: `refs.Owns(id)` → `refs`; else `files`.

**Notes:** The composite treats *any id it is asked about that isn't refs-owned* as a file id (including the project root, which the content provider maps to its store root via its own fallback). `dispose()` calls `refs.dispose()` and, if `files` has a `dispose`, it (guard with a typeof check — `ProjectContentProvider` has none; the file *store* is disposed by `FileTreeContributor.Release`, so the composite disposes only `refs`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import {
    HierarchyItemId, ChildAdded, HierarchyPropertyId, NodeSeverity,
    type HierarchyChange, type IHierarchyProvider,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ProjectBranchesProvider } from '../project-branches-provider.js'

// A fake file provider: on root it emits one file child; records the ids it is asked about.
function fakeFiles()
{
    const asked: HierarchyItemId[] = []
    const fileChild = HierarchyItemId.Mint()
    const provider: IHierarchyProvider = {
        ProviderId: 'files',
        ObserveChildren: (node, sink) => { asked.push(node); sink(new ChildAdded(fileChild, { Key: 'file', Caption: 'a.todl', IconKey: 'file', ExtObject: {}, Severity: NodeSeverity.Ok })); return () => {} },
        GetProperty: (id, p) => { asked.push(id); return p === HierarchyPropertyId.Caption ? 'a.todl' : undefined },
        GetCanonicalName: () => 'a.todl',
        ParseCanonicalName: () => HierarchyItemId.Nil,
        CanAccept: () => true,
    }
    return { provider, asked, fileChild }
}

// A fake refs provider standing in for ReferencesProvider (Owns + ReferencesRootId + IHierarchyProvider).
function fakeRefs()
{
    const root = HierarchyItemId.Mint()
    const owned = new Set<HierarchyItemId>([root])
    let disposed = false
    return {
        root, owned, get disposed() { return disposed },
        ReferencesRootId: () => root,
        Owns: (id: HierarchyItemId) => owned.has(id),
        ProviderId: 'refs',
        ObserveChildren: (_n: HierarchyItemId, _s: (c: HierarchyChange) => void) => () => {},
        GetProperty: (_id: HierarchyItemId, p: HierarchyPropertyId) => p === HierarchyPropertyId.Caption ? 'References' : undefined,
        GetCanonicalName: () => 'references',
        ParseCanonicalName: () => HierarchyItemId.Nil,
        CanAccept: () => false,
        dispose: () => { disposed = true },
    }
}

describe('ProjectBranchesProvider', () =>
{
    it('emits References as child[0] on the root, then forwards file children', () =>
    {
        const files = fakeFiles()
        const refs = fakeRefs()
        const p = new ProjectBranchesProvider(files.provider, refs as never)
        const added: HierarchyItemId[] = []
        p.ObserveChildren(HierarchyItemId.Root, (c) => { if (c instanceof ChildAdded) added.push(c.Id) })
        expect(added[0]).toBe(refs.root)         // References first
        expect(added).toContain(files.fileChild) // then files
    })

    it('dispatches GetProperty to refs for refs-owned ids and to files otherwise', () =>
    {
        const files = fakeFiles()
        const refs = fakeRefs()
        const p = new ProjectBranchesProvider(files.provider, refs as never)
        expect(p.GetProperty(refs.root, HierarchyPropertyId.Caption)).toBe('References')
        const someFileId = HierarchyItemId.Mint()
        p.GetProperty(someFileId, HierarchyPropertyId.Caption)
        expect(files.asked).toContain(someFileId)
    })

    it('dispose disposes the refs provider', () =>
    {
        const refs = fakeRefs()
        const p = new ProjectBranchesProvider(fakeFiles().provider, refs as never)
        p.dispose()
        expect(refs.disposed).toBe(true)
    })
})
```

- [ ] **Step 2: Run — verify it fails** (`../project-branches-provider.js` not found).

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/project-branches-provider.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `project-branches-provider.ts`** — constructor stores `files`, `refs`; `ObserveChildren(node, sink)`: if `refs.Owns(node)` delegate to `refs.ObserveChildren`; else if `node` is the root anchor OR a file id, delegate to `files.ObserveChildren` **and**, when it is the project root, first `sink(new ChildAdded(refs.ReferencesRootId(), <references node>))`. Determine "is root": the composite is asked for the project node's children exactly once with the model-assigned id; treat "not refs-owned and not previously seen as a file child" — simplest: the model calls `ObserveChildren` for the project node with the id it seeded; the composite always prepends References on the FIRST `ObserveChildren` call whose id is not refs-owned and not a known file child. Track `rootId` = the first non-refs id observed; prepend References only for that id. `GetProperty`/`GetCanonicalName`/`ParseCanonicalName`/`CanAccept`: dispatch by `refs.Owns(id)`. For the References node itself the composite answers via `refs.GetProperty(refs.ReferencesRootId(), …)`.

- [ ] **Step 4: Run — verify it passes** (3/3).

- [ ] **Step 5: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/project-branches-provider.ts \
        packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/project-branches-provider.test.ts
git commit -m "feat(p5a): ProjectBranchesProvider composite (References child[0] + files)"
```

---

## Task 3: IReferenceView on ProjectExplorerService + writeReferences

**Files:**
- Modify: `packages/plexus-core/src/renderer/modules/project-explorer/services/project-explorer-service.ts`
- Test: `packages/plexus-core/src/renderer/modules/project-explorer/services/tests/project-explorer-service.test.ts`

**Interfaces:**
- Consumes: `IReferenceView`/view types (Task 1); existing `SolutionBaseResolver` via `BaseResolverKey` (`WorkspaceProducers(kind)`), `IPublishedBases` via `PublishedBasesKey` (`ListMetaModels`/`ListLibraries`), `ProjectEventsKey`/`ProjectEventKind.ReferencesChanged`, `LiveValidationKey.RefreshBases`, `PROJECT_MANIFEST_FILENAME`, `ProjectType`.
- Produces: `ProjectExplorerService implements IContentMutations, IReferenceView`. New public methods = the `IReferenceView` surface. New private `writeReferences(op, mutate: (b: BaseBindings) => void): Promise<void>` used by all three mutators and by the refactored `manageReferences`. Fires `OnReferencesViewChanged(member)` handlers after each write; fires `OnReferencesViewChanged(undefined)` when the resolver's `StaleMemberIds` changes (subscribed once in the constructor / `Start`).

**Notes:**
- **Consumer gate:** `ReferencesViewFor` returns `undefined` when the member's `OpenProject` is absent OR the factory does not bind references — reuse `op.Factory.requiresMetaModel === true` (the same gate `CanRefreshBasesMember` uses). `OffersLibraries` = `op.Factory.offersLibraries === true`.
- **Decoration classification** (per declared `{id,version}` of kind K): `LiveWorkspace` if `id ∈ WorkspaceProducers(K).map(id)`; else `Published` if `${id}@${version} ∈ published(K)` where `published(MetaModel) = ListMetaModels()` / `published(Library) = ListLibraries()`; else `Unresolved`.
- **`AvailableReferencesFor(member, kind)`** = `published(kind) ∪ WorkspaceProducers(kind)` minus already-declared, deduped by `id@version` (reuse the modal's dedupe order: current path already builds `availableMetaModels`).
- **`AvailableVersionsFor(member, kind, id)`** = distinct versions where `published(kind).filter(r => r.id === id).map(version)` ∪ (the `WorkspaceProducers(kind)` version for `id` if present), newest-first.
- **`writeReferences`**: read manifest JSON, build `BaseBindings { metaModels, libraries }`, `mutate(bindings)`, write back `metaModels` (always) and `libraries` (only when `offersLibraries`), preserving all other fields; `LiveValidation.RefreshBases`; set `Status`; `raiseLifecycleEvent(ReferencesChanged, storage)`; then fire local `OnReferencesViewChanged(member)`. The existing `manageReferences` keeps its dialog + available computation but its confirm calls `writeReferences(op, b => { b.metaModels = result.metaModels; if (offersLibraries) b.libraries = result.libraries })`.
- **Mutators** map `member → op` (via `this.projected.get(member)`, like the other `*Member` methods) then call `writeReferences`. Add appends `ref` to the kind's list (dedupe `id@version`); Remove filters it out; SetVersion replaces the entry with matching `id` (in the kind's list) with `{id, version}`.
- `OnReferencesViewChanged` returns a `Disposable` removing the handler from a `Set`.

- [ ] **Step 1: Write the failing tests** — append to `project-explorer-service.test.ts` (follow the file's existing harness for constructing the service + a fake `OpenProject`/member + fake resolver/published/events providers; mirror the existing `manageReferences`/`deleteFiles` tests). Representative cases:

```ts
// (Within the existing describe, using the file's service+fakes harness.)

it('ReferencesViewFor returns undefined for a non-consumer project', async () =>
{
    const { service, member } = harnessWith({ requiresMetaModel: false })
    expect(await service.ReferencesViewFor(member)).toBeUndefined()
})

it('ReferencesViewFor omits Libraries and classifies resolution for a library project', async () =>
{
    const { service, member } = harnessWith({
        requiresMetaModel: true, offersLibraries: false,
        manifest: { type: 'library', id: 'l', packageVersion: '1.0.0', metaModels: [{ id: 'core', version: '1.2.0' }] },
        published: { metaModels: [{ id: 'core', version: '1.2.0' }] },
        workspaceProducers: { 'meta-model': [] },
    })
    const view = (await service.ReferencesViewFor(member))!
    expect(view.OffersLibraries).toBe(false)
    expect(view.Libraries).toEqual([])
    expect(view.MetaModels[0]!.Resolution).toBe(ReferenceResolution.Published)
})

it('a version-drift pin resolves LiveWorkspace by id against an open producer, else Unresolved against published', async () =>
{
    const { service, member } = harnessWith({
        requiresMetaModel: true, offersLibraries: true,
        manifest: { type: 'architecture', name: 'a', metaModels: [{ id: 'core', version: '9.9.9' }] },
        published: { metaModels: [{ id: 'core', version: '1.0.0' }] },     // published only at 1.0.0
        workspaceProducers: { 'meta-model': [{ id: 'core', version: '1.0.0' }] },   // open sibling produces core
    })
    expect((await service.ReferencesViewFor(member))!.MetaModels[0]!.Resolution).toBe(ReferenceResolution.LiveWorkspace)

    const drift = harnessWith({
        requiresMetaModel: true, offersLibraries: true,
        manifest: { type: 'architecture', name: 'a', metaModels: [{ id: 'core', version: '9.9.9' }] },
        published: { metaModels: [{ id: 'core', version: '1.0.0' }] },
        workspaceProducers: { 'meta-model': [] },     // no open producer
    })
    expect((await drift.service.ReferencesViewFor(drift.member))!.MetaModels[0]!.Resolution).toBe(ReferenceResolution.Unresolved)
})

it('AddMemberReference writes the manifest preserving other fields, refreshes bases, and fires the view-changed signal', async () =>
{
    const { service, member, storage, refreshedBases, events } = harnessWith({
        requiresMetaModel: true, offersLibraries: true,
        manifest: { type: 'architecture', name: 'a', someOtherField: 42, metaModels: [] },
    })
    let firedFor: unknown
    service.OnReferencesViewChanged((m) => { firedFor = m })
    await service.AddMemberReference(member, ProjectType.MetaModel, { id: 'core', version: '1.0.0' })
    const written = JSON.parse(await storage.ReadText('project.plexus'))
    expect(written.metaModels).toEqual([{ id: 'core', version: '1.0.0' }])
    expect(written.someOtherField).toBe(42)          // preserved
    expect(refreshedBases).toContain(storage)
    expect(events).toContainEqual(expect.objectContaining({ Kind: ProjectEventKind.ReferencesChanged }))
    expect(firedFor).toBe(member)
})

it('AvailableReferencesFor excludes already-declared and dedupes; AvailableVersionsFor merges published + live', async () =>
{
    const { service, member } = harnessWith({
        requiresMetaModel: true,
        manifest: { type: 'architecture', name: 'a', metaModels: [{ id: 'core', version: '1.0.0' }] },
        published: { metaModels: [{ id: 'core', version: '1.0.0' }, { id: 'core', version: '1.1.0' }, { id: 'other', version: '2.0.0' }] },
        workspaceProducers: { 'meta-model': [{ id: 'other', version: '2.0.0' }] },
    })
    const avail = await service.AvailableReferencesFor(member, ProjectType.MetaModel)
    expect(avail.map((r) => `${r.id}@${r.version}`)).not.toContain('core@1.0.0')   // declared, excluded
    expect(avail.map((r) => `${r.id}@${r.version}`)).toContain('core@1.1.0')
    const versions = await service.AvailableVersionsFor(member, ProjectType.MetaModel, 'core')
    expect(versions).toEqual(['1.1.0', '1.0.0'])
})
```

- [ ] **Step 2: Run — verify they fail** (methods undefined on the service).

Run: `npx vitest run src/renderer/modules/project-explorer/services/tests/project-explorer-service.test.ts` (from `packages/plexus-core`)
Expected: FAIL — `service.ReferencesViewFor is not a function`, etc.

- [ ] **Step 3: Implement `IReferenceView` on `ProjectExplorerService`** — add `implements … , IReferenceView`; the six methods + `writeReferences` + the `OnReferencesViewChanged` handler set + the resolver `StaleMemberIds` subscription (in `Start`/constructor, guarded so tests without a resolver don't crash). Refactor `manageReferences` to route through `writeReferences`. Hoist new literals (`UpdatedReferencesStatusFor` etc.) to constants.

- [ ] **Step 4: Run — verify they pass**, then the whole service suite.

Run: `npx vitest run src/renderer/modules/project-explorer/services/tests/project-explorer-service.test.ts`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/project-explorer/services/project-explorer-service.ts \
        packages/plexus-core/src/renderer/modules/project-explorer/services/tests/project-explorer-service.test.ts
git commit -m "feat(p5a): IReferenceView on ProjectExplorerService + writeReferences tail"
```

---

## Task 4: ReferenceActionsContributor

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/reference-actions-contributor.ts`
- Test: `packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/reference-actions-contributor.test.ts`

**Interfaces:**
- Consumes: `HierarchyAction`, `NodeKey`, `IHierarchyActionContributor`, `HierarchyActionContext`, `HierarchyItemVM`; `ReferenceNodeKey` (Task 1); `IReferenceView` (Task 1); `FileTreeContributor.MemberOf` (existing, climbs a row to its member); `ProjectType`.
- Produces: `class ReferenceActionsContributor implements IHierarchyActionContributor` with `ActionKeys = [NodeKey.References, ReferenceNodeKey.Group, ReferenceNodeKey.Leaf]`, `constructor(view: IReferenceView)`, `ActionsFor(context: HierarchyActionContext): readonly HierarchyAction[]`.

**Notes:**
- The submenus are async: build the parent `Add ▸` / `Set Version ▸` action synchronously, then fill `.Children` after `AvailableReferencesFor` / `AvailableVersionsFor` resolves (its `ObservableCollection` renders incrementally). If the resolved list is empty, add one disabled item (`canExecute:false`) captioned `(nothing to add)` / `(no other versions)`.
- Key dispatch on `context.Anchor.Key`:
  - `NodeKey.References` → `Add Meta-model ▸`, and `Add Library ▸` iff the view reports `OffersLibraries` (fetch `ReferencesViewFor` to learn it; if `undefined`, no actions).
  - `ReferenceNodeKey.Group` → `Add ▸` for that group's kind. The group's kind is read from `context.Anchor.Data` (the provider's group sentinel `{ group: ProjectType }`).
  - `ReferenceNodeKey.Leaf` → `Set Version ▸` (current version item `canExecute:false`) + `Remove` (selection-aware).
- The leaf's `{ kind, ref }` identity is read from `context.Anchor.Data`. `Remove` uses `context.Selection` filtered to reference leaves; if the anchor is in the selection remove all selected leaves (each via its own `kind`), else just the anchor — mirror `FileTreeContributor.DeleteFrom`.
- `MemberOf` climbs to the member; guard `undefined`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { NodeKey, type HierarchyActionContext, type HierarchyItemVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ProjectType, type SolutionMember } from '@pragmatic-tech-ai/todl'
import { ReferenceActionsContributor } from '../reference-actions-contributor.js'
import { ReferenceNodeKey } from '../reference-node-key.js'
import { ReferenceResolution, type IReferenceView, type MemberReferencesView } from '../reference-view.js'

const tick = () => new Promise((r) => setTimeout(r, 10))
const member = { } as SolutionMember

function view(overrides: Partial<IReferenceView> = {}, offersLibraries = true): IReferenceView
{
    const v: MemberReferencesView = { OffersLibraries: offersLibraries, MetaModels: [], Libraries: [] }
    const removed: [ProjectType, string][] = []
    const base: IReferenceView & { removed: typeof removed } = {
        removed,
        ReferencesViewFor: async () => v,
        AvailableReferencesFor: async () => [{ id: 'core', version: '1.0.0' }],
        AvailableVersionsFor: async () => ['1.1.0', '1.0.0'],
        AddMemberReference: async () => {},
        RemoveMemberReference: async (_m, k, r) => { removed.push([k, r.id]) },
        SetMemberReferenceVersion: async () => {},
        OnReferencesViewChanged: () => ({ dispose() {} }),
    }
    return Object.assign(base, overrides)
}

// A minimal HierarchyItemVM stand-in: Key + Data.
const vm = (key: string, data: unknown): HierarchyItemVM => ({ Key: key, Data: data } as unknown as HierarchyItemVM)
const ctx = (anchor: HierarchyItemVM, selection: HierarchyItemVM[] = [anchor]): HierarchyActionContext => ({ Anchor: anchor, Selection: selection })

// MemberOf climbs Parent to a SolutionMember; give the anchor a member Parent so it resolves.
function withMember(v: HierarchyItemVM): HierarchyItemVM { return Object.assign(v as object, { Parent: vm(NodeKey.Project, member) }) as HierarchyItemVM }

describe('ReferenceActionsContributor', () =>
{
    it('References node offers Add Meta-model and (when offersLibraries) Add Library', async () =>
    {
        const c = new ReferenceActionsContributor(view({}, true))
        const actions = c.ActionsFor(ctx(withMember(vm(NodeKey.References, {}))))
        await tick()
        expect(actions.map((a) => a.Label)).toEqual(expect.arrayContaining(['Add Meta-model', 'Add Library']))
    })

    it('a leaf offers Set Version and Remove', () =>
    {
        const c = new ReferenceActionsContributor(view())
        const actions = c.ActionsFor(ctx(withMember(vm(ReferenceNodeKey.Leaf, { kind: ProjectType.MetaModel, ref: { id: 'core', version: '1.0.0' } }))))
        expect(actions.map((a) => a.Label)).toEqual(expect.arrayContaining(['Set Version', 'Remove']))
    })

    it('Remove on a multi-selected leaf removes the whole selection', async () =>
    {
        const v = view()
        const c = new ReferenceActionsContributor(v)
        const a = withMember(vm(ReferenceNodeKey.Leaf, { kind: ProjectType.MetaModel, ref: { id: 'core', version: '1.0.0' } }))
        const b = withMember(vm(ReferenceNodeKey.Leaf, { kind: ProjectType.Library, ref: { id: 'ui', version: '2.0.0' } }))
        const remove = c.ActionsFor(ctx(a, [a, b])).find((x) => x.Label === 'Remove')!
        remove.Invoke.Execute()
        await tick()
        expect((v as unknown as { removed: [ProjectType, string][] }).removed.sort()).toEqual([[ProjectType.Library, 'ui'], [ProjectType.MetaModel, 'core']])
    })

    it('an empty Add submenu shows a single disabled item', async () =>
    {
        const c = new ReferenceActionsContributor(view({ AvailableReferencesFor: async () => [] }))
        const add = c.ActionsFor(ctx(withMember(vm(ReferenceNodeKey.Group, { group: ProjectType.MetaModel })))).find((a) => a.Label === 'Add')!
        await tick()
        expect(add.Children.Count).toBe(1)
        expect(add.Children.At(0).Invoke.CanExecute()).toBe(false)
    })
})
```

(If `ObservableCollection` exposes `.At`/`.Count` differently, use the file's existing accessor idiom — check `hierarchy-action.ts`/an existing contributor test.)

- [ ] **Step 2: Run — verify it fails** (module not found).
- [ ] **Step 3: Implement `reference-actions-contributor.ts`** (hoist all labels/messages to constants).
- [ ] **Step 4: Run — verify it passes** (4/4).
- [ ] **Step 5: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/reference-actions-contributor.ts \
        packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/reference-actions-contributor.test.ts
git commit -m "feat(p5a): ReferenceActionsContributor (Add/Set Version/Remove)"
```

---

## Task 5: Wire the composite + actions + key-Delete into SolutionExplorerService & FileTreeContributor

**Files:**
- Modify: `packages/plexus-core/src/renderer/modules/solution-explorer/services/file-tree-contributor.ts`
- Modify: `packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-explorer-service.ts`
- Test: extend `services/tests/file-tree-contributor-actions.test.ts` and `services/tests/solution-explorer-service.test.ts`

**Interfaces:**
- Consumes: `ProjectBranchesProvider` (Task 2), `ReferencesProvider` (Task 1), `ReferenceActionsContributor` (Task 4), `IReferenceView`/`ReferenceViewKey` (Task 1), `ReferenceNodeKey` (Task 1).
- Produces:
  - `FileTreeContributor.SetReferenceView(view: IReferenceView): void`; `Contribute` returns a cached `ProjectBranchesProvider` per member (wrapping the cached `ProjectContentProvider` + a per-member `ReferencesProvider`). `Release`/`dispose` also dispose the branches/refs.
  - `SolutionExplorerService.Delete(vm)` dispatches: `vm.Key === ReferenceNodeKey.Leaf` → remove references via the view (selection-aware); else `files.DeleteFrom` (unchanged). `rebuild()` calls `this.files.SetReferenceView(view)` and registers a `ReferenceActionsContributor(view)` (new disposer `offReferenceActions`, torn down in `teardownCurrent`). `view = this.provider.getRequired(ReferenceViewKey)` (bound to the same `ProjectExplorerService`).

**Notes:**
- `ProjectExplorerService` must be registered under `ReferenceViewKey` in app composition (it already implements it after Task 3). Verify/add the registration where `ContentMutationsKey` → `ProjectExplorerService` is registered (search `registerInstance(ContentMutationsKey` or `ProjectExplorerService.Key`). Add the `ReferenceViewKey` alias there. This is part of Task 5 (a one-line registration); if the DI wiring lives in `apps/plexus`, edit that composition file.
- The composite must return the **same instance** per member across repeated `Contribute` (the model's `attachProvider` guards by identity). Cache `Map<SolutionMember, ProjectBranchesProvider>`.
- Key-Delete selection-aware removal for references: gather `this._tree?.Selection` leaves whose `Key === ReferenceNodeKey.Leaf`; for the anchor's-in-selection rule reuse the `DeleteFrom` shape but call `view.RemoveMemberReference` per leaf `{kind, ref}`. Put this in a small private `removeReferences(anchor, selection)` on the service.

- [ ] **Step 1: Write the failing tests.**

For `file-tree-contributor-actions.test.ts` — add: after `SetReferenceView(fakeView)`, `Contribute(memberNode(member))` returns a `ProjectBranchesProvider`, and calling it twice returns the identical instance:

```ts
it('Contribute returns a ProjectBranchesProvider (References + files), cached per member', () =>
{
    const c = new FileTreeContributor()
    c.SetMutations(fakeMutations())
    c.SetReferenceView(fakeReferenceView())          // new fake (ReferencesViewFor → a consumer view)
    const first = (c.Contribute(memberNode(member)) as ProviderContribution).Provider
    const again = (c.Contribute(memberNode(member)) as ProviderContribution).Provider
    expect(first).toBeInstanceOf(ProjectBranchesProvider)
    expect(again).toBe(first)                          // identity cached
})
```

For `solution-explorer-service.test.ts` — add a Delete-dispatch test (mirror its existing host-method tests): a `vm` with `Key === ReferenceNodeKey.Leaf` routes to `view.RemoveMemberReference`, while a file `vm` routes to `files.DeleteFrom`:

```ts
it('Delete dispatches reference leaves to reference-removal and file rows to file deletion', () =>
{
    const { service, view, files } = harness()   // harness exposes the fake view + fake FileTreeContributor
    const leaf = fakeVm(ReferenceNodeKey.Leaf, { kind: ProjectType.MetaModel, ref: { id: 'core', version: '1.0.0' } })
    service.Delete(leaf)
    expect(view.removed).toContainEqual([ProjectType.MetaModel, 'core'])

    const file = fakeVm(ContentNodeKey.File, { Path: 'a.todl' })
    service.Delete(file)
    expect(files.deletedFrom).toBe(true)
})
```

- [ ] **Step 2: Run — verify they fail** (`SetReferenceView`/dispatch not present).

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/file-tree-contributor-actions.test.ts src/renderer/modules/solution-explorer/services/tests/solution-explorer-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the `FileTreeContributor` + `SolutionExplorerService` changes + the `ReferenceViewKey` registration.

- [ ] **Step 4: Run — verify they pass**, then the full solution-explorer services suite.

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/file-tree-contributor.ts \
        packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-explorer-service.ts \
        packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/ \
        <the composition file registering ReferenceViewKey>
git commit -m "feat(p5a): wire composite provider + reference actions + key-Delete dispatch"
```

---

## Task 6: Reference glyphs (IconKeyGlyphs)

**Files:**
- Modify: `packages/plexus-core/src/renderer/modules/solution-explorer/services/icon-key-to-geometry.ts`
- Test: `packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/icon-key-to-geometry.test.ts` (create if absent)

**Interfaces:**
- Consumes: `NodeKey.References`, `ReferenceNodeKey.Group`, and the leaf icon-key constants from Task 1 (`ReferenceNodeKey.Leaf + '-live'|'-published'|'-unresolved'`).
- Produces: `IconKeyGlyphs.For` returns a themed glyph name for each new key (placeholder-mapped to an existing glyph — e.g. `'Folder'` for References/Group, an existing package/reference glyph for leaves — consistent with the shipped P2 placeholder note).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { NodeKey } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { IconKeyGlyphs } from '../icon-key-to-geometry.js'
import { ReferenceNodeKey } from '../reference-node-key.js'

describe('IconKeyGlyphs.For (reference keys)', () =>
{
    it('maps the References branch keys to a non-empty glyph', () =>
    {
        for (const key of [NodeKey.References, ReferenceNodeKey.Group, ReferenceNodeKey.Leaf + '-live', ReferenceNodeKey.Leaf + '-published', ReferenceNodeKey.Leaf + '-unresolved'])
            expect(typeof IconKeyGlyphs.For(key)).toBe('string')
        expect(IconKeyGlyphs.For(NodeKey.References)).not.toBe('')
    })
})
```

- [ ] **Step 2: Run — verify it fails** (references keys fall through to `iconKeyForKind`, likely returning empty/garbage — assert the specific new mapping).
- [ ] **Step 3: Add the `switch` cases** in `IconKeyGlyphs.For` (hoist glyph-name constants). Use `startsWith(ReferenceNodeKey.Leaf)` for the three leaf variants.
- [ ] **Step 4: Run — verify it passes.**
- [ ] **Step 5: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/icon-key-to-geometry.ts \
        packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/icon-key-to-geometry.test.ts
git commit -m "feat(p5a): reference-branch row glyphs"
```

---

## Task 7: End-to-end — References branch in the live Solution Explorer

**Files:**
- Create: `apps/plexus/e2e/solution-explorer-references.spec.ts`

**Interfaces:**
- Consumes: the shipped app + `PLEXUS_TEST_CORPUS`. Reuses the P3/P4 e2e helpers/patterns from `apps/plexus/e2e/solution-explorer-mutation.spec.ts` (`cloneCorpus`, `seedSession`, `revealExplorer`, `treeRowCount`, `rightClickRow` near the left of the Border, expand via row-click + `ArrowRight`, `menuItems`, `test.afterAll` close + 2s settle + `rmSync`).

**Notes:** This task is a whole build + live run. Steps:

- [ ] **Step 1: Build** the workspace so the app runs the new code.

Run (repo root `Plexus`): `npm run build`
Expected: build success (plexus-core dist regenerated).

- [ ] **Step 2: Write the spec** — a corpus architecture project, expanded, shows `References` as the first child with `Meta-models` (and `Libraries`) groups; declared refs appear as `id@version` leaves; a project with an unresolved pin shows the warning severity on that leaf; right-clicking a group shows `Add ▸`; right-clicking a leaf shows `Set Version ▸` and `Remove`; performing `Add` then re-reading the tree shows the new leaf; `Remove` drops it. Keep the delta/error checks load-bearing and positives best-effort (the P3/P4 convention). Use the `Symbol.for('mural:visual-backref')` → `.DataContext` pattern to read row `HierarchyItemVM`s, and key row discovery on the `References`/group captions.

```ts
// Skeleton — fill helpers by importing/copying from solution-explorer-mutation.spec.ts.
import { test, expect, _electron as electron } from '@playwright/test'
// ... cloneCorpus / seedSession / launch / revealExplorer / expandRow / rightClickRow / menuItems ...

test.describe('Solution Explorer — References branch', () =>
{
    test('References node lists declared refs, decorated, and edits inline', async () =>
    {
        // 1. launch + seed a cloned corpus solution; revealExplorer()
        // 2. expand an architecture project row; assert a row captioned 'References' exists and is first among the project's children
        // 3. expand References; assert a 'Meta-models' group row; assert >=1 leaf whose caption matches /@\d/
        // 4. find a leaf with warning severity if the corpus has an unresolved pin (best-effort)
        // 5. rightClickRow(group) -> menuItems() contains 'Add'
        // 6. rightClickRow(leaf)  -> menuItems() contains 'Set Version' and 'Remove'
        // 7. (best-effort) invoke Remove; assert the leaf row count under the group drops by one
    })
})
```

- [ ] **Step 3: Run the e2e spec.**

Run (from `apps/plexus`): `PLEXUS_TEST_CORPUS="C:/Users/Eugene/Projects/architecture-agent/plexus_test_projects" npx playwright test solution-explorer-references`
Expected: PASS. (If a corpus project lacks references, add/confirm one in the test corpus or seed via the app; the assertions on presence are best-effort where the corpus can't guarantee data — the load-bearing assertions are the branch structure + menu contents.)

- [ ] **Step 4: Commit**

```bash
git add apps/plexus/e2e/solution-explorer-references.spec.ts
git commit -m "test(p5a): e2e for the References branch"
```

---

## Self-Review

**1. Spec coverage:**
- Tree shape / node keys → Task 1 (`ReferenceNodeKey`, groups, leaves) + Task 2 (References as child[0]).
- Composite provider / ownership → Task 2 + Task 5 (wiring).
- Reactivity (two signals unified as `OnReferencesViewChanged`) → Task 1 (provider re-fetch/diff) + Task 3 (service raises on write + resolver stale).
- Edit seam (`IReferenceView`, `writeReferences`, modal reuse) → Task 3.
- Decoration enum + classification + rendering → Task 1 (rendering) + Task 3 (classification).
- Actions (Add/Set Version/Remove, gating, selection-aware, disabled empties) → Task 4.
- Key-Delete dispatch + modal retained → Task 5 (dispatch); modal retained is unchanged existing `ProjectActionsContributor` action (no task needed; Task 3 keeps it working via `writeReferences`).
- Glyphs / markup → Task 6 (glyphs); markup reuse verified in Task 7 (e2e).
- e2e → Task 7.
- No gaps found.

**2. Placeholder scan:** No TBD/TODO. Test steps carry real code; implementation steps name exact methods/signatures. The e2e (Task 7) intentionally gives a skeleton + explicit helper-reuse instructions rather than duplicating ~200 lines of P3/P4 harness — acceptable for an e2e that must be adapted to live DOM, and the load-bearing assertions are enumerated.

**3. Type consistency:** `IReferenceView` surface identical across Tasks 1/3/4/5. `ReferenceResolution`/`DeclaredReference`/`MemberReferencesView` PascalCase members consistent. `ReferenceNodeKey.Group`/`.Leaf` + leaf icon suffixes consistent across Tasks 1/4/6. `AvailableVersionsFor(member, kind, id)` (3 args, kind added) consistent Tasks 1/3/4. `ProjectBranchesProvider(files, refs)` ctor consistent Tasks 2/5.

**4. Review Focus:** all five items have owning-task tests (annotated above: #1/#2/#3 → Task 3; #4 → Tasks 1+3; #5 → Task 4).
