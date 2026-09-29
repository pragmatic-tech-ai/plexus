# Solution Hierarchy P3+P4 — Mutation, Commands & Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the retired editing UX (context menu, rename, delete, new-file, drag-drop) on the P2 Solution Explorer, on a keyed action-contributor seam + a global selection surface.

**Architecture:** Mutations flow UI→engine store→disk→watcher delta→tree (authoritative). Node actions are owner-supplied base + keyed-contributor additions by node `Key`, via a new mural `IHierarchyActionContributor` seam + sibling registry + `.hierarchyActions:` DSL. Inline editing + a global selection surface live on the generic mural VMs behind a `HierarchyHost` seam; Plexus supplies the mutation façade, the base + producer action contributors, the `.mu` context-menu/rename resources, and the input behaviors.

**Tech Stack:** TypeScript; mural framework (Observable/MuralBase, TreeView, `.mu` DSL); todl-runtime IStorage + chokidar; TODL engine content store; Plexus (plexus-core + apps/plexus + apps/devUI); node:test (Mural/TODL via tsx), vitest (plexus-core/apps), Playwright/Electron (e2e).

**Spec:** `Plexus/docs/superpowers/specs/2026-09-29-solution-hierarchy-p3p4-mutation-commands-spec.md`

## Global Constraints

- OOP: no module-level free functions or state; every function a method/static (the `is<X>` type-guard free-function precedent is the sole exception).
- View models derive from `Observable`, not `MuralBase`.
- Allman braces (opening brace on its own line) for class/interface/enum/method/control blocks; `else`/`catch`/`finally` on their own line; object literals + block-arrow bodies + genuine one-liners stay inline.
- No inline reused/keyed string literals — hoist to `private static readonly` PascalCase constants.
- Enums over string-literal unions.
- PascalCase for interfaces + all public methods.
- Tests live in `tests/` subfolders next to source.
- No worktrees; feature branch `feat/hierarchy-p3p4-mutation-commands` per repo.
- Cross-repo release order: **Mural → TODL → Plexus**. After editing a sibling (Mural/TODL), rebuild it and re-copy its `dist` into `Plexus/node_modules/@pragmatic-tech-ai/<pkg>/dist` (the copies have the `development` export condition stripped). plexus-core must be rebuilt (`npm run build`) before apps read its changes.
- e2e corpus lives at `C:/Users/Eugene/Projects/architecture-agent/plexus_test_projects`; run e2e with `PLEXUS_TEST_CORPUS=<that path>`.
- Attribution: commits end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Merge/push to shared branches + publish are norms-gated; publishing is deferred.

## Review Focus

Five failure modes the spec implies; each pinned to a task's tests.

- **Rename collision / invalid name** — `store.Rename` to an empty/illegal name must reject and not touch disk (the store never optimistically mutates its model, so the row reverts); a genuine FS collision surfaces as a thrown error the caller reports. Pinned in the TODL store tests (Task 7).
- **Delete of an open document** — Delete must run the close-guard *before* the disk delete, or an open editor is orphaned. The guard lives in `ProjectExplorerService.deleteFile` (Task 9); the Delete action routes there via `mutations.DeleteMemberFile`. Pinned in the plexus-core `FileTreeContributor` action test (Task 10) + a guard-blocks assertion in Task 9.
- **Drag onto self / into own descendant** — `CanAccept` must reject, or `Move` renames a folder under itself. Pinned in the TODL `CanAccept` tests (Task 8).
- **Selection survives a rename, drops on delete** — a selected row renamed stays selected (same VM via `ChildUpdated`); deleted drops from `Selection`. Pinned in the mural tree-VM tests (Task 6).
- **Dynamic submenu that never resolves** — an async `Children` (skills Run) that yields nothing leaves a usable (empty) submenu, not a spinner-forever or a throw. Pinned in the app skills action-contributor test (Task 13).

## File Structure

**Mural (`src/framework/hierarchy/`)**
- Create `hierarchy-action.ts` — `HierarchyAction` (Label/IconKey/Invoke:ICommand/Children:ObservableCollection/IsSeparator) + `HierarchyActionContext` (Anchor/Selection).
- Create `hierarchy-action-contributor.ts` — `IHierarchyActionContributor` + `HierarchyActionContributorDefinition` (DP-backed, mirrors `HierarchyContributorDefinition`).
- Create `hierarchy-action-contributor-registry.ts` — `HierarchyActionContributorRegistry` (sibling of the node registry).
- Create `hierarchy-host.ts` — the `HierarchyHost` interface.
- Modify `hierarchy-item-vm.ts` — inline editing + `ContextActions`; take a `HierarchyHost` not `onActivate`.
- Modify `hierarchy-tree-vm.ts` — `Selection`/`Anchor`; own the host; prune-on-remove.
- Modify `index.ts` — export the new symbols.
- Modify `src/framework/shell/module.ts` + the `.mu` compiler/symbol-table — add the `.hierarchyActions:` block (mirror `.hierarchyContributors:`).

**TODL (`src/solution-services/project-services/content/`)**
- Modify `project-content-store.ts` — `CreateFile`/`CreateFolder`/`Rename`/`Delete`/`Move`.
- Modify `project-content-provider.ts` — implement `CanAccept`; expose a HierarchyItemId↔ContentNodeId resolve if needed.
- Modify `todl-runtime` `NodeFsStorage.Delete` only if it is not already recursive.

**plexus-core (`src/renderer/modules/solution-explorer/services/`)**
- Modify `file-tree-contributor.ts` — implement `IHierarchyActionContributor` + the mutation façade methods.
- Create `project-actions-contributor.ts` — `ProjectActionsContributor` (project-lifecycle actions → `ProjectExplorerService`).
- Modify `solution-explorer-service.ts` — implement `HierarchyHost`; register action contributors per solution.
- Modify `project-explorer-service.ts` — re-type producer methods to take `SolutionMember`.

**apps/plexus**
- Modify `app.mu` — register `HierarchyActionContributorRegistry`; each module's `.hierarchyActions:`.
- Modify `solution-explorer.resources.mu` — recursive `HierarchyAction` MenuItem template + ContextMenu + rename slot.
- Create the three input behaviors (selection/key/drag) under `src/renderer/src/modules/solution-explorer/`.
- Modify the skills / architecture / diagram-export modules — `.hierarchyActions:` contributors replacing `IProjectMenuSource`/`INodeCommandContributor`/`DiagramTreeExportKey` wiring.
- Modify `main.js` if the host needs a post-start hook (likely none beyond P2).
- Create `e2e/solution-explorer-mutation.spec.ts`.

---

## Layer 1 — Mural (`C:\Users\Eugene\Projects\architecture-agent\Mural`)

Test runner: `npx tsx --conditions=development --test --test-force-exit "<glob>"`. After Layer 1: `npm run build`, then copy `dist/framework/hierarchy` + `dist/framework/list` + `dist/framework/shell` + `dist/compiler` into `Plexus/node_modules/@pragmatic-tech-ai/mural/dist/` for Layer 3.

### Task 1: `HierarchyAction` + `HierarchyActionContext`

**Files:**
- Create: `src/framework/hierarchy/hierarchy-action.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-action.test.ts`

**Interfaces:**
- Consumes: `ICommand`, `RelayCommand` from `../../runtime/index.js`; `ObservableCollection` from `../../runtime/index.js`; `HierarchyItemVM` (type-only, from `./hierarchy-item-vm.js`).
- Produces: `class HierarchyAction` — fields `Label: string`, `IconKey: string | undefined`, `Invoke: ICommand`, `Children: ObservableCollection<HierarchyAction>`, `IsSeparator: boolean`; static `HierarchyAction.Command(label, run, opts?)` and `HierarchyAction.Separator()`. `interface HierarchyActionContext { readonly Anchor: HierarchyItemVM; readonly Selection: readonly HierarchyItemVM[] }`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HierarchyAction } from '../hierarchy-action.js';
import type { HierarchyActionContext } from '../hierarchy-action.js';

const ctx = { Anchor: undefined, Selection: [] } as unknown as HierarchyActionContext;

test('Command action runs its handler with the context and defaults enabled', () =>
{
    let ran: HierarchyActionContext | undefined;
    const a = HierarchyAction.Command('Delete', (c) => { ran = c; });
    assert.equal(a.Label, 'Delete');
    assert.equal(a.IsSeparator, false);
    assert.equal(a.Invoke.CanExecute(), true);
    a.Invoke.Execute();
    assert.equal(ran, ctx === ran ? ran : ran);   // handler received the captured context
    assert.equal(a.Children.Count, 0);
});

test('canExecute gates the command; captured context is passed', () =>
{
    const a = HierarchyAction.Command('Publish', () => {}, { context: ctx, canExecute: () => false, iconKey: 'Publish' });
    assert.equal(a.Invoke.CanExecute(), false);
    assert.equal(a.IconKey, 'Publish');
});

test('Separator is marked and inert', () =>
{
    const s = HierarchyAction.Separator();
    assert.equal(s.IsSeparator, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-action.test.ts"`
Expected: FAIL — `Cannot find module '../hierarchy-action.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { ObservableCollection, RelayCommand, type ICommand } from '../../runtime/index.js';
import type { HierarchyItemVM } from './hierarchy-item-vm.js';

// The context a HierarchyAction handler receives: the right-clicked/focused row (Anchor)
// and the full selection. Each VM exposes Data (the ExtObject), so handlers reach the
// engine object without new plumbing.
export interface HierarchyActionContext
{
    readonly Anchor: HierarchyItemVM;
    readonly Selection: readonly HierarchyItemVM[];
}

// One context-menu entry. `Invoke` is a no-arg ICommand that captures the context passed
// at build time (ActionsFor runs when the menu opens, so the selection snapshot is live).
// `Children` is observable so a dynamic submenu renders immediately and fills in async.
export class HierarchyAction
{
    private static readonly SeparatorLabel = '-';

    public readonly Children = new ObservableCollection<HierarchyAction>();

    private constructor(
        public readonly Label: string,
        public readonly Invoke: ICommand,
        public readonly IsSeparator: boolean,
        public readonly IconKey: string | undefined,
    )
    {
    }

    public static Command(
        label: string,
        run: (context: HierarchyActionContext) => void | Promise<void>,
        opts?: { context?: HierarchyActionContext; canExecute?: (context: HierarchyActionContext) => boolean; iconKey?: string },
    ): HierarchyAction
    {
        const ctx = opts?.context;
        const invoke = new RelayCommand(
            () => { void run(ctx as HierarchyActionContext); },
            () => (opts?.canExecute === undefined ? true : opts.canExecute(ctx as HierarchyActionContext)),
        );
        return new HierarchyAction(label, invoke, false, opts?.iconKey);
    }

    public static Separator(): HierarchyAction
    {
        return new HierarchyAction(HierarchyAction.SeparatorLabel, new RelayCommand(() => {}, () => false), true, undefined);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-action.test.ts"`
Expected: PASS (3/3). (Fix the first test's tautological assert to `assert.equal(ran, ctx)` once `context: ctx` is passed — pass `{ context: ctx }` in test 1.)

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-action.ts src/framework/hierarchy/tests/hierarchy-action.test.ts
git commit -m "feat(hierarchy): HierarchyAction + HierarchyActionContext"
```

### Task 2: `IHierarchyActionContributor` + `HierarchyActionDefinition`

**Files:**
- Create: `src/framework/hierarchy/hierarchy-action-contributor.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-action-contributor.test.ts`

**Interfaces:**
- Consumes: `MetaData`, `MuralBase`, `ServiceToken` from `../../runtime/index.js`; `HierarchyAction` (Task 1); `HierarchyItemVM` (type-only).
- Produces: `interface IHierarchyActionContributor { readonly ActionKeys: readonly string[]; ActionsFor(node: HierarchyItemVM): readonly HierarchyAction[] }`; `class HierarchyActionDefinition extends MuralBase` with DP-backed `ActionKeys: readonly string[]`, `Contributor: ServiceToken<unknown> | undefined`, `Order: number` (verbatim shape of `HierarchyContributorDefinition`).

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HierarchyActionDefinition } from '../hierarchy-action-contributor.js';

test('definition holds ActionKeys / Contributor / Order with defaults', () =>
{
    const d = new HierarchyActionDefinition();
    assert.deepEqual(d.ActionKeys, []);
    assert.equal(d.Contributor, undefined);
    assert.equal(d.Order, 0);
    d.ActionKeys = ['project'];
    d.Order = 5;
    assert.deepEqual(d.ActionKeys, ['project']);
    assert.equal(d.Order, 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-action-contributor.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** (mirror `hierarchy-contributor-definition.ts` exactly)

```ts
import { MetaData, MuralBase, type ServiceToken } from '../../runtime/index.js';
import type { HierarchyAction } from './hierarchy-action.js';
import type { HierarchyItemVM } from './hierarchy-item-vm.js';

const EMPTY_KEYS: readonly string[] = Object.freeze([]);

// Contributes context-menu actions for nodes of the given `Key`s. The design's
// "owner base + keyed additions" both register through this one seam (the file/project
// contributors register for their own keys; app modules add contributors for the same
// keys), merged by Order. Symmetric with IHierarchyContributor, but keyed by the
// target node's OWN Key (not ParentKeys).
export interface IHierarchyActionContributor
{
    readonly ActionKeys: readonly string[];
    ActionsFor(node: HierarchyItemVM): readonly HierarchyAction[];
}

// Registration schema for a `.hierarchyActions:` block entry. DP-backed MuralBase so it
// is declarable in markup, the same shape as HierarchyContributorDefinition.
export class HierarchyActionDefinition extends MuralBase
{
    public static readonly ActionKeysKey = MuralBase.RegisterProperty<readonly string[]>(
        HierarchyActionDefinition, 'ActionKeys', EMPTY_KEYS, MetaData.None);

    public static readonly ContributorKey = MuralBase.RegisterProperty<ServiceToken<unknown> | undefined>(
        HierarchyActionDefinition, 'Contributor', undefined, MetaData.None);

    public static readonly OrderKey = MuralBase.RegisterProperty<number>(
        HierarchyActionDefinition, 'Order', 0, MetaData.None);

    public get ActionKeys(): readonly string[]  { return this.get_property_value(HierarchyActionDefinition.ActionKeysKey); }
    public set ActionKeys(v: readonly string[]) { this.set_property_value(HierarchyActionDefinition.ActionKeysKey, v); }

    public get Contributor(): ServiceToken<unknown> | undefined  { return this.get_property_value(HierarchyActionDefinition.ContributorKey); }
    public set Contributor(v: ServiceToken<unknown> | undefined) { this.set_property_value(HierarchyActionDefinition.ContributorKey, v); }

    public get Order(): number  { return this.get_property_value(HierarchyActionDefinition.OrderKey); }
    public set Order(v: number) { this.set_property_value(HierarchyActionDefinition.OrderKey, v); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-action-contributor.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-action-contributor.ts src/framework/hierarchy/tests/hierarchy-action-contributor.test.ts
git commit -m "feat(hierarchy): IHierarchyActionContributor + HierarchyActionDefinition"
```

### Task 3: `HierarchyActionContributorRegistry` + `.hierarchyActions:` DSL

**Files:**
- Create: `src/framework/hierarchy/hierarchy-action-contributor-registry.ts`
- Modify: `src/framework/shell/module.ts` (add `HierarchyActions` collection, ~after line 200)
- Modify: `src/compiler/compiler.ts:3872-3876` (one ternary arm)
- Modify: `src/framework/hierarchy/index.ts` + `src/framework/index.ts` (export new symbols)
- Test: `src/framework/hierarchy/tests/hierarchy-action-contributor-registry.test.ts`

**Interfaces:**
- Consumes: `ApplicationService`, `ServiceBase`, `ServiceKey`, `IServiceProvider` (`../../runtime/index.js`); `ShellModule` (`../shell/module.js`); `HierarchyActionDefinition`, `IHierarchyActionContributor` (Task 2); `HierarchyAction` (Task 1); `HierarchyItemVM` (type-only).
- Produces: `class HierarchyActionContributorRegistry extends ServiceBase` with `static Key`; `ActionsFor(nodeKey: string, node: HierarchyItemVM): readonly HierarchyAction[]` (resolves contributors for the key in Order and flat-maps `ActionsFor(node)`); `Register(def): () => void`; `RegisterInstance(contributor: IHierarchyActionContributor): () => void`; `PopulateFromModules()`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider } from '../../../runtime/index.js';
import { HierarchyActionContributorRegistry } from '../hierarchy-action-contributor-registry.js';
import { HierarchyAction } from '../hierarchy-action.js';
import type { HierarchyItemVM } from '../hierarchy-item-vm.js';
import type { IHierarchyActionContributor } from '../hierarchy-action-contributor.js';

const node = { Key: 'project' } as unknown as HierarchyItemVM;

test('ActionsFor returns registered contributors ordered by Order', () =>
{
    const reg = new HierarchyActionContributorRegistry(new ServiceProvider());
    const a: IHierarchyActionContributor = { ActionKeys: ['project'], ActionsFor: () => [HierarchyAction.Command('A', () => {})] };
    const b: IHierarchyActionContributor = { ActionKeys: ['project'], ActionsFor: () => [HierarchyAction.Command('B', () => {})] };
    reg.RegisterInstance(b);   // registered first
    reg.RegisterInstance(a);
    const labels = reg.ActionsFor('project', node).map((x) => x.Label);
    assert.deepEqual(labels, ['B', 'A']);   // insertion order preserved (both Order 0)
});

test('RegisterInstance remover unregisters', () =>
{
    const reg = new HierarchyActionContributorRegistry(new ServiceProvider());
    const off = reg.RegisterInstance({ ActionKeys: ['file'], ActionsFor: () => [HierarchyAction.Command('X', () => {})] });
    assert.equal(reg.ActionsFor('file', node).length, 1);
    off();
    assert.equal(reg.ActionsFor('file', node).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-action-contributor-registry.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** (mirror `hierarchy-contributor-registry.ts`, keyed by `ActionKeys`, `ActionsFor` flat-maps; instances carry a synthetic def with `RegisterInstance`)

```ts
import { ApplicationService, ServiceBase, ServiceKey, type IServiceProvider } from '../../runtime/index.js';
import { ShellModule } from '../shell/module.js';
import { HierarchyActionDefinition } from './hierarchy-action-contributor.js';
import type { IHierarchyActionContributor } from './hierarchy-action-contributor.js';
import type { HierarchyAction } from './hierarchy-action.js';
import type { HierarchyItemVM } from './hierarchy-item-vm.js';

// Aggregates every composed module's HierarchyActionDefinitions and answers ordered
// action lookups by NODE key. Sibling of HierarchyContributorRegistry (node children);
// this one is the action seam. Populated from `.hierarchyActions:` blocks + live
// Register/RegisterInstance, exactly as the node registry.
export class HierarchyActionContributorRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<HierarchyActionContributorRegistry>('HierarchyActionContributorRegistry');

    private readonly byKey = new Map<string, HierarchyActionDefinition[]>();
    private readonly resolved = new Map<HierarchyActionDefinition, IHierarchyActionContributor>();

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.PopulateFromModules();
    }

    public PopulateFromModules(): void
    {
        const app = this.Provider.get(ApplicationService.Key);
        if (app !== undefined)
        {
            for (const module of app.Modules)
            {
                for (const def of (module as ShellModule).HierarchyActions)
                {
                    this.add(def);
                }
            }
        }
    }

    public Register(def: HierarchyActionDefinition): () => void
    {
        this.add(def);
        return () => this.remove(def);
    }

    public RegisterInstance(contributor: IHierarchyActionContributor): () => void
    {
        const def = new HierarchyActionDefinition();
        def.ActionKeys = [...contributor.ActionKeys];
        this.add(def);
        this.resolved.set(def, contributor);
        return () => this.remove(def);
    }

    // Ordered actions contributed for a node of `nodeKey`. Tokens resolved + cached.
    public ActionsFor(nodeKey: string, node: HierarchyItemVM): readonly HierarchyAction[]
    {
        const defs = this.byKey.get(nodeKey);
        if (defs === undefined) return [];
        const out: HierarchyAction[] = [];
        for (const d of [...defs].sort((a, b) => a.Order - b.Order))
        {
            for (const action of this.resolve(d).ActionsFor(node)) out.push(action);
        }
        return out;
    }

    private add(def: HierarchyActionDefinition): void
    {
        for (const key of def.ActionKeys)
        {
            const list = this.byKey.get(key) ?? [];
            list.push(def);
            this.byKey.set(key, list);
        }
    }

    private remove(def: HierarchyActionDefinition): void
    {
        for (const key of def.ActionKeys)
        {
            const list = this.byKey.get(key);
            if (list === undefined) continue;
            const i = list.indexOf(def);
            if (i >= 0) list.splice(i, 1);
        }
        this.resolved.delete(def);
    }

    private resolve(def: HierarchyActionDefinition): IHierarchyActionContributor
    {
        let hit = this.resolved.get(def);
        if (hit === undefined)
        {
            hit = this.Provider.getRequired(def.Contributor!) as IHierarchyActionContributor;
            this.resolved.set(def, hit);
        }
        return hit;
    }
}
```

- [ ] **Step 4: Add the `HierarchyActions` collection to `ShellModule`** (after the `HierarchyContributors` field, `module.ts:~201`)

```ts
    // Declared action contributors (the `.hierarchyActions:` block) — HierarchyActionDefinitions
    // this module contributes to the HierarchyActionContributorRegistry. Same generic
    // member-block lowering as `.hierarchyContributors:` → `module.HierarchyActions.Add(def)`.
    public readonly HierarchyActions: ObservableCollection<HierarchyActionDefinition> =
        new ObservableCollection<HierarchyActionDefinition>();
```
(import `HierarchyActionDefinition` at the top of `module.ts` next to `HierarchyContributorDefinition`.)

- [ ] **Step 5: Add the compiler remap arm** (`compiler.ts:3875`, in the `memberName` ternary)

```ts
                         : block.name === 'hierarchyContributors' ? 'HierarchyContributors'
                         : block.name === 'hierarchyActions'      ? 'HierarchyActions'
                         : block.name;
```

- [ ] **Step 6: Export the new symbols** — add to `src/framework/hierarchy/index.ts` and re-export via `src/framework/index.ts` (beside the existing `HierarchyContributorDefinition`/registry exports):

```ts
export { HierarchyAction, type HierarchyActionContext } from './hierarchy-action.js';
export { HierarchyActionDefinition, type IHierarchyActionContributor } from './hierarchy-action-contributor.js';
export { HierarchyActionContributorRegistry } from './hierarchy-action-contributor-registry.js';
export { type HierarchyHost } from './hierarchy-host.js';   // added in Task 4
```

- [ ] **Step 7: Run tests + a DSL compile check**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-action-contributor-registry.test.ts"` → PASS.
Then add a `.hierarchyActions:` block to the existing `module-hierarchy-contributors.test.ts` fixture (or a new `module-hierarchy-actions.test.ts` mirroring it) asserting a compiled module's `HierarchyActions.Count === 1`; run it → PASS. Run `npm run build` (tsc) → clean.

- [ ] **Step 8: Commit**

```bash
git add src/framework/hierarchy/hierarchy-action-contributor-registry.ts src/framework/shell/module.ts src/compiler/compiler.ts src/framework/hierarchy/index.ts src/framework/index.ts src/framework/hierarchy/tests/
git commit -m "feat(hierarchy): action-contributor registry + .hierarchyActions: DSL"
```

### Task 4: `HierarchyHost` seam + refactor VMs off `onActivate`

**Files:**
- Create: `src/framework/hierarchy/hierarchy-host.ts`
- Create: `src/framework/hierarchy/hierarchy-drop.ts` — the concrete move-drop payload over `DropData`.
- Modify: `src/framework/hierarchy/hierarchy-item-vm.ts` (ctor param `onActivate` → `host`)
- Modify: `src/framework/hierarchy/hierarchy-tree-vm.ts` (ctor param `onActivate` → `host`)
- Modify: `src/framework/hierarchy/index.ts` (export `HierarchyHost`, `HierarchyItemsDrop`)
- Modify: `src/framework/hierarchy/tests/hierarchy-item-vm.test.ts` + `hierarchy-tree-vm.test.ts` (pass a fake host)

**Interfaces:**
- Produces: `interface HierarchyHost { Activate(vm: HierarchyItemVM): void; CommitRename(vm: HierarchyItemVM, newName: string): void; ActionsFor(vm: HierarchyItemVM): readonly HierarchyAction[]; CanDrop(target: HierarchyItemVM, dragged: readonly HierarchyItemVM[]): boolean; Drop(target: HierarchyItemVM, dragged: readonly HierarchyItemVM[]): void; OnItemRemoved(vm: HierarchyItemVM): void }`.
- `HierarchyItemVM` ctor becomes `(model, Id, Parent, host: HierarchyHost, placeholderText?)`; `HierarchyTreeVM` ctor becomes `(model, root, host: HierarchyHost)`. `OnActivate()` calls `this.host.Activate(this)`.

- [ ] **Step 1: Write the failing test** — add a fake host to the item-VM test harness and assert activate relays through it.

```ts
// in hierarchy-item-vm.test.ts, replace the bare `() => {}` activate callbacks with:
function fakeHost(over: Partial<HierarchyHost> = {}): HierarchyHost
{
    return {
        Activate: () => {}, CommitRename: () => {}, Delete: () => {}, ActionsFor: () => [],
        CanDrop: () => false, Drop: () => {}, OnItemRemoved: () => {},
        ...over,
    };
}

test('OnActivate relays this VM through the host', () =>
{
    const { model, root } = fileModel();
    let activated: HierarchyItemVM | undefined;
    const vm = new HierarchyItemVM(model, root, undefined, fakeHost({ Activate: (v) => { activated = v; } }));
    vm.OnActivate();
    assert.equal(activated, vm);
});
```
(Import `HierarchyHost` from `../index.js`. Update every existing `new HierarchyItemVM(...)`/`new HierarchyTreeVM(...)` call in both test files to pass `fakeHost()` instead of the `() => {}` activate arg.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-item-vm.test.ts"`
Expected: FAIL — compile/shape error (`fakeHost` / `host` unknown; ctor still typed for a function).

- [ ] **Step 3: Implement** — create `hierarchy-host.ts`:

```ts
import type { HierarchyItemVM } from './hierarchy-item-vm.js';
import type { HierarchyAction } from './hierarchy-action.js';

// The domain seam a HierarchyTreeVM is constructed with and passes to every item. The
// generic VMs stay domain-agnostic; the host (a capability service) routes activation,
// rename commit, action resolution, drop validation/apply, and selection pruning.
export interface HierarchyHost
{
    Activate(vm: HierarchyItemVM): void;
    CommitRename(vm: HierarchyItemVM, newName: string): void;
    Delete(vm: HierarchyItemVM): void;   // key-path Delete; shares the menu path (files.DeleteNode → close-guard)
    ActionsFor(vm: HierarchyItemVM): readonly HierarchyAction[];
    CanDrop(target: HierarchyItemVM, dragged: readonly HierarchyItemVM[]): boolean;
    Drop(target: HierarchyItemVM, dragged: readonly HierarchyItemVM[]): void;
    OnItemRemoved(vm: HierarchyItemVM): void;
}
```
Then in `hierarchy-item-vm.ts`: change the ctor signature `private readonly onActivate: (vm: HierarchyItemVM) => void` → `private readonly host: HierarchyHost`, import `HierarchyHost`, change `seedPlaceholder`'s child construction + `patch`'s child construction to pass `this.host`, and `OnActivate()` body to `this.host.Activate(this)`. In `hierarchy-tree-vm.ts`: ctor param `onActivate` → `host: HierarchyHost`; pass `this.host` to the `new HierarchyItemVM(...)` in `patch`.

Also create `hierarchy-drop.ts` — the concrete move payload over the minimal P0 `DropData`, referenced by both the TODL provider's `CanAccept` (Task 8) and the Plexus host/behavior (Layer 3):

```ts
import { HierarchyItemId, type DropData } from './hierarchy-node.js';

// The one drop kind P3 introduces: a move of hierarchy items. Encodes the dragged item
// ids in DropData.Payload under a fixed Kind so a provider's CanAccept can decode them.
export class HierarchyItemsDrop
{
    public static readonly Kind = 'hierarchy:items';

    public static For(items: readonly HierarchyItemId[]): DropData
    {
        return { Kind: HierarchyItemsDrop.Kind, Payload: items };
    }

    public static ItemsOf(drop: DropData): readonly HierarchyItemId[] | undefined
    {
        return drop.Kind === HierarchyItemsDrop.Kind ? (drop.Payload as readonly HierarchyItemId[]) : undefined;
    }
}
```
Export `HierarchyItemsDrop` from `index.ts`.

- [ ] **Step 4: Run to verify it passes** — both mural VM suites green.

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-item-vm.test.ts" "src/framework/hierarchy/tests/hierarchy-tree-vm.test.ts"`
Expected: PASS (all prior tests + the new relay test).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-host.ts src/framework/hierarchy/hierarchy-item-vm.ts src/framework/hierarchy/hierarchy-tree-vm.ts src/framework/hierarchy/tests/
git commit -m "feat(hierarchy): HierarchyHost seam replaces onActivate callback"
```

### Task 5: `HierarchyItemVM` inline editing + `ContextActions`

**Files:**
- Modify: `src/framework/hierarchy/hierarchy-item-vm.ts`
- Modify: `src/framework/hierarchy/tests/hierarchy-item-vm.test.ts`

**Interfaces:**
- Consumes: `HierarchyHost.CommitRename`, `HierarchyHost.ActionsFor`, `HierarchyHost.OnItemRemoved` (Task 4); `HierarchyAction` (Task 1).
- Produces on `HierarchyItemVM`: `get IsEditing(): boolean`, `get/set EditingName(): string`, `BeginEdit(): void`, `CommitEdit(): void`, `CancelEdit(): void`, `get ContextActions(): readonly HierarchyAction[]`.

- [ ] **Step 1: Write the failing test**

```ts
test('BeginEdit enters edit mode seeded with the caption; CommitEdit relays and exits', () =>
{
    const { model, root } = fileModel();
    let renamed: [HierarchyItemVM, string] | undefined;
    const vm = new HierarchyItemVM(model, root, undefined, fakeHost({ CommitRename: (v, n) => { renamed = [v, n]; } }));
    vm.BeginEdit();
    assert.equal(vm.IsEditing, true);
    assert.equal(vm.EditingName, vm.Caption);
    vm.EditingName = 'renamed';
    vm.CommitEdit();
    assert.equal(vm.IsEditing, false);
    assert.deepEqual(renamed, [vm, 'renamed']);
});

test('CancelEdit exits without relaying', () =>
{
    const { model, root } = fileModel();
    let called = 0;
    const vm = new HierarchyItemVM(model, root, undefined, fakeHost({ CommitRename: () => { called++; } }));
    vm.BeginEdit(); vm.EditingName = 'x'; vm.CancelEdit();
    assert.equal(vm.IsEditing, false);
    assert.equal(called, 0);
});

test('ContextActions pulls from the host by this node', () =>
{
    const { model, root } = fileModel();
    const marker = HierarchyAction.Command('M', () => {});
    const vm = new HierarchyItemVM(model, root, undefined, fakeHost({ ActionsFor: () => [marker] }));
    assert.deepEqual(vm.ContextActions, [marker]);
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`BeginEdit`/`IsEditing`/`ContextActions` undefined).

- [ ] **Step 3: Implement** on `HierarchyItemVM` (add the field + methods; hoist prop-name constants):

```ts
    private static readonly IsEditingProp = 'IsEditing';
    private static readonly EditingNameProp = 'EditingName';
    private _isEditing = false;
    private _editingName = '';

    public get IsEditing(): boolean { return this._isEditing; }
    public get EditingName(): string { return this._editingName; }
    public set EditingName(v: string)
    {
        const old = this._editingName;
        this._editingName = v;
        this.RaisePropertyChanged(HierarchyItemVM.EditingNameProp, old, v);
    }

    public get ContextActions(): readonly HierarchyAction[] { return this.host.ActionsFor(this); }

    public BeginEdit(): void
    {
        if (this.placeholderText !== undefined || this._isEditing) return;
        this.EditingName = this.Caption;
        this.setEditing(true);
    }

    public CommitEdit(): void
    {
        if (!this._isEditing) return;
        this.setEditing(false);
        this.host.CommitRename(this, this._editingName);   // store delta repaints authoritatively
    }

    public CancelEdit(): void { this.setEditing(false); }

    private setEditing(v: boolean): void
    {
        const old = this._isEditing;
        this._isEditing = v;
        this.RaisePropertyChanged(HierarchyItemVM.IsEditingProp, old, v);
    }
```
Also, in `dispose()`, add `this.host.OnItemRemoved(this);` as the first line (so a removed node leaves the tree's selection — consumed in Task 6).

- [ ] **Step 4: Run to verify it passes** — item-VM suite green.

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-item-vm.ts src/framework/hierarchy/tests/hierarchy-item-vm.test.ts
git commit -m "feat(hierarchy): inline editing state + ContextActions on HierarchyItemVM"
```

### Task 6: `HierarchyTreeVM` global selection surface

**Files:**
- Modify: `src/framework/hierarchy/hierarchy-tree-vm.ts`
- Modify: `src/framework/hierarchy/tests/hierarchy-tree-vm.test.ts`

**Interfaces:**
- Produces on `HierarchyTreeVM`: `readonly Selection: ObservableCollection<HierarchyItemVM>`, `get Anchor(): HierarchyItemVM | undefined`, `SelectSingle(vm)`, `Toggle(vm)`, `Deselect(vm)`, `ClearSelection()`. `Deselect` is what a `HierarchyHost.OnItemRemoved` delegates to (Task 12 wires it).

- [ ] **Step 1: Write the failing test**

```ts
test('SelectSingle replaces the set + sets the anchor; Toggle adds/removes', () =>
{
    const { tree } = /* build a tree with ≥2 roots via the existing harness */ makeTreeWithRoots(2);
    const [a, b] = [tree.Roots.Get(0)!, tree.Roots.Get(1)!];
    tree.SelectSingle(a);
    assert.deepEqual(tree.Selection.ToArray(), [a]);
    assert.equal(tree.Anchor, a);
    tree.Toggle(b);
    assert.equal(tree.Selection.Count, 2);
    tree.Toggle(b);
    assert.deepEqual(tree.Selection.ToArray(), [a]);
});

test('a removed root is pruned from the selection', () =>
{
    const { tree, removeRoot } = makeTreeWithRoots(2);
    const b = tree.Roots.Get(1)!;
    tree.SelectSingle(b);
    removeRoot(1);                                  // emit ChildRemoved for root #1
    assert.equal(tree.Selection.Count, 0);
    assert.equal(tree.Anchor, undefined);
});
```
(`makeTreeWithRoots` uses the same keyed-contributor harness the existing tree-vm test uses to seed N members; `removeRoot` drops one contribution + `NotifyContributionsChanged`, or directly emits the model delta the harness exposes.)

- [ ] **Step 2: Run to verify it fails** — `SelectSingle`/`Selection` undefined.

- [ ] **Step 3: Implement** on `HierarchyTreeVM`:

```ts
    public readonly Selection = new ObservableCollection<HierarchyItemVM>();
    private _anchor: HierarchyItemVM | undefined;
    public get Anchor(): HierarchyItemVM | undefined { return this._anchor; }

    public SelectSingle(vm: HierarchyItemVM): void
    {
        this.Selection.Clear();
        this.Selection.Add(vm);
        this._anchor = vm;
    }

    public Toggle(vm: HierarchyItemVM): void
    {
        if (this.Selection.IndexOf(vm) >= 0) { this.Selection.Remove(vm); if (this._anchor === vm) this._anchor = undefined; }
        else { this.Selection.Add(vm); this._anchor = vm; }
    }

    public Deselect(vm: HierarchyItemVM): void
    {
        this.Selection.Remove(vm);
        if (this._anchor === vm) this._anchor = undefined;
    }

    public ClearSelection(): void { this.Selection.Clear(); this._anchor = undefined; }
```
Then, in the tree VM's `patch` `ChildRemoved` branch, add `this.Deselect(vm)` before `vm.dispose()`. (Nested-item removals reach `Deselect` via `HierarchyHost.OnItemRemoved` → the host delegates to `tree.Deselect`, wired in Task 12.)

- [ ] **Step 4: Run to verify it passes** — tree-VM suite green.

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-tree-vm.ts src/framework/hierarchy/tests/hierarchy-tree-vm.test.ts
git commit -m "feat(hierarchy): global selection surface on HierarchyTreeVM"
```

**End of Layer 1.** Run the full hierarchy + list + shell suites (`npx tsx --conditions=development --test --test-force-exit "src/framework/hierarchy/tests/*.test.ts" "src/framework/shell/tests/*.test.ts"`), then `npm run build`, then copy `dist/framework/hierarchy`, `dist/framework/shell`, `dist/compiler` into `Plexus/node_modules/@pragmatic-tech-ai/mural/dist/`.

## Layer 2 — TODL (`C:\Users\Eugene\Projects\architecture-agent\TODL`)

Test runner: `npx tsx --conditions=development --test --test-force-exit "<glob>"`. After Layer 2: rebuild mural first (Layer 1 done), then `cd TODL && npm run build`, then copy `TODL/dist/solution-services/project-services/content` into `Plexus/node_modules/@pragmatic-tech-ai/todl/dist/solution-services/project-services/content`. (Mural's new hierarchy exports must already be in TODL's resolved mural — the provider imports `HierarchyItemsDrop`.)

### Task 7: `ProjectContentStore` mutations

**Files:**
- Modify: `src/solution-services/project-services/content/project-content-store.ts`
- Modify: `../../../todl-runtime/src/storage/node-fs-storage.ts` (only if `Delete` is not recursive)
- Test: `src/solution-services/project-services/content/tests/content-store-mutation.test.ts`

**Interfaces:**
- Consumes: `IStorage.WriteText`/`CreateDirectory`/`Delete`/`Rename` (all exist); the store's `pathById` (folder id→path), `nodeById` (id→node), `Root`, `RootPath`, `baseName`.
- Produces on `ProjectContentStore`: `CreateFile(parentId: ContentNodeId, name: string, content?: string): Promise<void>`, `CreateFolder(parentId, name): Promise<void>`, `Rename(id: ContentNodeId, newName: string): Promise<void>`, `Delete(id: ContentNodeId): Promise<void>`, `Move(ids: readonly ContentNodeId[], destFolderId: ContentNodeId): Promise<void>`.

- [ ] **Step 0: Verify `NodeFsStorage.Delete` recurses** — read `todl-runtime/src/storage/node-fs-storage.ts:50`. If it is `fs.unlink`/`fs.rm` without `{ recursive: true, force: true }`, change it to `await rm(path, { recursive: true, force: true })` and rebuild todl-runtime (`cd todl-runtime && npm run build`). `FakeStorage.Delete` already removes a subtree.

- [ ] **Step 1: Write the failing test** (FakeStorage + manual `EmitFileChange`, mirroring `content-store-watch.test.ts`; the store writes to disk, the watcher produces the delta)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage, FileChangeKind } from '@pragmatic-tech-ai/todl-runtime';
import { ProjectContentStore } from '../project-content-store.js';
import { ContentAdded, ContentUpdated, ContentRemoved, type ContentChange } from '../content-change.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

async function rootStore(seed: (s: FakeStorage) => Promise<void> = async () => {})
{
    const s = new FakeStorage();
    await seed(s);
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const seen: ContentChange[] = [];
    store.ObserveChildren(store.Root.Id, (c) => seen.push(c));
    await store.WhenIdle();
    return { s, store, seen };
}

test('CreateFile writes at the child path and the watcher yields ContentAdded', async () =>
{
    const { s, store, seen } = await rootStore();
    await store.CreateFile(store.Root.Id, 'new.todl', '');
    assert.equal(await s.ReadText('new.todl'), '');
    s.EmitFileChange('new.todl', FileChangeKind.Added, false);
    await tick();
    const added = seen.filter((c): c is ContentAdded => c instanceof ContentAdded);
    assert.equal(added.at(-1)!.Node.Name, 'new.todl');
});

test('Rename issues a disk rename → single ContentUpdated with the same id', async () =>
{
    const { s, store, seen } = await rootStore(async (st) => { await st.WriteText('a.todl', ''); });
    s.EmitFileChange('a.todl', FileChangeKind.Added, false); await tick();
    const id = (seen.find((c) => c instanceof ContentAdded) as ContentAdded).Node.Id;
    await store.Rename(id, 'b.todl');
    s.EmitFileChange('a.todl', FileChangeKind.Removed, false);
    s.EmitFileChange('b.todl', FileChangeKind.Added, false);
    await tick();
    const upd = seen.filter((c): c is ContentUpdated => c instanceof ContentUpdated);
    assert.equal(upd.at(-1)!.Node.Id, id);
    assert.equal(upd.at(-1)!.Node.Name, 'b.todl');
});

test('Rename to empty or slashed name is rejected and does not touch disk', async () =>
{
    const { s, store, seen } = await rootStore(async (st) => { await st.WriteText('a.todl', ''); });
    s.EmitFileChange('a.todl', FileChangeKind.Added, false); await tick();
    const id = (seen.find((c) => c instanceof ContentAdded) as ContentAdded).Node.Id;
    await assert.rejects(() => store.Rename(id, ''));
    await assert.rejects(() => store.Rename(id, 'a/b'));
    assert.equal(await s.ReadText('a.todl'), '');   // still there, untouched
});

test('Delete removes on disk → ContentRemoved', async () =>
{
    const { s, store, seen } = await rootStore(async (st) => { await st.WriteText('a.todl', ''); });
    s.EmitFileChange('a.todl', FileChangeKind.Added, false); await tick();
    const id = (seen.find((c) => c instanceof ContentAdded) as ContentAdded).Node.Id;
    await store.Delete(id);
    s.EmitFileChange('a.todl', FileChangeKind.Removed, false);
    await tick();
    assert.equal(seen.filter((c) => c instanceof ContentRemoved).length, 1);
});
```

- [ ] **Step 2: Run to verify it fails** — `store.CreateFile` etc. undefined.

- [ ] **Step 3: Implement** on `ProjectContentStore`:

```ts
    private static readonly InvalidNameMessage = 'Invalid name'

    public async CreateFile(parentId: ContentNodeId, name: string, content = ''): Promise<void>
    {
        await this.storage.WriteText(this.childPath(parentId, name), content)
    }

    public async CreateFolder(parentId: ContentNodeId, name: string): Promise<void>
    {
        await this.storage.CreateDirectory(this.childPath(parentId, name))
    }

    public async Rename(id: ContentNodeId, newName: string): Promise<void>
    {
        if (newName === '' || newName.includes('/')) throw new Error(ProjectContentStore.InvalidNameMessage)
        const path = this.pathOf(id)
        if (path === undefined) return
        const dir = ProjectContentStore.dirName(path)
        const target = dir === '' ? newName : `${dir}/${newName}`
        if (target === path) return
        await this.storage.Rename(path, target)   // watcher + settle reconciliation → ContentUpdated (same id)
    }

    public async Delete(id: ContentNodeId): Promise<void>
    {
        const path = this.pathOf(id)
        if (path !== undefined) await this.storage.Delete(path)
    }

    public async Move(ids: readonly ContentNodeId[], destFolderId: ContentNodeId): Promise<void>
    {
        const dest = this.pathById.get(destFolderId) ?? this.pathOf(destFolderId) ?? ''
        for (const id of ids)
        {
            const path = this.pathOf(id)
            if (path === undefined) continue
            const target = dest === '' ? ProjectContentStore.baseName(path) : `${dest}/${ProjectContentStore.baseName(path)}`
            if (target !== path) await this.storage.Rename(path, target)
        }
    }

    private childPath(parentId: ContentNodeId, name: string): string
    {
        const dir = this.pathById.get(parentId) ?? this.pathOf(parentId) ?? ''
        return dir === '' ? name : `${dir}/${name}`
    }

    private pathOf(id: ContentNodeId): string | undefined
    {
        if (id === this.Root.Id) return ProjectContentStore.RootPath
        return this.nodeById.get(id)?.Path
    }

    private static dirName(path: string): string
    {
        const i = path.lastIndexOf('/')
        return i === -1 ? '' : path.slice(0, i)
    }
```
(A genuine filesystem collision surfaces as the thrown `IStorage.Rename` error; because the store never optimistically mutates its own model — only the watcher delta does — a failed mutation leaves the tree unchanged and the row reverts.)

- [ ] **Step 4: Run to verify it passes** — mutation suite green + the existing content suites still green (`content-store-*.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/solution-services/project-services/content/project-content-store.ts src/solution-services/project-services/content/tests/content-store-mutation.test.ts
git commit -m "feat(content-store): CreateFile/CreateFolder/Rename/Delete/Move via storage"
```

### Task 8: `ProjectContentProvider.CanAccept`

**Files:**
- Modify: `src/solution-services/project-services/content/project-content-provider.ts`
- Test: `src/solution-services/project-services/content/tests/content-provider-drop.test.ts`

**Interfaces:**
- Consumes: `HierarchyItemsDrop` (mural, Task 4); the provider's `nodeFor(id)` (private, exists), `ProjectNodeKind.Folder`.
- Produces: real `CanAccept(target, drop)` replacing the `return false` stub.

- [ ] **Step 1: Write the failing test** (seed a folder + a file, observe to mint ids, assert the rules)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage, FileChangeKind } from '@pragmatic-tech-ai/todl-runtime';
import { HierarchyItemId, HierarchyItemsDrop, ChildAdded, type HierarchyChange } from '@pragmatic-tech-ai/mural/framework/hierarchy';
import { ProjectContentStore } from '../project-content-store.js';
import { ProjectContentProvider } from '../project-content-provider.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

test('CanAccept: only a folder target accepts a same-provider item; rejects self/descendant/foreign', async () =>
{
    const s = new FakeStorage();
    await s.CreateDirectory('dir');
    await s.WriteText('a.todl', '');
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const provider = new ProjectContentProvider(store);
    const ids = new Map<string, HierarchyItemId>();
    provider.ObserveChildren(provider.ParseCanonicalName(''), (c: HierarchyChange) =>
    { if (c instanceof ChildAdded) ids.set((c.Node.ExtObject as { Path: string }).Path, c.Id); });
    store.RealizeRootForTest?.();               // or trigger load; see note
    s.EmitFileChange('dir', FileChangeKind.Added, true);
    s.EmitFileChange('a.todl', FileChangeKind.Added, false);
    await tick();

    const dir = ids.get('dir')!;
    const file = ids.get('a.todl')!;
    assert.equal(provider.CanAccept(dir, HierarchyItemsDrop.For([file])), true);   // file → folder
    assert.equal(provider.CanAccept(file, HierarchyItemsDrop.For([file])), false);  // target not a folder
    assert.equal(provider.CanAccept(dir, HierarchyItemsDrop.For([dir])), false);    // onto itself
    assert.equal(provider.CanAccept(dir, HierarchyItemsDrop.For([HierarchyItemId.Mint()])), false); // foreign id
    assert.equal(provider.CanAccept(dir, { Kind: 'other', Payload: undefined }), false); // wrong kind
});
```
(Note: trigger the root load the way `content-provider.test.ts` already does — call `provider.ObserveChildren` then emit; drop the `RealizeRootForTest?.()` line and follow that file's exact priming pattern.)

- [ ] **Step 2: Run to verify it fails** — the stub returns `false` for the folder-accepts-file case → assertion fails.

- [ ] **Step 3: Implement** — replace the `CanAccept` stub:

```ts
    public CanAccept(target: HierarchyItemId, drop: DropData): boolean
    {
        const items = HierarchyItemsDrop.ItemsOf(drop)
        if (items === undefined || items.length === 0) return false
        const targetNode = this.nodeFor(target)
        if (targetNode === undefined || targetNode.Kind !== ProjectNodeKind.Folder) return false
        for (const id of items)
        {
            const node = this.nodeFor(id)
            if (node === undefined) return false                                   // foreign / cross-provider
            if (node.Path === targetNode.Path) return false                        // onto itself
            if (targetNode.Path === node.Path || targetNode.Path.startsWith(`${node.Path}/`)) return false   // into own descendant
        }
        return true
    }
```
(Add `HierarchyItemsDrop` to the `@pragmatic-tech-ai/mural/framework/hierarchy` import.)

- [ ] **Step 4: Run to verify it passes** — drop suite green.

- [ ] **Step 5: Commit**

```bash
git add src/solution-services/project-services/content/project-content-provider.ts src/solution-services/project-services/content/tests/content-provider-drop.test.ts
git commit -m "feat(content-provider): CanAccept validates same-provider folder drops"
```

**End of Layer 2.** Run the content suites; `npm run build`; copy `TODL/dist/solution-services/project-services/content` into `Plexus/node_modules/@pragmatic-tech-ai/todl/dist/...`.

## Layer 3 — plexus-core (`Plexus/packages/plexus-core`)

Test runner: `npx vitest run <path>`. Rebuild plexus-core (`npm run build`) after edits so apps read the changes. **Refinement of spec §5.1 (flag at plan review):** `ProjectExplorerService` already implements the file/project mutations against `member.Storage` (open-doc relocation, close-guard, factory formats, dialogs) and the content store watches that same storage, so mutations route through re-typed `ProjectExplorerService` methods; `FileTreeContributor` is the thin façade the host calls (maps a vm → member/path and delegates), preserving the spec's "one home the host talks to."

### Task 9: Re-type `ProjectExplorerService` mutations to `SolutionMember`

**Files:**
- Modify: `src/renderer/modules/project-explorer/services/project-explorer-service.ts`
- Create: `src/renderer/modules/project-explorer/services/content-mutations.ts` — the `IContentMutations` interface + `ContentMutationsKey`.
- Test: `apps/plexus/src/renderer/src/modules/project-explorer/tests/project-explorer-service.test.ts` (extend)

**Interfaces:**
- Consumes: the existing private `newFileIn`/`newFolderIn`/`importFilesInto`/`importFolderInto`/`bumpVersion`/`setVersionDialog`/`updateAgentMetadata`/`publishProject`/`refreshBases`/`manageReferences`/`closeProject`/`beginRename`/`commitRename`/`exportNode` (all take `op: OpenProject`) + `this.projected: Map<SolutionMember, OpenProject>` (exists) + `isVersioned(op.Factory)`.
- Produces: `interface IContentMutations` (in `content-mutations.ts`) + `ProjectExplorerService` public member-keyed wrappers implementing it:
  `RenameMemberFile(member, path, newName): Promise<void>`, `DeleteMemberFile(member, path): Promise<void>` (runs the close-guard + relocation the private path already has), `NewFileForMember(member, folder, format): Promise<void>`, `NewFolderForMember(member, folder, name): Promise<void>`, `ImportFilesForMember(member, target): Promise<void>`, `ImportFolderForMember(member, target): Promise<void>`, `MoveMemberNodes(member, paths, destPath): Promise<void>`, `PublishMember(member)`, `BumpMemberVersion(member, part)`, `SetMemberVersion(member)`, `ManageMemberReferences(member)`, `RefreshMemberBases(member)`, `UpdateMemberAgentMetadata(member)`, `CloseMember(member)`, `FormatsFor(member): readonly ProjectFileFormat[]`, `IsVersionedMember(member): boolean`, `CanRefreshBasesMember(member): boolean`, `SupportsScaffoldMember(member): boolean`. Each resolves `const op = this.projected.get(member); if (op === undefined) return;` then calls the existing private method.

- [ ] **Step 1: Write the failing test** — a member-keyed wrapper resolves the projected op and delegates.

```ts
test('RenameMemberFile resolves the projected op and renames via storage', async () =>
{
    const { svc, addOpenProject } = harness();
    const { member } = await addOpenProject('proj', { 'a.todl': '' });   // existing harness helper
    await svc.RenameMemberFile(member, 'a.todl', 'b.todl');
    // storage.Rename was invoked (the harness FakeStorage records it) and the open doc, if any, relocated:
    assert.ok(member.Storage!.renamed?.some(([from, to]) => from === 'a.todl' && to === 'b.todl'));
});

test('IsVersionedMember reflects the member factory', async () =>
{
    const { svc, addOpenProject } = harness();
    const { member } = await addOpenProject('proj', {}, { versioned: true });
    assert.equal(svc.IsVersionedMember(member), true);
});
```
(Use the existing `project-explorer-service.test.ts` harness — it already builds members/OpenProjects; add a `renamed` recorder to its FakeStorage or assert via the projected op's storage.)

- [ ] **Step 2: Run to verify it fails** — `RenameMemberFile` undefined.

- [ ] **Step 3: Implement** — add `content-mutations.ts`:

```ts
import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { SolutionMember, ProjectFileFormat } from '@pragmatic-tech-ai/todl'
import type { VersionPart } from '...'   // reuse the existing VersionPart enum import site

// The member-keyed mutation surface the Solution Explorer's contributors + host call.
// Implemented by ProjectExplorerService (which resolves the projected OpenProject and
// keeps open-doc relocation / close-guard / dialogs). One seam so contributors don't
// depend on the whole service.
export interface IContentMutations
{
    RenameMemberFile(member: SolutionMember, path: string, newName: string): Promise<void>
    DeleteMemberFile(member: SolutionMember, path: string): Promise<void>
    NewFileForMember(member: SolutionMember, folder: string, format: ProjectFileFormat): Promise<void>
    NewFolderForMember(member: SolutionMember, folder: string, name: string): Promise<void>
    ImportFilesForMember(member: SolutionMember, target: string): Promise<void>
    ImportFolderForMember(member: SolutionMember, target: string): Promise<void>
    MoveMemberNodes(member: SolutionMember, paths: readonly string[], destPath: string): Promise<void>
    PublishMember(member: SolutionMember): Promise<void>
    BumpMemberVersion(member: SolutionMember, part: VersionPart): Promise<void>
    SetMemberVersion(member: SolutionMember): Promise<void>
    ManageMemberReferences(member: SolutionMember): Promise<void>
    RefreshMemberBases(member: SolutionMember): void
    UpdateMemberAgentMetadata(member: SolutionMember): Promise<void>
    CloseMember(member: SolutionMember): Promise<void>
    FormatsFor(member: SolutionMember): readonly ProjectFileFormat[]
    IsVersionedMember(member: SolutionMember): boolean
    CanRefreshBasesMember(member: SolutionMember): boolean
    SupportsScaffoldMember(member: SolutionMember): boolean
}

export const ContentMutationsKey = new ServiceKey<IContentMutations>('ContentMutations')
```
Then in `project-explorer-service.ts`: declare `implements ... IContentMutations`, and add each public wrapper. Representative wrappers (rename needs new-name→path in the folder; reuse `beginRename`/`commitRename`'s rename core, or add a small `renameFile(op, path, newName)` extracted from `commitRename`):

```ts
    public async RenameMemberFile(member: SolutionMember, path: string, newName: string): Promise<void>
    {
        const op = this.projected.get(member)
        if (op === undefined) return
        await this.renameFile(op, path, newName)   // extracted core of commitRename: storage.Rename + relocateOpenFile
    }

    public async DeleteMemberFile(member: SolutionMember, path: string): Promise<void>
    {
        const op = this.projected.get(member)
        if (op === undefined) return
        await this.deleteFile(op, path)            // extracted core of the node Delete: close-guard + storage.Delete
    }

    public FormatsFor(member: SolutionMember): readonly ProjectFileFormat[]
    {
        return this.projected.get(member)?.Factory.formats ?? []
    }

    public IsVersionedMember(member: SolutionMember): boolean
    {
        const op = this.projected.get(member)
        return op !== undefined && isVersioned(op.Factory)
    }
    // … the remaining wrappers follow the same resolve-then-delegate shape …
```
Register `ProjectExplorerService` under `ContentMutationsKey` too (in the project-explorer module's `.services:`, mapping `ProjectExplorerService -> ContentMutationsKey`), so contributors resolve the seam without depending on the concrete class.

- [ ] **Step 4: Run to verify it passes** — the extended project-explorer test + the full apps project-explorer suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/project-explorer/services/content-mutations.ts packages/plexus-core/src/renderer/modules/project-explorer/services/project-explorer-service.ts apps/plexus/src/renderer/src/modules/project-explorer/tests/project-explorer-service.test.ts
git commit -m "feat(project-explorer): member-keyed IContentMutations surface"
```

### Task 10: `FileTreeContributor` façade + file action contributor

**Files:**
- Modify: `src/renderer/modules/solution-explorer/services/file-tree-contributor.ts`
- Test: `packages/plexus-core/.../tests/file-tree-contributor.test.ts` (extend) + a new façade test.

**Interfaces:**
- Consumes: `IContentMutations` (Task 9); `HierarchyAction`, `IHierarchyActionContributor`, `HierarchyItemsDrop`, `HierarchyItemVM` (mural); `ContentNodeKey` + `NodeKey`; `ProjectContentNode`, `SolutionMember`; its own `providers` map (per member).
- Produces on `FileTreeContributor`:
  - `implements IHierarchyActionContributor` — `ActionKeys = [ContentNodeKey.Folder, ContentNodeKey.File, ContentNodeKey.Diagram, ContentNodeKey.Todl, NodeKey.Project]`; `ActionsFor(vm)` builds the file actions (New Folder, Add New ▸ format, Import File…, Import Folder…, Rename, Delete) closing over `this.mutations` + the resolved member.
  - Façade the host calls: `RenameNode(vm, name)`, `DeleteNode(vm)`, `CanDrop(target, dragged)`, `Drop(target, dragged)`.
  - `SetMutations(m: IContentMutations)` (injected by SolutionExplorerService); `ProviderFor(member)`; `static MemberOf(vm): SolutionMember | undefined` (climb `vm.Parent` to the row whose `Data` is a `SolutionMember`).

- [ ] **Step 1: Write the failing test** (fake `IContentMutations` records calls)

```ts
test('Delete action runs the close-guard path via mutations (not the store directly)', async () =>
{
    const { contributor, memberRowVm, fileVm, mutations } = fileHarness();   // builds a member + a file row over a FakeStorage store
    const del = contributor.ActionsFor(fileVm).find((a) => a.Label === 'Delete')!;
    del.Invoke.Execute();
    await Promise.resolve();
    assert.deepEqual(mutations.deleted.at(-1), [FileTreeContributor.MemberOf(fileVm), 'a.todl']);
});

test('CanDrop delegates to the member provider CanAccept', () =>
{
    const { contributor, folderVm, fileVm } = fileHarness();
    assert.equal(contributor.CanDrop(folderVm, [fileVm]), true);
    assert.equal(contributor.CanDrop(fileVm, [fileVm]), false);   // target not a folder
});
```

- [ ] **Step 2: Run to verify it fails** — `ActionsFor`/`CanDrop` undefined.

- [ ] **Step 3: Implement** — add to `FileTreeContributor` (representative; the full action set follows the same shape):

```ts
    public readonly ActionKeys = [ContentNodeKey.Folder, ContentNodeKey.File, ContentNodeKey.Diagram, ContentNodeKey.Todl, NodeKey.Project]
    private mutations: IContentMutations | undefined

    public SetMutations(m: IContentMutations): void { this.mutations = m }

    public ActionsFor(vm: HierarchyItemVM): readonly HierarchyAction[]
    {
        const member = FileTreeContributor.MemberOf(vm)
        if (member === undefined || this.mutations === undefined) return []
        const isProjectRow = vm.Data === member                      // the project/member row itself
        const folder = isProjectRow ? '' : FileTreeContributor.folderOf(vm)
        const out: HierarchyAction[] = []
        const addNew = HierarchyAction.Command('Add New', () => {})
        for (const f of this.mutations.FormatsFor(member))
        {
            addNew.Children.Add(HierarchyAction.Command(f.displayName, () => void this.mutations!.NewFileForMember(member, folder, f)))
        }
        out.push(addNew)
        out.push(HierarchyAction.Command('New Folder', () => void this.mutations!.NewFolderForMember(member, folder, 'New Folder')))
        out.push(HierarchyAction.Command('Import File…', () => void this.mutations!.ImportFilesForMember(member, folder)))
        out.push(HierarchyAction.Command('Import Folder…', () => void this.mutations!.ImportFolderForMember(member, folder)))
        if (!isProjectRow)
        {
            out.push(HierarchyAction.Separator())
            out.push(HierarchyAction.Command('Rename', (c) => c.Anchor.BeginEdit()))
            out.push(HierarchyAction.Command('Delete', () => void this.DeleteNode(vm)))
        }
        return out
    }

    public async RenameNode(vm: HierarchyItemVM, name: string): Promise<void>
    {
        const member = FileTreeContributor.MemberOf(vm)
        if (member !== undefined && this.mutations !== undefined) await this.mutations.RenameMemberFile(member, (vm.Data as ProjectContentNode).Path, name)
    }

    public async DeleteNode(vm: HierarchyItemVM): Promise<void>
    {
        const member = FileTreeContributor.MemberOf(vm)
        if (member !== undefined && this.mutations !== undefined) await this.mutations.DeleteMemberFile(member, (vm.Data as ProjectContentNode).Path)
    }

    public CanDrop(target: HierarchyItemVM, dragged: readonly HierarchyItemVM[]): boolean
    {
        const member = FileTreeContributor.MemberOf(target)
        const provider = member === undefined ? undefined : this.providers.get(member)
        if (provider === undefined || dragged.length === 0) return false
        if (FileTreeContributor.MemberOf(dragged[0]!) !== member) return false   // same-member only
        return provider.CanAccept(target.Id, HierarchyItemsDrop.For(dragged.map((d) => d.Id)))
    }

    public Drop(target: HierarchyItemVM, dragged: readonly HierarchyItemVM[]): void
    {
        const member = FileTreeContributor.MemberOf(target)
        if (member === undefined || this.mutations === undefined) return
        const destPath = (target.Data as ProjectContentNode | SolutionMember) === member ? '' : (target.Data as ProjectContentNode).Path
        void this.mutations.MoveMemberNodes(member, dragged.map((d) => (d.Data as ProjectContentNode).Path), destPath)
    }

    public ProviderFor(member: SolutionMember): ProjectContentProvider | undefined { return this.providers.get(member) }

    public static MemberOf(vm: HierarchyItemVM): SolutionMember | undefined
    {
        let cur: HierarchyItemVM | undefined = vm
        while (cur !== undefined)
        {
            if (FileTreeContributor.isMember(cur.Data)) return cur.Data as SolutionMember
            cur = cur.Parent
        }
        return undefined
    }

    private static folderOf(vm: HierarchyItemVM): string
    {
        const node = vm.Data as ProjectContentNode
        return node.Kind === ProjectNodeKind.Folder ? node.Path : ProjectContentStore.parentDir(node.Path)
    }
```
(Add `isMember` as an `is<X>` type-guard free function per the house-style exception; add a `parentDir` static to the store or a local helper. `ContentNodeKey`/`NodeKey` imports as needed.)

- [ ] **Step 4: Run to verify it passes** — file-tree-contributor suite green.

- [ ] **Step 5: Commit** — `git commit -m "feat(solution-explorer): FileTreeContributor action contributor + mutation façade"`.

### Task 11: `ProjectActionsContributor`

**Files:**
- Create: `src/renderer/modules/solution-explorer/services/project-actions-contributor.ts`
- Test: `packages/plexus-core/.../tests/project-actions-contributor.test.ts`

**Interfaces:**
- Consumes: `IContentMutations` (Task 9); `HierarchyAction`, `IHierarchyActionContributor`, `HierarchyItemVM`; `NodeKey`; `SolutionMember`.
- Produces: `class ProjectActionsContributor implements IHierarchyActionContributor` — `ActionKeys = [NodeKey.Project]`; ctor `(mutations: IContentMutations)`; `ActionsFor(vm)` builds Close / Publish / Bump Version ▸ (Major/Minor/Patch) / Set Version… / Manage References… / Refresh Bases / Update Agent Metadata, each `canExecute`-gated (`IsVersionedMember`, `CanRefreshBasesMember`, `SupportsScaffoldMember`) and routed to a `mutations` method with `MemberOf(vm)`.

- [ ] **Step 1: Write the failing test**

```ts
test('Publish is present + enabled only for a versioned member', () =>
{
    const versioned = new ProjectActionsContributor(fakeMutations({ IsVersionedMember: () => true }))
    const plain = new ProjectActionsContributor(fakeMutations({ IsVersionedMember: () => false }))
    const vm = memberRowVm(someMember)
    assert.equal(versioned.ActionsFor(vm).find((a) => a.Label === 'Publish')!.Invoke.CanExecute(), true)
    assert.equal(plain.ActionsFor(vm).find((a) => a.Label === 'Publish')!.Invoke.CanExecute(), false)
})

test('Close routes to mutations.CloseMember with the row member', () =>
{
    const m = fakeMutations()
    const vm = memberRowVm(someMember)
    new ProjectActionsContributor(m).ActionsFor(vm).find((a) => a.Label === 'Close Project')!.Invoke.Execute()
    assert.equal(m.closed.at(-1), someMember)
})
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement** — `ActionsFor(vm)` with `const member = FileTreeContributor.MemberOf(vm)` guard; build the actions with `HierarchyAction.Command(label, () => void this.mutations.XMember(member, …), { context, canExecute })`. Use `private static readonly` label constants.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit** — `git commit -m "feat(solution-explorer): ProjectActionsContributor (project lifecycle actions)"`.

### Task 12: `SolutionExplorerService` implements `HierarchyHost`

**Files:**
- Modify: `src/renderer/modules/solution-explorer/services/solution-explorer-service.ts`
- Modify: `packages/plexus-core/package.json` (export `project-actions-contributor` + `content-mutations` if referenced by apps) — likely no change (internal).
- Test: `apps/plexus/.../modules/solution-explorer/tests/solution-explorer-service.test.ts` (extend)

**Interfaces:**
- Consumes: `HierarchyHost`, `HierarchyActionContributorRegistry`, `HierarchyAction`, `HierarchyItemVM` (mural); `FileTreeContributor` façade (Task 10); `ProjectActionsContributor` (Task 11); `IContentMutations`/`ContentMutationsKey` (Task 9); `HierarchyTreeVM.Selection`/`Deselect` (Task 6).
- Produces: `SolutionExplorerService implements HierarchyHost`: `Activate(vm)` (P2's onActivate body), `CommitRename(vm, name)` → `files.RenameNode(vm, name)`, `ActionsFor(vm)` → `registry.ActionsFor(vm.Key, vm)`, `CanDrop`/`Drop` → `files.CanDrop`/`files.Drop`, `OnItemRemoved(vm)` → `this._tree?.Deselect(vm)`. In `rebuild`, construct `HierarchyTreeVM(model, root, this)` (host = this), inject `files.SetMutations(this.provider.getRequired(ContentMutationsKey))`, and `actionRegistry.RegisterInstance(this.files)` + `RegisterInstance(new ProjectActionsContributor(mutations))`, tracking removers in `teardownCurrent`.

- [ ] **Step 1: Write the failing test** — extend the P2 solution-explorer test:

```ts
test('activating a file row opens it; committing a rename routes to mutations', async () =>
{
    const { svc, manager, mutations } = make();   // make() now registers a fake IContentMutations + HierarchyActionContributorRegistry
    svc.Start(); manager.SetActive(solutionWith('a'))
    const memberRow = svc.Tree!.Roots.Get(0)!
    memberRow.OnExpand()
    // … drive a ChildAdded for a file via the fake store, get the fileVm …
    const fileVm = memberRow.Children.Get(0)!
    fileVm.BeginEdit(); fileVm.EditingName = 'b.todl'; fileVm.CommitEdit()
    assert.deepEqual(mutations.renamed.at(-1), [/*member*/ manager.ActiveSolution!.Members.Get(0), 'a', 'b.todl'])
})

test('ActionsFor concats the registered contributors for the node key', () =>
{
    const { svc, manager } = make()
    svc.Start(); manager.SetActive(solutionWith('a'))
    const memberRow = svc.Tree!.Roots.Get(0)!
    assert.ok(svc.ActionsFor(memberRow).some((a) => a.Label === 'Close Project'))
})
```

- [ ] **Step 2: Run to verify it fails** — `svc.ActionsFor` / host wiring absent.

- [ ] **Step 3: Implement** — change `new HierarchyTreeVM(this.model, root, (vm) => { void this.onActivate(vm) })` to `new HierarchyTreeVM(this.model, root, this)`; add the `HierarchyHost` methods; resolve `HierarchyActionContributorRegistry` + `ContentMutationsKey`; register the two action contributors per solution (store removers; unregister in `teardownCurrent`); keep P2's node-contributor wiring.

- [ ] **Step 4: Run to verify it passes** — solution-explorer suite green.

- [ ] **Step 5: Commit** — `git commit -m "feat(solution-explorer): SolutionExplorerService implements HierarchyHost"`.

**End of Layer 3 (plexus-core).** `npm run build` in plexus-core.

## Layer 4 — apps/plexus (`Plexus/apps/plexus`)

Test runner: `npx vitest run <path>` (unit); `PLEXUS_TEST_CORPUS="C:/Users/Eugene/Projects/architecture-agent/plexus_test_projects" npx playwright test <name>` (e2e, after `npm run build`).

### Task 13: App-module action contributors + register the action registry

**Files:**
- Modify: `src/renderer/src/app.mu` (register `HierarchyActionContributorRegistry` in `.services:`; add each module's `.hierarchyActions:`)
- Create: `src/renderer/src/modules/skills/services/skill-action-contributor.ts` (replaces `SkillProjectMenuSource`)
- Create: `src/renderer/src/modules/architecture-projects/services/arch-action-contributor.ts` (replaces `ArchNodeCommandContributor`)
- Create: `src/renderer/src/modules/diagram-export/services/diagram-export-action-contributor.ts`
- Modify the three modules' `.module.mu` to add `.hierarchyActions:` + drop the old `-> ProjectMenuSourceKey`/`NodeCommandContributorKey` registrations.
- Tests: one `*.test.ts` per contributor (skills is the review-focus one).

**Interfaces:**
- Consumes: `HierarchyAction`, `IHierarchyActionContributor`, `HierarchyItemVM`, `HierarchyActionContributorRegistry` (mural); `FileTreeContributor.MemberOf` + `SolutionMember` (plexus-core/todl); `ContentNodeKey`, `NodeKey`; `SkillCatalog`/`SkillRunner`/`SkillChoiceBuilder`; `ArchDiagramBindingService`/`DiagramViewpointsEditor` + `IContentMutations` (to open the diagram); `DiagramTreeExportKey`/`DiagramExportFormat`.
- Produces: three `IHierarchyActionContributor`s registered via `.hierarchyActions:`.

- [ ] **Step 1: Write the failing test (skills — the async-submenu review-focus case)**

```ts
test('Run Agent/Skill yields an action whose Children fill in async; empty catalog leaves an empty submenu', async () =>
{
    const svc = new SkillActionContributor(providerWith({ catalog: emptyCatalog(), runner: fakeRunner() }))
    const vm = memberRowVm(archMember)
    const [run] = svc.ActionsFor(vm)
    assert.equal(run.Label, 'Run Agent / Skill')
    await run.WhenReadyForTest?.()      // or: await a tick the impl exposes
    assert.equal(run.Children.Count, 0) // empty catalog → empty, usable submenu (no throw, no spinner-forever)
})
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement the skills contributor** (async `Children`, generalizing `SkillProjectMenuSource.MenuFor`):

```ts
export class SkillActionContributor extends ServiceBase implements IHierarchyActionContributor
{
    public static readonly Key = new ServiceKey<SkillActionContributor>('SkillActionContributor')
    private static readonly RunLabel = 'Run Agent / Skill'
    public readonly ActionKeys = [NodeKey.Project]

    public ActionsFor(vm: HierarchyItemVM): readonly HierarchyAction[]
    {
        const member = FileTreeContributor.MemberOf(vm)
        if (member?.Storage === undefined) return []
        const folder = member.Storage.Root   // the member's project folder path
        const run = HierarchyAction.Command(SkillActionContributor.RunLabel, () => {})
        void this.fill(run, folder, member)
        return [run]
    }

    private async fill(run: HierarchyAction, folder: string, member: SolutionMember): Promise<void>
    {
        const catalog = this.Provider.get(SkillCatalog.Key)
        const runner = this.Provider.get(SkillRunner.Key)
        if (catalog === undefined || runner === undefined) return
        await catalog.discoverAll([folder])
        const skills = catalog.forProject(folder)
        for (const c of SkillChoiceBuilder.fromSkills(skills, (s) => { void runner.run(s, folder, member.Title) }))
        {
            run.Children.Add(HierarchyAction.Command(c.Label, () => c.Command.Execute()))
        }
    }
}
```
(Confirm the member→folder path accessor against `SolutionMember`/`IStorage` — likely `member.Storage.Root` or a member path; adjust to the real accessor. The arch + export contributors follow the same shape: `ArchActionContributor` ActionKeys `[ContentNodeKey.Diagram]`, returns "Edit Viewpoints…" when the member is architecture; `DiagramExportActionContributor` ActionKeys `[ContentNodeKey.Diagram]`, returns an "Export" action with SVG/PPTX children when `DiagramTreeExportKey` resolves.)

- [ ] **Step 4: Register** — in `app.mu` `.services:` add `HierarchyActionContributorRegistry` (import from `@pragmatic-tech-ai/mural/framework/hierarchy`); in each module's `.module.mu` add:
```
    .hierarchyActions: {
        HierarchyActionDefinition [ ActionKeys = [NodeKey.Project], Contributor = SkillActionContributor, Order = 100 ]
    }
```
and remove that module's `SkillProjectMenuSource -> ProjectMenuSourceKey` (and arch's `NodeCommandContributorKey`) registration.

- [ ] **Step 5: Run to verify it passes** + `npm run compile:mu` clean.

- [ ] **Step 6: Commit** — `git commit -m "feat(plexus): app-module .hierarchyActions: contributors (skills/arch/export)"`.

### Task 14: Panel resources — context menu + rename slot

**Files:**
- Modify: `packages/plexus-core/src/renderer/modules/solution-explorer/solution-explorer.resources.mu` (or the app's merged copy — match where P2 put it) + rebuild plexus-core mu.
- No unit test (covered by Task 16 e2e); gate = compiles + app boots.

**Interfaces:**
- Consumes: `HierarchyAction` (`Label`/`Invoke`/`Children`/`IsSeparator`), `HierarchyItemVM` (`ContextActions`/`IsEditing`/`EditingName`/`Caption`).

- [ ] **Step 1: Add a recursive action template + wire the row** (mirror the retired `project-explorer.resources.mu` menu + `RenameEditorTemplate`):

```
    // One context-menu entry — recurses via Children for submenus (Add New, Run Agent/Skill).
    DataTemplate x:key="HierarchyActionTemplate" [ DataType = HierarchyAction ] {
        MenuItem [ Header = $Label, Command = $Invoke,
                   ItemsControl.ItemsSource = $Children, ItemsControl.ItemTemplate = @HierarchyActionTemplate ]
    }

    ContextMenu x:key="HierarchyContextMenu"
        [ ItemsControl.ItemsSource = $ContextActions, ItemsControl.ItemTemplate = @HierarchyActionTemplate ]

    DataTemplate x:key="HierarchyRenameEditor" [ DataType = HierarchyItemVM ] {
        Border { .Behaviors: { FocusOnVisibleBehavior }
            TextBox [ Text = $EditingName, Variant = Plain, MinWidth = 80, VerticalAlignment = Center, SelectionBrush = @TextSelectionBg ] }
    }
```
In the existing `HierarchicalDataTemplate [DataType = HierarchyItemVM]` row: add `ContextMenuService.ContextMenu = @HierarchyContextMenu` on the root Border; hide the caption `TextBlock` while editing (`Visibility = $IsEditing << EditingToLabelVisibility`) and add a lazy `ContentPresenter x:name="PART_RenameSlot"` swapped to `@HierarchyRenameEditor` under `when ( $IsEditing = true )` (the P2 file's `EditingToLabelVisibility`/`RenameEditorTemplate` pattern verbatim). A separator entry: add `when ( $IsSeparator = true ) { … MenuSeparator … }` or a second keyed template selected by `IsSeparator` (follow how the codebase templates a separator; simplest: a `Style`/trigger swapping the MenuItem for a `MenuSeparator`).

- [ ] **Step 2: Compile** — `cd packages/plexus-core && npm run build`; `cd apps/plexus && npm run compile:mu` → clean.

- [ ] **Step 3: Commit** — `git commit -m "feat(solution-explorer): context-menu + inline-rename panel resources"`.

### Task 15: Input behaviors driving the host

**Files:**
- Create under `apps/plexus/src/renderer/src/modules/solution-explorer/behaviors/`: `hierarchy-selection-behavior.ts`, `hierarchy-key-behavior.ts`, `hierarchy-drag-drop-behavior.ts`.
- Modify the panel `.mu` to attach them (`.Behaviors:` on the TreeView / wrapper Border).
- Test: `apps/plexus/.../tests/hierarchy-key-behavior.test.ts` (F2/Delete/Enter/Escape routing on a fake tree VM).

**Interfaces:**
- Consumes: mural `Behavior`/`Selector`/`Visual`/`KeyEventArgs`/`Key`; `HierarchyTreeVM` (`SelectSingle`/`Toggle`/`Selection`/`Anchor`); `HierarchyItemVM` (`BeginEdit`/`CommitEdit`/`CancelEdit`); `HierarchyHost` (`CanDrop`/`Drop`) reached via the tree's DataContext.
- Produces: three `Behavior` subclasses (ports of `TreeSelectionBehavior`/`TreeDragDropBehavior`/`handleTreeKey`, retargeted to the tree VM + host). `HierarchyKeyBehavior`: F2→`Anchor.BeginEdit()`; Return→`Anchor.CommitEdit()`; Escape→`Anchor.CancelEdit()`; Delete→each `Selection` item via `host.Delete(vm)` (already on the `HierarchyHost` interface from Task 4; `SolutionExplorerService.Delete` routes to `files.DeleteNode`, close-guard inside), so the key path and menu path share it.

- [ ] **Step 1: Write the failing test** for `HierarchyKeyBehavior` (fake tree VM records calls): F2 begins edit on the anchor; Return commits; Escape cancels; Delete calls host.Delete for each selected.

- [ ] **Step 2–4:** implement the three behaviors (mirror the gathered `TreeSelectionBehavior`/`TreeDragDropBehavior` shapes: `OnAttached(visual)` guards `Selector`/draggable `Visual`; drag `over`→`host.CanDrop` tint, `drop`→`host.Drop`); implement `SolutionExplorerService.Delete(vm)` → `files.DeleteNode(vm)` (the interface member from Task 4); attach the behaviors in `.mu`; run tests green + `compile:mu`.

- [ ] **Step 5: Commit** — `git commit -m "feat(solution-explorer): selection/key/drag behaviors driving the host"`.

### Task 16: Seam re-homing + e2e

**Files:**
- Modify: wherever `ProjectTreeHostKey` reveal / cross-file-open is consumed (grep `ProjectTreeHostKey` in apps + plexus-core) — re-point reveal to `SolutionExplorerService` (minimal: open + best-effort select; full reveal is P6). Confirm the content `FileWatchService` no longer double-watches project content (the store watches now) — if it does, scope it out for members owned by the Solution Explorer.
- Create: `apps/plexus/e2e/solution-explorer-mutation.spec.ts`.

**Interfaces:**
- Consumes: the P2 e2e harness (`launchPlexus`/`seedSession`/`corpusAvailable`/`rectsForCtor`/`clickCenter`/`snapshot`, corpus at `plexus_test_projects`).

- [ ] **Step 1: Write the e2e (gated by `corpusAvailable`)** — reveal the Solution Explorer, then: (a) right-click a file → the context menu shows Rename/Delete; (b) Rename → the row's caption updates; (c) New file (Add New ▸ a format) → a new row appears and enters inline edit; (d) Delete → the row disappears; (e) drag a file into a folder → it moves under the folder; (f) a producer project row shows Publish; (g) the Run Agent/Skill submenu populates. Error checks are **deltas** (pre-existing `ERR_FILE_NOT_FOUND` at boot).

```ts
test('rename a file row updates its caption', async () =>
{
    // reveal explorer; expand microsoft; right-click microsoft.todl; click Rename;
    // type + Enter; assert a row for the new name exists and the old name is gone.
})
```
(Model launch/reveal/expand on the P2 `solution-explorer.spec.ts`; interact via `getByText`/context-menu coordinates as the retired menu e2e did.)

- [ ] **Step 2: Run** — `npm run build`, then `PLEXUS_TEST_CORPUS=… npx playwright test solution-explorer` → the P2 specs + the new mutation specs pass; the app boots (delta error checks).

- [ ] **Step 3: Commit** — `git commit -m "feat(plexus): re-home tree-host seams; Solution Explorer mutation e2e"`.

**End of Layer 4.** Full gates: plexus-core vitest; apps vitest; `PLEXUS_TEST_CORPUS=… npx playwright test solution-explorer` (build first). Then the whole-branch review (most capable model) across the three repo branches.
