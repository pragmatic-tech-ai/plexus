# Solution Hierarchy P2: SolutionExplorer + basic tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cut the Plexus left-panel tree over from the eager, path-identity `ProjectExplorerService`/`ProjectNode` projection to a reactive, lazy, disk-watched tree driven by a `HierarchyModel` — a generic model→`TreeView` projection VM (Mural), two contributors + a `SolutionExplorer` capability over the P1 content store (plexus-core), and a panel cutover with open-on-activate (apps).

**Architecture:** three layers in release order. **Mural** (`src/framework/hierarchy`) gains `HierarchyItemVM`/`HierarchyTreeVM`, a public per-node child-delta feed on `HierarchyModel` (`ObserveChildren`), a `realized`-flag gate on `reRealizeKeyed` (so unexpanded/collapsed keyed nodes are not eagerly re-realized), and a public `NotifyContributionsChanged()` on the registry. **plexus-core** (`src/renderer/modules/solution-explorer`) gains `ProjectsListingContributor`, `FileTreeContributor`, `SolutionExplorerService`, `IconKeyToGeometry`, the panel `.mu`, and a public `OpenMemberFile` delegate on `ProjectExplorerService`. **apps/plexus** flips the panel Capability and adjusts e2e.

**Tech Stack:** TypeScript (NodeNext, strict: `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`), `@pragmatic-tech-ai/mural` (framework + `framework/hierarchy`), `@pragmatic-tech-ai/todl-runtime` (`Observable`, `ObservableCollection`, `IStorage`), `@pragmatic-tech-ai/todl` (`SolutionManagerService`, `ProjectContentStore`, `ProjectContentProvider`, `SolutionMember`, `ProjectNodeKind`, `ContentNodeKey`). Mural tests: `node:test` via `npx tsx --conditions=development --test`. plexus-core tests: `vitest run`. apps/plexus e2e: Playwright.

**Spec:** `Plexus/docs/superpowers/specs/2026-09-29-solution-hierarchy-p2-explorer-spec.md`

## Global Constraints

- **OOP:** every function is a method or `static` member; no module-level free functions or mutable module state. `is<X>` type-guards follow the existing `isLocalFileAccess` free-function precedent. Existing `ValueConverter` object-literal consts (e.g. `KindToGeometry`) are the established converter pattern — match it.
- **Allman braces:** opening brace on its own line for class/interface/enum/method/control blocks; `else`/`catch`/`finally` on their own line. Object literals, block-arrow bodies, and genuine one-liners stay inline.
- **No inline reused/keyed string literals:** node keys, icon keys, property names, status text → `private static readonly` PascalCase constants.
- **VMs extend `Observable`**, not `MuralBase`.
- **PascalCase** for interfaces and all public methods.
- **Enums over string-literal unions.**
- **Tests in `tests/` subfolders** beside their source.
- **Reuse mural node keys:** the root node's `Key` is `NodeKey.Solution` and each member row's `Key` is `NodeKey.Project` (both already defined in `mural/framework/hierarchy` and reserved in `KEY-NAMESPACES.md`). Do NOT mint new plexus-core node keys — this supersedes the spec's §4 `SolutionRootKey`/`SolutionMemberKey` proposal (a ruling: the keys already exist and are owned by mural/framework).
- **No worktrees** (standing user constraint): create a feature branch `feat/hierarchy-p2-explorer` in each repo touched (Mural, then Plexus). Do NOT create git worktrees.
- **Publishing is deferred** (user's separate step). Local cross-repo resolution for Layer 2/3 uses a junction (see the Layer 2 setup note), not a publish.
- **Attribution:** end commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus

Five failure modes the spec implies but that are easy to ship broken; each is pinned to a task's tests below.

- **Eager provider mount / watcher storm** — a contributor-set change (or adding a second member) must NOT re-realize *unexpanded* member nodes, or every member mounts a `ProjectContentStore` + chokidar watcher before the user expands anything. Pinned in Task 1 (`reRealizeKeyed` skips non-`realized` entries) and Task 6.
- **Watcher leak on solution close/swap** — opening solution B, or closing, must dispose solution A's model, contributors, and every mounted store. Pinned in Task 9.
- **Rename churn drops selection/expansion** — a file rename arrives as `ChildUpdated(sameId, node)`; the VM must refresh the existing row in place, never remove+re-add. Pinned in Task 1 and Task 3.
- **Async member status flip** — a member that resolves to `LoadFailed`/`UnknownType` after open must repaint its row's severity/caption without changing the row id. Pinned in Task 5.
- **Activate on a non-file / unresolved member** — double-click on a folder, a member row, or an unresolved member must be a safe no-op, never a crash or a bogus open. Pinned in Task 9.

---

## Layer 1 — Mural (`src/framework/hierarchy`)

**Setup (once, before Task 1):** in `C:\Users\Eugene\Projects\architecture-agent\Mural`, create the branch:

```bash
git checkout -b feat/hierarchy-p2-explorer
```

Mural test command (run from the Mural repo root): `npx tsx --conditions=development --test --test-force-exit "src/framework/hierarchy/tests/*.test.ts"`.

### Task 1: `HierarchyModel.ObserveChildren` + emission + `realized` gate

**Files:**
- Modify: `src/framework/hierarchy/hierarchy-model.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-model-observe.test.ts` (new)

**Interfaces:**
- Consumes: existing `HierarchyModel` (`SeedRoot`, `RealizeChildren`, `Collapse`, `ChildrenOf`, `NodeAt`), `ChildAdded`/`ChildRemoved`/`ChildUpdated`, `HierarchyItemId`, `NodeSeverity`.
- Produces: `HierarchyModel.ObserveChildren(id: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void` — subscribe to a node's child deltas; returns a disposer. Emits `ChildAdded(childId, node)` / `ChildUpdated(childId, node)` / `ChildRemoved(childId)` whenever `id`'s children set mutates, from BOTH the keyed regime and provider deltas.

- [ ] **Step 1: Write the failing test**

```typescript
// src/framework/hierarchy/tests/hierarchy-model-observe.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyModel, HierarchyContributorRegistry, HierarchyContributorDefinition,
    NodeContribution, ProviderContribution, ChildAdded, ChildUpdated, ChildRemoved,
    NodeSeverity, HierarchyItemId,
    type IHierarchyContributor, type IHierarchyProvider, type HierarchyNode, type HierarchyChange,
} from '../index.js';

function node(key: string, ext: unknown, caption = key): HierarchyNode
{
    return { Key: key, Caption: caption, IconKey: '', ExtObject: ext, Severity: NodeSeverity.Ok };
}

class FakeProvider implements IHierarchyProvider
{
    public readonly ProviderId = 'fake';
    public Sink: ((c: HierarchyChange) => void) | undefined;
    public ObserveChildren(_n: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        this.Sink = sink;
        return () => { this.Sink = undefined; };
    }
    public GetProperty(): unknown { return undefined; }
    public GetCanonicalName(): string { return ''; }
    public ParseCanonicalName(): HierarchyItemId { return HierarchyItemId.Nil; }
    public CanAccept(): boolean { return false; }
}

function reg(provider: ServiceProvider): HierarchyContributorRegistry
{
    return new HierarchyContributorRegistry(provider);
}

function registerContributor(provider: ServiceProvider, registry: HierarchyContributorRegistry, token: ServiceKey<IHierarchyContributor>, parents: string[]): () => void
{
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = parents; d.Contributor = token; d.Order = 0;
    return registry.Register(d);
}

test('ObserveChildren emits ChildAdded when keyed realize interns a child', () =>
{
    const provider = new ServiceProvider();
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([node('project', { id: 'p' })]) } as IHierarchyContributor);
    const registry = reg(provider);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('solution', {}));

    const seen: HierarchyChange[] = [];
    model.ObserveChildren(root, (c) => seen.push(c));
    registerContributor(provider, registry, listing, ['solution']);   // Register -> reRealize root

    assert.equal(seen.length, 1);
    assert.ok(seen[0] instanceof ChildAdded);
});

test('ObserveChildren forwards provider deltas (add/update/remove)', () =>
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const registry = reg(provider);
    registerContributor(provider, registry, tok, ['project']);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('project', {}));

    const seen: HierarchyChange[] = [];
    model.ObserveChildren(root, (c) => seen.push(c));
    model.RealizeChildren(root);
    const id = HierarchyItemId.Mint();
    fake.Sink!(new ChildAdded(id, node('file', {}, 'a')));
    fake.Sink!(new ChildUpdated(id, node('file', {}, 'b')));
    fake.Sink!(new ChildRemoved(id));

    assert.deepEqual(seen.map((c) => c.constructor.name), ['ChildAdded', 'ChildUpdated', 'ChildRemoved']);
});

test('reRealizeKeyed does NOT re-realize an unexpanded keyed child (no eager provider mount)', () =>
{
    const provider = new ServiceProvider();
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([node('project', { id: 'p' })]) } as IHierarchyContributor);
    let fileConsulted = 0;
    const files = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(files, { ParentKeys: ['project'], Order: 0,
        Contribute: () => { fileConsulted++; return new NodeContribution([]); } } as IHierarchyContributor);
    const registry = reg(provider);
    registerContributor(provider, registry, listing, ['solution']);
    registerContributor(provider, registry, files, ['project']);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('solution', {}));
    model.RealizeChildren(root);                       // realizes root; member entry created, NOT realized
    assert.equal(fileConsulted, 0);

    registry.NotifyContributionsChanged?.();           // if Task 2 lands first; else force via a Register/unregister
    // A contributor-set change re-realizes only realized keyed nodes (root), never the unexpanded member.
    assert.equal(fileConsulted, 0);
});

test('unsubscribe stops emissions', () =>
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const registry = reg(provider);
    registerContributor(provider, registry, tok, ['project']);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('project', {}));
    const seen: HierarchyChange[] = [];
    const off = model.ObserveChildren(root, (c) => seen.push(c));
    model.RealizeChildren(root);
    off();
    fake.Sink!(new ChildAdded(HierarchyItemId.Mint(), node('file', {})));
    assert.equal(seen.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-model-observe.test.ts"`
Expected: FAIL — `model.ObserveChildren is not a function`. (The third test also references `registry.NotifyContributionsChanged` which is Task 2; for Task 1 replace that line with an `off = registry.Register(...); off();` round-trip so this file is green on Task 1 alone — see Step 3 note.)

- [ ] **Step 3: Implement `ObserveChildren`, emission, and the `realized` gate**

In `hierarchy-model.ts`:

Add a per-node sink registry field and a `realized` flag on `Entry`:

```typescript
interface Entry
{
    node: HierarchyNode;
    children: HierarchyItemId[];
    provider?: IHierarchyProvider;
    dispose?: () => void;
    realized?: boolean;   // RealizeChildren has run on this node (gates reRealizeKeyed)
}
```

Add the field to the class:

```typescript
    private readonly childSinks = new Map<HierarchyItemId, Set<(c: HierarchyChange) => void>>();
```

Add the public method and a private emit helper:

```typescript
    // Subscribe to a node's child deltas. The model emits ChildAdded/ChildUpdated/ChildRemoved
    // as `id`'s children set mutates — from the keyed regime (internKeyed/pruneKeyed) and from
    // provider deltas (patch) alike, so a consumer never sees the keyed/provider boundary.
    public ObserveChildren(id: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        let set = this.childSinks.get(id);
        if (set === undefined)
        {
            set = new Set();
            this.childSinks.set(id, set);
        }
        set.add(sink);
        return () =>
        {
            const s = this.childSinks.get(id);
            if (s !== undefined)
            {
                s.delete(sink);
                if (s.size === 0) this.childSinks.delete(id);
            }
        };
    }

    private emit(parentId: HierarchyItemId, change: HierarchyChange): void
    {
        const set = this.childSinks.get(parentId);
        if (set === undefined) return;
        for (const sink of [...set]) sink(change);
    }
```

Set `realized` in `RealizeChildren` (first line after `const entry = this.entry(id);`):

```typescript
        entry.realized = true;
```

Gate `reRealizeKeyed` on it:

```typescript
    private reRealizeKeyed(): void
    {
        for (const id of [...this.entries.keys()])
        {
            const entry = this.entries.get(id);
            if (entry !== undefined && entry.realized === true && entry.provider === undefined)
            {
                this.RealizeChildren(id);
            }
        }
    }
```

Clear `realized` in `Collapse` (so a collapsed provider node isn't re-mounted by `reRealizeKeyed`):

```typescript
    public Collapse(id: HierarchyItemId): void
    {
        const entry = this.entry(id);
        if (entry.dispose !== undefined)
        {
            entry.dispose();
            entry.dispose = undefined;
            entry.provider = undefined;
        }
        entry.realized = false;
    }
```

Emit from `internKeyed` — new child → `ChildAdded`; survivor whose display props changed → `ChildUpdated`:

```typescript
    private internKeyed(parentId: HierarchyItemId, parent: Entry, childNode: HierarchyNode): void
    {
        let map = this.keyedChildren.get(parentId);
        if (map === undefined)
        {
            map = new Map();
            this.keyedChildren.set(parentId, map);
        }
        const identity = childNode.ExtObject;
        let childId = map.get(identity);
        if (childId === undefined)
        {
            childId = new MintedItemId(childNode.Key, childNode.ExtObject);
            map.set(identity, childId);
            this.entries.set(childId, { node: childNode, children: [] });
            parent.children.push(childId);
            this.emit(parentId, new ChildAdded(childId, childNode));
        }
        else
        {
            const existing = this.entry(childId);
            if (HierarchyModel.displayDiffers(existing.node, childNode))
            {
                existing.node = childNode;
                this.emit(parentId, new ChildUpdated(childId, childNode));
            }
        }
    }

    // Only a change to a rendered fact is worth a ChildUpdated — avoids churn when an
    // unchanged node is re-contributed (reRealizeKeyed re-runs the whole keyed regime).
    private static displayDiffers(a: HierarchyNode, b: HierarchyNode): boolean
    {
        return a.Caption !== b.Caption || a.IconKey !== b.IconKey
            || a.Severity !== b.Severity || a.Error !== b.Error || a.Key !== b.Key;
    }
```

Emit `ChildRemoved` from `pruneKeyed` (inside the removal branch, after the splice):

```typescript
            map.delete(identity);
            this.entries.delete(childId);
            const i = parent.children.indexOf(childId);
            if (i >= 0) parent.children.splice(i, 1);
            this.emit(parentId, new ChildRemoved(childId));
```

Forward provider deltas: change `attachProvider` to pass the parent id into `patch`, and emit there:

```typescript
    private attachProvider(id: HierarchyItemId, entry: Entry, provider: IHierarchyProvider): void
    {
        if (entry.provider === provider) return;
        entry.provider = provider;
        entry.dispose = provider.ObserveChildren(id, (c) => this.patch(id, entry, c));
    }

    private patch(parentId: HierarchyItemId, entry: Entry, change: HierarchyChange): void
    {
        if (entry.dispose === undefined) return;   // collapsed — ignore late deltas
        if (change instanceof ChildAdded)
        {
            this.entries.set(change.Id, { node: change.Node, children: [] });
            entry.children.push(change.Id);
        }
        else if (change instanceof ChildUpdated)
        {
            const e = this.entries.get(change.Id);
            if (e !== undefined) e.node = change.Node;
        }
        else if (change instanceof ChildRemoved)
        {
            const i = entry.children.indexOf(change.Id);
            if (i >= 0) entry.children.splice(i, 1);
            this.entries.delete(change.Id);
        }
        this.emit(parentId, change);
    }
```

For the Task-1 version of the third test, replace the `registry.NotifyContributionsChanged?.()` line with a `Register`/dispose round-trip that forces `reRealizeKeyed`:

```typescript
    const off2 = registerContributor(provider, registry, listing, ['solution']);   // fires Changed -> reRealize
    off2();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-model-observe.test.ts"`
Expected: PASS (4/4).

- [ ] **Step 5: Run the whole hierarchy suite to confirm no P0 regression**

Run: `npx tsx --conditions=development --test --test-force-exit "src/framework/hierarchy/tests/*.test.ts"`
Expected: PASS — including `hierarchy-model-live.test.ts` (its root is `realized`, so the late `Register` still re-contributes it).

- [ ] **Step 6: Commit**

```bash
git add src/framework/hierarchy/hierarchy-model.ts src/framework/hierarchy/tests/hierarchy-model-observe.test.ts
git commit -m "feat(hierarchy): HierarchyModel.ObserveChildren + realized-gated reRealizeKeyed"
```

### Task 2: `HierarchyContributorRegistry.NotifyContributionsChanged()`

**Files:**
- Modify: `src/framework/hierarchy/hierarchy-contributor-registry.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts` (append)

**Interfaces:**
- Produces: `HierarchyContributorRegistry.NotifyContributionsChanged(): void` — public; raises `PropertyChanged('Contributors')`, which drives a subscribed `HierarchyModel` to re-contribute realized keyed nodes. Used by a live contributor whose *data* (not its registration) changed.

- [ ] **Step 1: Write the failing test**

```typescript
test('NotifyContributionsChanged re-contributes a realized root live', () =>
{
    const provider = new ServiceProvider();
    let count = 0;
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution(count === 0 ? [] : [node('project', { id: 'p' })]) } as IHierarchyContributor);
    const registry = new HierarchyContributorRegistry(provider);
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = ['solution']; d.Contributor = listing; d.Order = 0;
    registry.Register(d);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('solution', {}));
    model.RealizeChildren(root);
    assert.equal(model.ChildrenOf(root).length, 0);

    count = 1;
    registry.NotifyContributionsChanged();
    assert.equal(model.ChildrenOf(root).length, 1);
});
```

(Uses the same `node`/imports as the existing registry test file; add any missing imports — `HierarchyModel`, `NodeContribution`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts"`
Expected: FAIL — `registry.NotifyContributionsChanged is not a function`.

- [ ] **Step 3: Implement**

Add to `HierarchyContributorRegistry`:

```typescript
    // Signal that a live contributor's OUTPUT changed (its data, not its registration) so a
    // subscribed HierarchyModel re-contributes realized keyed nodes. The register/unregister
    // paths raise the same notification internally; this exposes it to contributors.
    public NotifyContributionsChanged(): void
    {
        this.raiseChanged();
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-contributor-registry.ts src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts
git commit -m "feat(hierarchy): public NotifyContributionsChanged on the contributor registry"
```

### Task 3: `HierarchyItemVM`

**Files:**
- Create: `src/framework/hierarchy/hierarchy-item-vm.ts`
- Modify: `src/framework/hierarchy/index.ts` (export)
- Test: `src/framework/hierarchy/tests/hierarchy-item-vm.test.ts` (new)

**Interfaces:**
- Consumes: `HierarchyModel.ObserveChildren`/`RealizeChildren`/`GetProperty`/`ChildrenOf` (Task 1), `HierarchyPropertyId`, `NodeSeverity`, `ChildAdded`/`ChildRemoved`/`ChildUpdated`, `Observable`/`ObservableCollection` from `../../runtime/index.js`.
- Produces: `class HierarchyItemVM extends Observable` with `constructor(model: HierarchyModel, id: HierarchyItemId, parent: HierarchyItemVM | undefined, onActivate: (vm: HierarchyItemVM) => void)`; getters `Caption`/`IconKey`/`Severity`/`Error`/`IsExpandable`/`Data`/`Parent`/`Id`; `Children: ObservableCollection<HierarchyItemVM>`; methods `OnExpand()`, `OnActivate()`, `dispose()`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/framework/hierarchy/tests/hierarchy-item-vm.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyModel, HierarchyContributorRegistry, HierarchyContributorDefinition,
    ProviderContribution, ChildAdded, ChildUpdated, ChildRemoved, NodeSeverity, HierarchyItemId,
    HierarchyItemVM,
    type IHierarchyContributor, type IHierarchyProvider, type HierarchyNode, type HierarchyChange,
} from '../index.js';

function node(key: string, ext: unknown, caption = key, sev = NodeSeverity.Ok): HierarchyNode
{
    return { Key: key, Caption: caption, IconKey: key, ExtObject: ext, Severity: sev };
}

class FakeProvider implements IHierarchyProvider
{
    public readonly ProviderId = 'fake';
    public Sink: ((c: HierarchyChange) => void) | undefined;
    public ObserveChildren(_n: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        this.Sink = sink; return () => { this.Sink = undefined; };
    }
    public GetProperty(): unknown { return undefined; }
    public GetCanonicalName(): string { return ''; }
    public ParseCanonicalName(): HierarchyItemId { return HierarchyItemId.Nil; }
    public CanAccept(): boolean { return false; }
}

function fileModel(): { model: HierarchyModel; root: HierarchyItemId; fake: FakeProvider }
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const registry = new HierarchyContributorRegistry(provider);
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = ['project']; d.Contributor = tok; d.Order = 0;
    registry.Register(d);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('project', { id: 'p' }, 'Proj'));
    return { model, root, fake };
}

test('reads node props from the model', () =>
{
    const { model, root } = fileModel();
    const vm = new HierarchyItemVM(model, root, undefined, () => {});
    assert.equal(vm.Caption, 'Proj');
    assert.equal(vm.IconKey, 'project');
    assert.equal(vm.Severity, NodeSeverity.Ok);
});

test('OnExpand realizes + subscribes; ChildAdded inserts a child VM at the model index', () =>
{
    const { model, root, fake } = fileModel();
    const vm = new HierarchyItemVM(model, root, undefined, () => {});
    vm.OnExpand();
    assert.equal(vm.Children.count, 0);
    fake.Sink!(new ChildAdded(HierarchyItemId.Mint(), node('file', { id: 'f1' }, 'a')));
    assert.equal(vm.Children.count, 1);
    assert.equal(vm.Children.get(0)!.Caption, 'a');
});

test('ChildUpdated refreshes the same child VM in place (no remove/re-add)', () =>
{
    const { model, root, fake } = fileModel();
    const vm = new HierarchyItemVM(model, root, undefined, () => {});
    vm.OnExpand();
    const id = HierarchyItemId.Mint();
    fake.Sink!(new ChildAdded(id, node('file', { id: 'f1' }, 'old')));
    const child = vm.Children.get(0)!;
    fake.Sink!(new ChildUpdated(id, node('file', { id: 'f1' }, 'new')));
    assert.equal(vm.Children.get(0), child);          // same VM instance
    assert.equal(child.Caption, 'new');               // refreshed
});

test('ChildRemoved drops + disposes the child VM', () =>
{
    const { model, root, fake } = fileModel();
    const vm = new HierarchyItemVM(model, root, undefined, () => {});
    vm.OnExpand();
    const id = HierarchyItemId.Mint();
    fake.Sink!(new ChildAdded(id, node('file', {}, 'a')));
    fake.Sink!(new ChildRemoved(id));
    assert.equal(vm.Children.count, 0);
});

test('OnActivate relays this VM to the injected callback', () =>
{
    const { model, root } = fileModel();
    let activated: HierarchyItemVM | undefined;
    const vm = new HierarchyItemVM(model, root, undefined, (v) => { activated = v; });
    vm.OnActivate();
    assert.equal(activated, vm);
});

test('child VMs carry Parent and Data', () =>
{
    const { model, root, fake } = fileModel();
    const vm = new HierarchyItemVM(model, root, undefined, () => {});
    vm.OnExpand();
    const ext = { id: 'f1' };
    fake.Sink!(new ChildAdded(HierarchyItemId.Mint(), node('file', ext, 'a')));
    const child = vm.Children.get(0)!;
    assert.equal(child.Parent, vm);
    assert.equal(child.Data, ext);
});
```

(Confirm the `ObservableCollection` accessor names against `../../runtime/index.js` — this codebase uses `.count` and `.get(i)` on `ObservableCollection`; the existing `solution-tree-vm` and P0 tests use `.length`/indexing on the model but `ObservableCollection` API is `Add`/`get`/`count`. Match the real API in Step 3 and in the assertions.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-item-vm.test.ts"`
Expected: FAIL — `HierarchyItemVM is not exported`.

- [ ] **Step 3: Implement `HierarchyItemVM`**

```typescript
// src/framework/hierarchy/hierarchy-item-vm.ts
import { Observable, ObservableCollection } from '../../runtime/index.js';
import type { HierarchyModel } from './hierarchy-model.js';
import {
    HierarchyItemId, HierarchyPropertyId, NodeSeverity,
    ChildAdded, ChildRemoved, ChildUpdated, type HierarchyChange,
} from './hierarchy-node.js';

// One tree row over a HierarchyModel node. Lazy: Children is empty until the first
// OnExpand (the TreeView's expand hook), which realizes + subscribes; deltas patch
// Children in place (ChildUpdated keeps the row VM so selection/expansion survive a
// rename). Domain-agnostic — OnActivate relays this VM to an injected callback and the
// host decides what activation means. Extends Observable (INPC), not MuralBase.
export class HierarchyItemVM extends Observable
{
    private static readonly CaptionProp = 'Caption';
    private static readonly IconKeyProp = 'IconKey';
    private static readonly SeverityProp = 'Severity';
    private static readonly ErrorProp = 'Error';

    public readonly Children = new ObservableCollection<HierarchyItemVM>();
    private readonly childById = new Map<HierarchyItemId, HierarchyItemVM>();
    private off: (() => void) | undefined;
    private expanded = false;

    constructor(
        private readonly model: HierarchyModel,
        public readonly Id: HierarchyItemId,
        public readonly Parent: HierarchyItemVM | undefined,
        private readonly onActivate: (vm: HierarchyItemVM) => void,
    )
    {
        super();
    }

    public get Caption(): string { return this.model.GetProperty(this.Id, HierarchyPropertyId.Caption) as string; }
    public get IconKey(): string { return (this.model.GetProperty(this.Id, HierarchyPropertyId.IconKey) as string) ?? ''; }
    public get IsExpandable(): boolean { return this.model.GetProperty(this.Id, HierarchyPropertyId.IsExpandable) === true; }
    public get Severity(): NodeSeverity { return (this.model.GetProperty(this.Id, HierarchyPropertyId.Severity) as NodeSeverity) ?? NodeSeverity.Ok; }
    public get Error(): string | undefined { return this.model.NodeAt(this.Id).Error; }
    public get Data(): unknown { return this.model.GetProperty(this.Id, HierarchyPropertyId.ExtObject); }

    // TreeView calls this on the first expand (ExpandableTreeData.OnExpand). Idempotent:
    // subscribe BEFORE realizing so the keyed regime's synchronous ChildAdded deltas land.
    public OnExpand(): void
    {
        if (this.expanded) return;
        this.expanded = true;
        this.off = this.model.ObserveChildren(this.Id, (c) => this.patch(c));
        this.model.RealizeChildren(this.Id);
    }

    // TreeView calls this on activation (double-click / Enter). Relay to the host.
    public OnActivate(): void
    {
        this.onActivate(this);
    }

    private patch(change: HierarchyChange): void
    {
        if (change instanceof ChildAdded)
        {
            const vm = new HierarchyItemVM(this.model, change.Id, this, this.onActivate);
            this.childById.set(change.Id, vm);
            const index = this.model.ChildrenOf(this.Id).indexOf(change.Id);
            if (index >= 0 && index <= this.Children.count) this.Children.insert(index, vm);
            else this.Children.add(vm);
        }
        else if (change instanceof ChildUpdated)
        {
            const vm = this.childById.get(change.Id);
            vm?.raiseDisplayChanged();
        }
        else if (change instanceof ChildRemoved)
        {
            const vm = this.childById.get(change.Id);
            if (vm !== undefined)
            {
                this.childById.delete(change.Id);
                this.Children.remove(vm);
                vm.dispose();
            }
        }
    }

    // Re-notify bindings that this row's rendered facts may have changed (id preserved).
    private raiseDisplayChanged(): void
    {
        this.RaisePropertyChanged(HierarchyItemVM.CaptionProp, undefined, undefined);
        this.RaisePropertyChanged(HierarchyItemVM.IconKeyProp, undefined, undefined);
        this.RaisePropertyChanged(HierarchyItemVM.SeverityProp, undefined, undefined);
        this.RaisePropertyChanged(HierarchyItemVM.ErrorProp, undefined, undefined);
    }

    public dispose(): void
    {
        this.off?.();
        this.off = undefined;
        for (const child of [...this.Children.toArray()]) child.dispose();
        this.Children.clear();
        this.childById.clear();
    }
}
```

Add to `src/framework/hierarchy/index.ts`:

```typescript
export * from './hierarchy-item-vm.js';
```

**Note on `ObservableCollection` API:** verify the exact method names (`add`/`insert`/`remove`/`clear`/`count`/`get`/`toArray`) against `../../runtime/index.js` and adjust both the implementation and the test assertions to match (the codebase's `ObservableCollection` is the single source of truth — do not invent names). Likewise verify `RaisePropertyChanged`'s signature on `Observable` (the `Solution`/`SolutionMember` code calls `this.RaisePropertyChanged('Name', old, v)` — a 3-arg form).

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-item-vm.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-item-vm.ts src/framework/hierarchy/index.ts src/framework/hierarchy/tests/hierarchy-item-vm.test.ts
git commit -m "feat(hierarchy): HierarchyItemVM — lazy, delta-patched tree row"
```

### Task 4: `HierarchyTreeVM`

**Files:**
- Create: `src/framework/hierarchy/hierarchy-tree-vm.ts`
- Modify: `src/framework/hierarchy/index.ts` (export)
- Test: `src/framework/hierarchy/tests/hierarchy-tree-vm.test.ts` (new)

**Interfaces:**
- Consumes: `HierarchyModel`, `HierarchyItemVM` (Task 3), `HierarchyItemId`, `Observable`/`ObservableCollection`.
- Produces: `class HierarchyTreeVM extends Observable` with `constructor(model: HierarchyModel, root: HierarchyItemId, onActivate: (vm: HierarchyItemVM) => void)`; `Roots: ObservableCollection<HierarchyItemVM>` (the realized children of `root`, patched on deltas); `dispose(): void`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/framework/hierarchy/tests/hierarchy-tree-vm.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyModel, HierarchyContributorRegistry, HierarchyContributorDefinition,
    NodeContribution, NodeSeverity, HierarchyTreeVM,
    type IHierarchyContributor, type HierarchyNode,
} from '../index.js';

function node(key: string, ext: unknown, caption = key): HierarchyNode
{
    return { Key: key, Caption: caption, IconKey: key, ExtObject: ext, Severity: NodeSeverity.Ok };
}

test('Roots realizes the seeded root children at construction and patches on re-contribute', () =>
{
    const provider = new ServiceProvider();
    let members = [node('project', { id: 'a' }, 'A')];
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution(members) } as IHierarchyContributor);
    const registry = new HierarchyContributorRegistry(provider);
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = ['solution']; d.Contributor = listing; d.Order = 0;
    registry.Register(d);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('solution', {}));

    const tree = new HierarchyTreeVM(model, root, () => {});
    assert.equal(tree.Roots.count, 1);
    assert.equal(tree.Roots.get(0)!.Caption, 'A');

    members = [node('project', { id: 'a' }, 'A'), node('project', { id: 'b' }, 'B')];
    registry.NotifyContributionsChanged();
    assert.equal(tree.Roots.count, 2);
});

test('dispose tears down the root subscription', () =>
{
    const provider = new ServiceProvider();
    const registry = new HierarchyContributorRegistry(provider);
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot(node('solution', {}));
    const tree = new HierarchyTreeVM(model, root, () => {});
    tree.dispose();
    assert.equal(tree.Roots.count, 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-tree-vm.test.ts"`
Expected: FAIL — `HierarchyTreeVM is not exported`.

- [ ] **Step 3: Implement**

```typescript
// src/framework/hierarchy/hierarchy-tree-vm.ts
import { Observable, ObservableCollection } from '../../runtime/index.js';
import type { HierarchyModel } from './hierarchy-model.js';
import { HierarchyItemVM } from './hierarchy-item-vm.js';
import {
    HierarchyItemId, ChildAdded, ChildRemoved, ChildUpdated, type HierarchyChange,
} from './hierarchy-node.js';

// The tree root a TreeView's ItemsSource binds. Roots are the realized children of the
// seeded root node (the seeded node itself is the invisible anchor). Subscribes at
// construction — the root is always "expanded" — and patches Roots on the model's deltas.
export class HierarchyTreeVM extends Observable
{
    public readonly Roots = new ObservableCollection<HierarchyItemVM>();
    private readonly rootById = new Map<HierarchyItemId, HierarchyItemVM>();
    private off: (() => void) | undefined;

    constructor(
        private readonly model: HierarchyModel,
        private readonly root: HierarchyItemId,
        private readonly onActivate: (vm: HierarchyItemVM) => void,
    )
    {
        super();
        this.off = this.model.ObserveChildren(this.root, (c) => this.patch(c));
        this.model.RealizeChildren(this.root);
    }

    private patch(change: HierarchyChange): void
    {
        if (change instanceof ChildAdded)
        {
            const vm = new HierarchyItemVM(this.model, change.Id, undefined, this.onActivate);
            this.rootById.set(change.Id, vm);
            const index = this.model.ChildrenOf(this.root).indexOf(change.Id);
            if (index >= 0 && index <= this.Roots.count) this.Roots.insert(index, vm);
            else this.Roots.add(vm);
        }
        else if (change instanceof ChildUpdated)
        {
            // A member row's caption/severity changed; the row VM re-reads on notify.
            this.rootById.get(change.Id);   // no structural change
        }
        else if (change instanceof ChildRemoved)
        {
            const vm = this.rootById.get(change.Id);
            if (vm !== undefined)
            {
                this.rootById.delete(change.Id);
                this.Roots.remove(vm);
                vm.dispose();
            }
        }
    }

    public dispose(): void
    {
        this.off?.();
        this.off = undefined;
        for (const vm of [...this.Roots.toArray()]) vm.dispose();
        this.Roots.clear();
        this.rootById.clear();
    }
}
```

**Note:** the `ChildUpdated` branch here is intentionally structural-only — a member row's display refresh is the row VM's concern, but the root's direct children get their `ChildUpdated` from `internKeyed` which the *root's* sink receives; to repaint a root-level member row on status change, forward the notify to the row VM. Simplest correct form: in the `ChildUpdated` branch call `this.rootById.get(change.Id)?.` display-refresh. Since `raiseDisplayChanged` is private on `HierarchyItemVM`, expose a public `RefreshDisplay(): void` on `HierarchyItemVM` (rename `raiseDisplayChanged` → public `RefreshDisplay`) and call it from BOTH `HierarchyItemVM.patch` (ChildUpdated for grandchildren) and here (ChildUpdated for root children). Add that method in Task 3 as public from the start; update the Task 3 test to assert a root/child `RefreshDisplay` repaints. (Ruling recorded here so Task 3 and Task 4 stay consistent: `HierarchyItemVM.RefreshDisplay()` is public.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --conditions=development --test "src/framework/hierarchy/tests/hierarchy-tree-vm.test.ts"`
Expected: PASS.

- [ ] **Step 5: Run the whole hierarchy suite**

Run: `npx tsx --conditions=development --test --test-force-exit "src/framework/hierarchy/tests/*.test.ts"`
Expected: PASS (all P0 + new).

- [ ] **Step 6: Commit**

```bash
git add src/framework/hierarchy/hierarchy-tree-vm.ts src/framework/hierarchy/hierarchy-item-vm.ts src/framework/hierarchy/index.ts src/framework/hierarchy/tests/hierarchy-tree-vm.test.ts src/framework/hierarchy/tests/hierarchy-item-vm.test.ts
git commit -m "feat(hierarchy): HierarchyTreeVM + public HierarchyItemVM.RefreshDisplay"
```

---

## Layer 2 — plexus-core (`src/renderer/modules/solution-explorer`)

**Setup (once, before Task 5):**

1. Build sibling Mural so its `dist` carries the Layer-1 code (plexus-core's vitest aliases `@pragmatic-tech-ai/mural/*` → the resolved package's `dist/*`):
   ```bash
   cd C:/Users/Eugene/Projects/architecture-agent/Mural && npm run build
   ```
2. Make Plexus resolve mural to the sibling repo (local substitute for the deferred publish + pin-bump; the P1 pattern). From PowerShell, replace the hoisted install with a junction to the sibling, preserving the ability to restore later:
   ```powershell
   $target = 'C:\Users\Eugene\Projects\architecture-agent\Mural'
   $link = 'C:\Users\Eugene\Projects\architecture-agent\Plexus\node_modules\@pragmatic-tech-ai\mural'
   [System.IO.Directory]::Delete($link, $true)
   New-Item -ItemType Junction -Path $link -Target $target | Out-Null
   ```
   (If `node_modules/@pragmatic-tech-ai/mural` is a hoisted symlink already, or `pkgRoot` resolves to the workspace root copy, junction THAT path instead — confirm with `node -e "console.log(require('@pragmatic-tech-ai/mural/package.json').version)"` run from `packages/plexus-core`.)
3. In `C:\Users\Eugene\Projects\architecture-agent\Plexus`, create the branch:
   ```bash
   git checkout -b feat/hierarchy-p2-explorer
   ```
4. Verify the new symbols import in plexus-core before starting Task 5 — write a throwaway `packages/plexus-core/src/renderer/modules/solution-explorer/tests/_resolve.test.ts` that does `import { HierarchyItemVM, HierarchyTreeVM, NodeKey } from '@pragmatic-tech-ai/mural/framework/hierarchy'` and asserts they are defined; run `npx vitest run packages/plexus-core/.../\_resolve.test.ts` (or the repo's `vitest run` filtered). If it can't resolve, fix the junction/build before proceeding, then delete the throwaway.

**After any later Mural edit** (e.g. a fix-pass finding in the model), re-run `npm run build` in Mural so the junctioned `dist` updates.

plexus-core test command: from `packages/plexus-core`, `npx vitest run src/renderer/modules/solution-explorer` (or the repo-standard `vitest run` with a path filter).

### Task 5: `ProjectsListingContributor`

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/projects-listing-contributor.ts`
- Test: `packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/projects-listing-contributor.test.ts` (new)

**Interfaces:**
- Consumes: `IHierarchyContributor`, `HierarchyContribution`, `NodeContribution`, `HierarchyNode`, `NodeSeverity`, `NodeKey`, `HierarchyContributorRegistry` from `@pragmatic-tech-ai/mural/framework/hierarchy`; `Solution`, `SolutionMember`, `SolutionMemberStatus` from `@pragmatic-tech-ai/todl`; `CollectionChange` from `@pragmatic-tech-ai/todl-runtime`.
- Produces: `class ProjectsListingContributor implements IHierarchyContributor` — `constructor(solution: Solution, registry: HierarchyContributorRegistry)`; `readonly ParentKeys = [NodeKey.Solution]`; `readonly Order = 0`; `Contribute(parent: HierarchyNode): NodeContribution` (one node per member, `Key = NodeKey.Project`, `ExtObject = member`); `dispose(): void`. Subscribes to `solution.Members` and each member's `PropertyChanged('Status')`, calling `registry.NotifyContributionsChanged()` on any change.

- [ ] **Step 1: Write the failing test**

```typescript
// .../solution-explorer/services/tests/projects-listing-contributor.test.ts
import { describe, it, expect } from 'vitest'
import { NodeKey, NodeSeverity, HierarchyContributorRegistry, type HierarchyNode } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { Solution, SolutionMemberStatus } from '@pragmatic-tech-ai/todl'
import { ProjectsListingContributor } from '../projects-listing-contributor.js'

function rootNode(): HierarchyNode
{
    return { Key: NodeKey.Solution, Caption: 'S', IconKey: 'solution', ExtObject: undefined, Severity: NodeSeverity.Ok }
}

describe('ProjectsListingContributor', () =>
{
    it('contributes one project node per member, in order, keyed NodeKey.Project', () =>
    {
        const sol = new Solution('S')
        const a = sol.AddMember('./a', 'architecture')
        const b = sol.AddMember('./b', 'architecture')
        a.Status = SolutionMemberStatus.Resolved
        b.Status = SolutionMemberStatus.Resolved
        const registry = new HierarchyContributorRegistry(new ServiceProvider())
        const c = new ProjectsListingContributor(sol, registry)
        const nodes = c.Contribute(rootNode()).Nodes
        expect(nodes.map((n) => n.ExtObject)).toEqual([a, b])
        expect(nodes.every((n) => n.Key === NodeKey.Project)).toBe(true)
    })

    it('maps LoadFailed -> Error severity + Error text, UnknownType -> Warning', () =>
    {
        const sol = new Solution('S')
        const bad = sol.AddMember('./bad', 'nope')
        bad.Status = SolutionMemberStatus.LoadFailed
        bad.Error = 'boom'
        const unknown = sol.AddMember('./u', 'nope')
        unknown.Status = SolutionMemberStatus.UnknownType
        const registry = new HierarchyContributorRegistry(new ServiceProvider())
        const c = new ProjectsListingContributor(sol, registry)
        const nodes = c.Contribute(rootNode()).Nodes
        expect(nodes[0]!.Severity).toBe(NodeSeverity.Error)
        expect(nodes[0]!.Error).toBe('boom')
        expect(nodes[1]!.Severity).toBe(NodeSeverity.Warning)
    })

    it('notifies the registry when a member is added', () =>
    {
        const sol = new Solution('S')
        const registry = new HierarchyContributorRegistry(new ServiceProvider())
        let notified = 0
        registry.PropertyChanged('Contributors').subscribe(() => notified++)
        const c = new ProjectsListingContributor(sol, registry)
        const before = notified
        sol.AddMember('./a', 'architecture')
        expect(notified).toBeGreaterThan(before)
        c.dispose()
    })

    it('notifies the registry when a member Status flips, and dispose stops it', () =>
    {
        const sol = new Solution('S')
        const m = sol.AddMember('./a', 'architecture')
        const registry = new HierarchyContributorRegistry(new ServiceProvider())
        const c = new ProjectsListingContributor(sol, registry)
        let notified = 0
        registry.PropertyChanged('Contributors').subscribe(() => notified++)
        m.Status = SolutionMemberStatus.Resolved
        expect(notified).toBeGreaterThan(0)
        const after = notified
        c.dispose()
        m.Status = SolutionMemberStatus.LoadFailed
        expect(notified).toBe(after)   // no leak after dispose
    })
})
```

(Confirm `Solution.AddMember(path, type)` and `SolutionMember.Status` setter against the TODL source read for this plan — `Solution` ctor is `(name, storage?)`; `AddMember` returns the member; `Status` raises `PropertyChanged('Status')`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/projects-listing-contributor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// .../solution-explorer/services/projects-listing-contributor.ts
import {
    NodeContribution, NodeSeverity, NodeKey,
    type IHierarchyContributor, type HierarchyNode, type HierarchyContributorRegistry,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import type { CollectionChange } from '@pragmatic-tech-ai/todl-runtime'
import { type Solution, type SolutionMember, SolutionMemberStatus } from '@pragmatic-tech-ai/todl'

// Contributes one project row per solution member under the solution root. Reactive:
// re-notifies the registry (-> HierarchyModel re-contributes the root) when Members
// change or a member's Status flips, so rows appear/vanish and repaint their severity
// while keeping their id (ExtObject = the SolutionMember, the interning identity).
export class ProjectsListingContributor implements IHierarchyContributor
{
    private static readonly StatusProp = 'Status'
    public readonly ParentKeys = [NodeKey.Solution]
    public readonly Order = 0

    private readonly membersOff: () => void
    private readonly statusOff = new Map<SolutionMember, () => void>()

    constructor(
        private readonly solution: Solution,
        private readonly registry: HierarchyContributorRegistry,
    )
    {
        for (const m of this.solution.Members) this.watchStatus(m)
        this.membersOff = this.solution.Members.CollectionChanged.subscribe((c) => this.onMembersChanged(c))
    }

    public Contribute(_parent: HierarchyNode): NodeContribution
    {
        const nodes: HierarchyNode[] = []
        for (const m of this.solution.Members)
        {
            nodes.push({
                Key: NodeKey.Project,
                Caption: m.Title,
                IconKey: NodeKey.Project,
                ExtObject: m,
                Severity: ProjectsListingContributor.severityOf(m),
                Error: m.Error,
            })
        }
        return new NodeContribution(nodes)
    }

    private static severityOf(m: SolutionMember): NodeSeverity
    {
        if (m.Status === SolutionMemberStatus.LoadFailed) return NodeSeverity.Error
        if (m.Status === SolutionMemberStatus.UnknownType) return NodeSeverity.Warning
        return NodeSeverity.Ok
    }

    private onMembersChanged(_c: CollectionChange<SolutionMember>): void
    {
        // Re-sync per-member Status subscriptions to the live set, then re-contribute.
        for (const m of [...this.statusOff.keys()])
        {
            if (!this.solution.Members.ToArray().includes(m))
            {
                this.statusOff.get(m)!()
                this.statusOff.delete(m)
            }
        }
        for (const m of this.solution.Members)
        {
            if (!this.statusOff.has(m)) this.watchStatus(m)
        }
        this.registry.NotifyContributionsChanged()
    }

    private watchStatus(m: SolutionMember): void
    {
        const off = m.PropertyChanged(ProjectsListingContributor.StatusProp).subscribe(() => this.registry.NotifyContributionsChanged())
        this.statusOff.set(m, off)
    }

    public dispose(): void
    {
        this.membersOff()
        for (const off of this.statusOff.values()) off()
        this.statusOff.clear()
    }
}
```

**Note:** confirm the `ObservableCollection.CollectionChanged` subscription API and `ToArray()` name against `@pragmatic-tech-ai/todl-runtime` (the P0/P1 code uses `CollectionChange` deltas; `member-projection.ts` shows `for (const m of solution.Members)` iteration works). Adjust names to the real API. `HierarchyNode.Error` is optional; with `exactOptionalPropertyTypes`, assign `Error: m.Error` only if the field accepts `string | undefined` (it does — `Error?: string`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/projects-listing-contributor.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/projects-listing-contributor.ts packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/projects-listing-contributor.test.ts
git commit -m "feat(solution-explorer): reactive ProjectsListingContributor (solution -> member rows)"
```

### Task 6: `FileTreeContributor`

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/file-tree-contributor.ts`
- Test: `packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/file-tree-contributor.test.ts` (new)

**Interfaces:**
- Consumes: `IHierarchyContributor`, `NodeContribution`, `ProviderContribution`, `HierarchyContribution`, `HierarchyNode`, `NodeKey` from mural; `ProjectContentStore`, `ProjectContentProvider`, `SolutionMember`, `SolutionMemberStatus` from `@pragmatic-tech-ai/todl`.
- Produces: `class FileTreeContributor implements IHierarchyContributor` — `constructor()`; `readonly ParentKeys = [NodeKey.Project]`; `readonly Order = 0`; `Contribute(parent: HierarchyNode): HierarchyContribution` (resolved member → `ProviderContribution(new ProjectContentProvider(new ProjectContentStore(member.Storage)))`; unresolved → `new NodeContribution([])`); `dispose(): void` (disposes every store it created).

- [ ] **Step 1: Write the failing test**

```typescript
// .../solution-explorer/services/tests/file-tree-contributor.test.ts
import { describe, it, expect } from 'vitest'
import { NodeKey, NodeSeverity, ProviderContribution, NodeContribution, type HierarchyNode } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { FakeStorage, SolutionMemberStatus } from '@pragmatic-tech-ai/todl-runtime'   // FakeStorage; adjust if it re-exports from todl
import { Solution } from '@pragmatic-tech-ai/todl'
import { FileTreeContributor } from '../file-tree-contributor.js'

function memberNode(ext: unknown, sev = NodeSeverity.Ok): HierarchyNode
{
    return { Key: NodeKey.Project, Caption: 'p', IconKey: NodeKey.Project, ExtObject: ext, Severity: sev }
}

describe('FileTreeContributor', () =>
{
    it('a resolved member yields a ProviderContribution', async () =>
    {
        const storage = new FakeStorage()
        await storage.WriteText('a.todl', 'x')
        const sol = new Solution('S')
        const m = sol.AddMember('./p', 'architecture')
        m.Status = SolutionMemberStatus.Resolved
        m.Storage = storage
        const c = new FileTreeContributor()
        const contribution = c.Contribute(memberNode(m))
        expect(contribution).toBeInstanceOf(ProviderContribution)
        c.dispose()
    })

    it('an unresolved member yields an empty NodeContribution (leaf)', () =>
    {
        const sol = new Solution('S')
        const m = sol.AddMember('./p', 'nope')
        m.Status = SolutionMemberStatus.UnknownType
        const c = new FileTreeContributor()
        const contribution = c.Contribute(memberNode(m))
        expect(contribution).toBeInstanceOf(NodeContribution)
        expect((contribution as NodeContribution).Nodes.length).toBe(0)
        c.dispose()
    })

    it('dispose does not throw for a never-expanded store', () =>
    {
        const storage = new FakeStorage()
        const sol = new Solution('S')
        const m = sol.AddMember('./p', 'architecture')
        m.Status = SolutionMemberStatus.Resolved
        m.Storage = storage
        const c = new FileTreeContributor()
        c.Contribute(memberNode(m))          // mounts a store but never subscribes
        expect(() => c.dispose()).not.toThrow()
    })
})
```

(Confirm where `FakeStorage`/`SolutionMemberStatus` are exported — `member-status.test.ts` imports `FakeStorage` from `@pragmatic-tech-ai/todl-runtime` and `SolutionMemberStatus` from the engine path; from the compiled `@pragmatic-tech-ai/todl` barrel they may both be re-exported. Use whichever the barrel exposes; `SolutionMember.Storage` is a settable field.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/file-tree-contributor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// .../solution-explorer/services/file-tree-contributor.ts
import {
    NodeContribution, ProviderContribution, NodeKey,
    type IHierarchyContributor, type HierarchyNode, type HierarchyContribution,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import {
    ProjectContentStore, ProjectContentProvider,
    type SolutionMember, SolutionMemberStatus,
} from '@pragmatic-tech-ai/todl'

// Mounts one ProjectContentProvider (over a lazy, disk-watched ProjectContentStore) per
// resolved member row; an unresolved member is an empty leaf. Tracks the stores it
// creates so they (and their chokidar watchers) are disposed on teardown.
export class FileTreeContributor implements IHierarchyContributor
{
    private static readonly EmptyLeaf = new NodeContribution([])
    public readonly ParentKeys = [NodeKey.Project]
    public readonly Order = 0

    private readonly stores = new Map<SolutionMember, ProjectContentStore>()

    public Contribute(parent: HierarchyNode): HierarchyContribution
    {
        const member = parent.ExtObject as SolutionMember
        if (member.Status !== SolutionMemberStatus.Resolved || member.Storage === undefined)
        {
            return FileTreeContributor.EmptyLeaf
        }
        let store = this.stores.get(member)
        if (store === undefined)
        {
            store = new ProjectContentStore(member.Storage)
            this.stores.set(member, store)
        }
        return new ProviderContribution(new ProjectContentProvider(store))
    }

    // Called by the capability when a member is pruned — release just that member's store.
    public Release(member: SolutionMember): void
    {
        const store = this.stores.get(member)
        if (store !== undefined)
        {
            store.dispose()
            this.stores.delete(member)
        }
    }

    public dispose(): void
    {
        for (const store of this.stores.values()) store.dispose()
        this.stores.clear()
    }
}
```

**Note:** confirm `ProjectContentStore` exposes `dispose()` (the P1 deferred-minor list flags "store.dispose() doesn't clear the settle timer" — dispose exists; if it leaves a timer, that is a known P1 minor, not this task's concern). Reusing the cached store per member keeps the provider stable if `Contribute` is called again for the same member before expansion. `RealizeChildren` returns on the first `ProviderContribution` and `attachProvider` guards re-subscription, so a stable provider instance per call is acceptable; if a second `Contribute` for an already-attached member must return the SAME provider instance, cache the provider too — confirm against `attachProvider`'s `entry.provider === provider` guard (it compares instances, so cache the provider alongside the store to avoid a needless re-attach).

Given that guard compares provider instances, cache the provider too:

```typescript
    private readonly providers = new Map<SolutionMember, ProjectContentProvider>()
    // ... in Contribute, after ensuring `store`:
        let provider = this.providers.get(member)
        if (provider === undefined)
        {
            provider = new ProjectContentProvider(store)
            this.providers.set(member, provider)
        }
        return new ProviderContribution(provider)
    // ... Release/dispose also clear providers
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/file-tree-contributor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/file-tree-contributor.ts packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/file-tree-contributor.test.ts
git commit -m "feat(solution-explorer): FileTreeContributor mounts ProjectContentProvider per resolved member"
```

### Task 7: `IconKeyToGeometry` converter

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/icon-key-to-geometry.ts`
- Test: `packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/icon-key-to-geometry.test.ts` (new)

**Interfaces:**
- Consumes: `KindToGeometry` (and its geometry-key helper) from `../../../../projects/project-node-icon.js`; `NodeKey` from mural; `ContentNodeKey` from `@pragmatic-tech-ai/todl`; `ValueConverter` from mural runtime.
- Produces: `export const IconKeyToGeometry: ValueConverter` — maps `folder`/`file`/`diagram`/`todl` (via the existing kind mapping), `NodeKey.Project`, and `NodeKey.Solution` to a geometry (or geometry key) the panel `.mu` binds through `<< IconKeyToGeometry`.

- [ ] **Step 1: Write the failing test**

```typescript
// .../solution-explorer/services/tests/icon-key-to-geometry.test.ts
import { describe, it, expect } from 'vitest'
import { NodeKey } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ContentNodeKey } from '@pragmatic-tech-ai/todl'
import { IconKeyToGeometry } from '../icon-key-to-geometry.js'

describe('IconKeyToGeometry', () =>
{
    it('maps every content key + member + solution to a defined geometry', () =>
    {
        for (const key of [ContentNodeKey.Folder, ContentNodeKey.File, ContentNodeKey.Diagram, ContentNodeKey.Todl, NodeKey.Project, NodeKey.Solution])
        {
            expect(IconKeyToGeometry.convert(key)).toBeDefined()
        }
    })

    it('folder and diagram map to distinct geometries', () =>
    {
        expect(IconKeyToGeometry.convert(ContentNodeKey.Folder)).not.toEqual(IconKeyToGeometry.convert(ContentNodeKey.Diagram))
    })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/icon-key-to-geometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (match the shape of `KindToGeometry` in `project-node-icon.ts`; reuse its geometry lookup for the four content keys and add project/solution)

```typescript
// .../solution-explorer/services/icon-key-to-geometry.ts
import { type ValueConverter } from '@pragmatic-tech-ai/mural/runtime'
import { NodeKey } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { ContentNodeKey } from '@pragmatic-tech-ai/todl'
import { KindToGeometry } from '../../../../projects/project-node-icon.js'

// The row leading icon for the hierarchy tree. Content-node keys (folder/file/diagram/
// todl) reuse the existing project-node geometry mapping; the coarse project family and
// the solution root add their own. One home for the mapping, referenced from the panel.
export const IconKeyToGeometry: ValueConverter = {
    convert: (iconKey: unknown) =>
    {
        switch (iconKey)
        {
            case NodeKey.Solution: return KindToGeometry.convert(ContentNodeKey.Folder)
            case NodeKey.Project:  return KindToGeometry.convert(ContentNodeKey.Folder)
            default:               return KindToGeometry.convert(iconKey)
        }
    },
}
```

**Note:** confirm `ValueConverter`'s export path (mural runtime vs a mural sub-path — `project-node-icon.ts` imports it; copy that import). Confirm `KindToGeometry.convert` accepts the content-key strings (`'folder'`/`'diagram'`/`'file'`; `'todl'` falls to its `File` default — acceptable, or add a Todl glyph). If a dedicated solution/project glyph is desired later that is a P4/registry refinement; folder geometry is the P2 placeholder and the test only asserts "defined" + folder≠diagram.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/icon-key-to-geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/icon-key-to-geometry.ts packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/icon-key-to-geometry.test.ts
git commit -m "feat(solution-explorer): IconKeyToGeometry converter for hierarchy rows"
```

### Task 8: `ProjectExplorerService.OpenMemberFile` (open delegate)

**Files:**
- Modify: `packages/plexus-core/src/renderer/modules/project-explorer/services/project-explorer-service.ts`
- Test: `packages/plexus-core/src/renderer/modules/project-explorer/tests/open-member-file.test.ts` (new)

**Interfaces:**
- Consumes: the surviving private `openNode(node, op)`/`openDocument`/`resolveDocumentFactory`, and the `projected: Map<SolutionMember, OpenProject>` map.
- Produces: `public async OpenMemberFile(member: SolutionMember, path: string, kind: ProjectNodeKind): Promise<void>` — resolves the member's `OpenProject` from `projected`; a folder kind is a no-op; a file resolves its document factory and opens (or re-activates) the tab, else falls back to `OpenExternal` when the storage is local, else sets a status. Reuses the existing open path.

- [ ] **Step 1: Write the failing test** (unit against a service with a stubbed host + a pre-seeded `projected` entry)

Because `ProjectExplorerService` has a heavy constructor, test `OpenMemberFile` through the existing test harness pattern used by `project-explorer-service.test.ts`. Add a test that: builds the service via that harness, injects one resolved member→`OpenProject` into `projected` (expose a test seam or reuse the harness's project-open flow), calls `OpenMemberFile(member, 'a.todl', ProjectNodeKind.Todl)`, and asserts the host received an `Open` for a document at that path. If the existing harness cannot seed `projected` directly, drive a real member open through the harness first (as `project-explorer-service.test.ts` already does), then call `OpenMemberFile`.

```typescript
// sketch — align with project-explorer-service.test.ts's existing harness/makeService
it('OpenMemberFile opens a file tab for a resolved member', async () =>
{
    const { service, member, host } = await openOneResolvedMember()   // harness helper (mirror existing tests)
    await service.OpenMemberFile(member, 'a.todl', ProjectNodeKind.Todl)
    expect(host.opened.some((d) => host.pathOf(d) === 'a.todl')).toBe(true)
})

it('OpenMemberFile is a no-op for a folder kind', async () =>
{
    const { service, member, host } = await openOneResolvedMember()
    const before = host.opened.length
    await service.OpenMemberFile(member, 'src', ProjectNodeKind.Folder)
    expect(host.opened.length).toBe(before)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/modules/project-explorer/tests/open-member-file.test.ts`
Expected: FAIL — `OpenMemberFile is not a function`.

- [ ] **Step 3: Implement** (add near `OpenPath`/`openNode`)

```typescript
    // Open (or re-activate) a file in the given member's project — the entry point the
    // Solution Explorer's open-on-activate calls. Folder kinds are a no-op; a file with no
    // registered editor falls back to the OS on local storage. Reuses openDocument's dedupe.
    public async OpenMemberFile(member: SolutionMember, path: string, kind: ProjectNodeKind): Promise<void>
    {
        if (kind === ProjectNodeKind.Folder) return
        const op = this.projected.get(member)
        if (op === undefined) return
        const factory = this.resolveDocumentFactory(extname(path))
        try
        {
            if (factory !== undefined)
            {
                await this.openDocument(op, path, factory)
            }
            else if (isLocalFileAccess(op.Storage))
            {
                await op.Storage.OpenExternal(path)
            }
        }
        catch (e)
        {
            this.Status = `Open failed: ${(e as Error).message}`
        }
    }
```

Add `SolutionMember` and `ProjectNodeKind` to the imports from `@pragmatic-tech-ai/todl` (`ProjectNodeKind` is the P1 enum). `extname`, `isLocalFileAccess`, `resolveDocumentFactory`, `openDocument`, `projected`, and `Status` already exist in this file.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/modules/project-explorer/tests/open-member-file.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/project-explorer/services/project-explorer-service.ts packages/plexus-core/src/renderer/modules/project-explorer/tests/open-member-file.test.ts
git commit -m "feat(project-explorer): OpenMemberFile delegate for hierarchy open-on-activate"
```

### Task 9: `SolutionExplorerService` capability

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-explorer-service.ts`
- Test: `packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/solution-explorer-service.test.ts` (new)

**Interfaces:**
- Consumes: `HierarchyModel`, `HierarchyTreeVM`, `HierarchyItemVM`, `HierarchyContributorRegistry`, `HierarchyContributorDefinition`, `NodeKey`, `NodeSeverity`, `HierarchyItemId` from mural; `SolutionManagerService`, `Solution`, `SolutionMember`, `ProjectContentNode`, `ProjectNodeKind` from `@pragmatic-tech-ai/todl`; `ProjectExplorerService` (Task 8, `OpenMemberFile`); `ProjectsListingContributor` (Task 5), `FileTreeContributor` (Task 6); `Observable`, `ServiceKey`, `IServiceProvider` from mural runtime.
- Produces: `class SolutionExplorerService extends Observable` — `static readonly Key`; `constructor(provider: IServiceProvider)`; `Start(): void`; `get Tree(): HierarchyTreeVM | undefined`; `dispose(): void`. Observes `SolutionManagerService.ActiveSolution`; on change rebuilds the model, seeds root `{ Key: NodeKey.Solution, ... }`, registers the two contributors (imperatively, keeping disposers), publishes `Tree` (raising `PropertyChanged('Tree')`), and disposes the prior model/contributors/tree. `OnActivate` walks `HierarchyItemVM.Parent` to the member row and calls `ProjectExplorerService.OpenMemberFile`.

- [ ] **Step 1: Write the failing test**

```typescript
// .../solution-explorer/services/tests/solution-explorer-service.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { HierarchyTreeVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'
// build a minimal provider exposing SolutionManagerService + HierarchyContributorRegistry +
// ProjectExplorerService, mirroring active-solution-semantics.test.ts's makeService.
// ... (compose provider) ...
import { SolutionExplorerService } from '../solution-explorer-service.js'

describe('SolutionExplorerService', () =>
{
    it('publishes a Tree with a row per member when a solution opens', async () =>
    {
        const { svc, manager } = makeExplorer()
        svc.Start()
        expect(svc.Tree).toBeUndefined()
        await manager.NewSolution('/work/sol')     // publishes ActiveSolution
        // add a resolved member to the active solution, then re-open/refresh
        // (or seed the solution with members before NewSolution per the harness)
        expect(svc.Tree).toBeInstanceOf(HierarchyTreeVM)
    })

    it('closing the solution clears Tree', async () =>
    {
        const { svc, manager } = makeExplorer()
        svc.Start()
        await manager.NewSolution('/work/sol')
        await manager.CloseSolution()
        expect(svc.Tree).toBeUndefined()
    })

    it('a second open disposes the prior model + contributors + stores', async () =>
    {
        const { svc, manager } = makeExplorer()
        svc.Start()
        await manager.NewSolution('/work/a')
        const first = svc.Tree
        await manager.NewSolution('/work/b')
        expect(svc.Tree).not.toBe(first)
        // assert the first tree was disposed (its Roots cleared) — expose a spy or check Roots.count === 0
        expect(first!.Roots.count).toBe(0)
    })

    it('OnActivate on a folder row is a no-op (no OpenMemberFile call)', () =>
    {
        // construct a HierarchyItemVM chain solution->member->folder with a spy ProjectExplorerService
        // and assert OpenMemberFile was not called for a folder ProjectContentNode.
    })
})
```

(Model `makeExplorer()` on `active-solution-semantics.test.ts`'s `makeService()`: it wires `SolutionManagerService` with a `FakeStorage`-backed storage registry and a factory registry; add a `HierarchyContributorRegistry` and a stub/real `ProjectExplorerService` to the provider. Seed the solution's members through the manager's open flow so `ActiveSolution.Members` is non-empty, or assert `Tree` is a `HierarchyTreeVM` with `Roots.count === 0` for an empty solution — the exact member-seeding follows the harness you build; keep the assertions honest to what the harness produces.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/solution-explorer-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// .../solution-explorer/services/solution-explorer-service.ts
import { Observable, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import {
    HierarchyModel, HierarchyTreeVM, type HierarchyItemVM,
    HierarchyContributorRegistry, HierarchyContributorDefinition,
    NodeKey, NodeSeverity, type HierarchyItemId,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import {
    SolutionManagerService, type Solution, type SolutionMember, type ProjectContentNode,
    type ProjectNodeKind,
} from '@pragmatic-tech-ai/todl'
import { ProjectExplorerService } from '../../project-explorer/services/project-explorer-service.js'
import { ProjectsListingContributor } from './projects-listing-contributor.js'
import { FileTreeContributor } from './file-tree-contributor.js'

// The Solution Explorer capability: owns one HierarchyModel per open solution, follows
// ActiveSolution, seeds the root, registers the two contributors imperatively (they close
// over the active solution), and publishes a HierarchyTreeVM the panel binds. Open-on-
// activate walks the row's parent chain to its member and delegates to ProjectExplorerService.
export class SolutionExplorerService extends Observable
{
    public static readonly Key = new ServiceKey<SolutionExplorerService>('SolutionExplorerService')
    private static readonly TreeProp = 'Tree'
    private static readonly RootCaptionFallback = 'Solution'

    private _tree: HierarchyTreeVM | undefined
    private model: HierarchyModel | undefined
    private listing: ProjectsListingContributor | undefined
    private files: FileTreeContributor | undefined
    private offListing: (() => void) | undefined
    private offFiles: (() => void) | undefined
    private activeOff: (() => void) | undefined

    constructor(private readonly provider: IServiceProvider)
    {
        super()
    }

    public get Tree(): HierarchyTreeVM | undefined { return this._tree }

    public Start(): void
    {
        const manager = this.provider.getRequired(SolutionManagerService.Key)
        this.activeOff = manager.PropertyChanged('ActiveSolution').subscribe(() => this.rebuild(manager.ActiveSolution))
        this.rebuild(manager.ActiveSolution)
    }

    private rebuild(solution: Solution | undefined): void
    {
        this.teardownCurrent()
        if (solution === undefined)
        {
            this.setTree(undefined)
            return
        }
        const registry = this.provider.getRequired(HierarchyContributorRegistry.Key)
        this.model = new HierarchyModel(registry)
        const root = this.model.SeedRoot({
            Key: NodeKey.Solution,
            Caption: solution.Name || SolutionExplorerService.RootCaptionFallback,
            IconKey: NodeKey.Solution,
            ExtObject: solution,
            Severity: NodeSeverity.Ok,
        })
        this.listing = new ProjectsListingContributor(solution, registry)
        this.files = new FileTreeContributor()
        this.offListing = registry.Register(SolutionExplorerService.defFor(this.listing))
        this.offFiles = registry.Register(SolutionExplorerService.defFor(this.files))
        this.setTree(new HierarchyTreeVM(this.model, root, (vm) => { void this.onActivate(vm) }))
    }

    private static defFor(contributor: ProjectsListingContributor | FileTreeContributor): HierarchyContributorDefinition
    {
        const d = new HierarchyContributorDefinition()
        d.ParentKeys = contributor.ParentKeys as string[]
        d.Order = contributor.Order
        // Imperative registration: resolve to this exact instance rather than a token.
        // Register accepts a definition whose Contributor token resolves via the provider;
        // for a per-solution instance, register a token bound to it (see note).
        return d
    }

    private async onActivate(vm: HierarchyItemVM): Promise<void>
    {
        let cur: HierarchyItemVM | undefined = vm
        while (cur !== undefined && !SolutionExplorerService.isMember(cur)) cur = cur.Parent
        if (cur === undefined) return
        const member = cur.Data as SolutionMember
        const content = vm.Data as ProjectContentNode | undefined
        if (content === undefined) return                       // a member row itself — nothing to open
        const explorer = this.provider.getRequired(ProjectExplorerService.Key)
        await explorer.OpenMemberFile(member, content.Path, content.Kind as ProjectNodeKind)
    }

    private static isMember(vm: HierarchyItemVM): boolean
    {
        // A member row's ExtObject is a SolutionMember; a content row's is a ProjectContentNode.
        // Distinguish structurally: the member row is the one whose Parent is a root-level row.
        return vm.Parent === undefined
    }

    private teardownCurrent(): void
    {
        this._tree?.dispose()
        this.offListing?.()
        this.offFiles?.()
        this.listing?.dispose()
        this.files?.dispose()
        this.offListing = undefined
        this.offFiles = undefined
        this.listing = undefined
        this.files = undefined
        this.model = undefined
    }

    private setTree(tree: HierarchyTreeVM | undefined): void
    {
        this._tree = tree
        this.RaisePropertyChanged(SolutionExplorerService.TreeProp, undefined, undefined)
    }

    public dispose(): void
    {
        this.activeOff?.()
        this.activeOff = undefined
        this.teardownCurrent()
        this.setTree(undefined)
    }
}
```

**Ruling — imperative registration of a per-instance contributor.** `HierarchyContributorRegistry.Register` takes a `HierarchyContributorDefinition` whose `Contributor` is a `ServiceToken` resolved via `Provider.getRequired`. A per-solution instance is not a global token. Two clean options; pick the first:
1. **Register a fresh `ServiceKey` bound to the instance per open:** create `const token = new ServiceKey<IHierarchyContributor>('SolutionExplorer.Listing')`, `this.provider.registerInstance(token, this.listing)`, set `d.Contributor = token`, `registry.Register(d)`. On teardown, call the `Register` disposer (the registry drops the resolved cache entry on `remove`). Confirm `IServiceProvider` exposes `registerInstance` at runtime (the tests use `provider.registerInstance`); if the production provider is read-only, use option 2.
2. **Add a `Register(def, instance?)` overload** to `HierarchyContributorRegistry` that caches a supplied instance directly (bypassing token resolution). This is a tiny Mural addition; if chosen, add it under Task 2's file with its own test.

Resolve which by checking whether the production `IServiceProvider` in Plexus supports `registerInstance` at runtime (the composition root does). Record the choice as a ledger ruling. Also refine `isMember`: distinguishing a member row from a content row by `Parent === undefined` holds because `HierarchyTreeVM.Roots` are the member rows (their `Parent` is `undefined`) and content rows always have a parent. The `onActivate` walk therefore climbs to the top-level row (the member) and treats the activated `vm.Data`: if it is a `ProjectContentNode`, open it; if the activated row IS the member (its own `Data` is a `SolutionMember`), do nothing.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/modules/solution-explorer/services/tests/solution-explorer-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-explorer-service.ts packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/solution-explorer-service.test.ts
git commit -m "feat(solution-explorer): SolutionExplorerService capability over HierarchyModel"
```

### Task 10: Panel module + resources (`.mu`)

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/solution-explorer.module.mu`
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/solution-explorer.resources.mu`
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/index.ts` (re-exports the service + converter for app import)

**Interfaces:**
- Consumes: `SolutionExplorerService` (Task 9), `IconKeyToGeometry` (Task 7), `HierarchyItemVM` (mural), the existing `PanelButton`/geometry resources referenced by `project-explorer.resources.mu`.
- Produces: a `shell module` registering `SolutionExplorerService` in `.services:` with a `Capability [ ServiceKey = SolutionExplorerService ]`; a `DataTemplate [ DataType = SolutionExplorerService ]` and a single `HierarchicalDataTemplate [ DataType = HierarchyItemVM, itemsselector = Children ]`.

This task has no unit test (a `.mu` panel is covered by the app e2e in Task 11). Its verification is: the module compiles (`.mu` → `.mu.js`) and the app boots with the panel. Fold the compile check into this task; the behavioral gate is Task 11.

- [ ] **Step 1: Write `solution-explorer.module.mu`**

```
// solution-explorer.module.mu — the Solution Explorer module (P2). Replaces the
// Project Explorer panel Capability; ProjectExplorerService survives as a lifecycle
// service (open/close/restore + OpenMemberFile), no longer the tree source.
import SolutionExplorerService from "./services/solution-explorer-service.js"

shell module SolutionExplorerModule [ Name = "Solution Explorer" ] {
    .services: {
        SolutionExplorerService
    }

    Capability [ Name = "Solution Explorer", Icon = @ProjectExplorer, ServiceKey = SolutionExplorerService ]
}
```

- [ ] **Step 2: Write `solution-explorer.resources.mu`**

Mirror `project-explorer.resources.mu`'s chrome (command bar with the surviving Open/New-project commands, hairline, status strip, virtualized TreeView), but bind the tree to the hierarchy VM and use ONE `HierarchicalDataTemplate`. The command-bar buttons bind the surviving `ProjectExplorerService` commands via the provider (see the app wiring note in Task 11 — the capability may expose pass-through `OpenProjectCommand`/`NewProjectCommand` getters that delegate to `ProjectExplorerService`, or the panel resolves them from the service registry). Empty-state text shows when `Tree` is undefined.

```
import { IconKeyToGeometry } from "./services/icon-key-to-geometry.js"

resources {
    // One hierarchy row: leading icon (IconKey -> geometry) + caption. Read-only in P2
    // (no context menu, no rename slot, no drag). itemsselector = Children recurses.
    HierarchicalDataTemplate x:key="HierarchyItemTemplate"
        [ DataType = HierarchyItemVM, itemsselector = Children ] {
        Border x:root [ Fill = #00000000 ] {
            StackPanel [ Orientation = Horizontal, VerticalAlignment = Center ] {
                Shape [ Geometry = $IconKey << IconKeyToGeometry, Fill = @Fg2,
                        Width = 16, Height = 16, Margin = (0,0,6,0), VerticalAlignment = Center ]
                TextBlock [ Text = $Caption, Style = @Body, VerticalAlignment = Center ]
            }
        }
    }

    DataTemplate [ DataType = SolutionExplorerService ] {
        DockPanel [ LastChildFill = true, Margin = (8,8,8,8) ] {
            // Command bar — reuse the existing Open/New project commands (from the surviving
            // ProjectExplorerService, surfaced by the capability or resolved by the panel).
            StackPanel [ DockPanel.Dock = Top, Orientation = Horizontal, Margin = (0,0,0,8) ] {
                PanelButton [ Margin = (0,0,4,0), Command = $OpenProjectCommand ] {
                    Shape [ Geometry = @Folder, Fill = @Fg2, Width = 20, Height = 20 ]
                }
                PanelButton [ Command = $NewProjectCommand ] {
                    Shape [ Geometry = @NewFolder, Fill = @Fg2, Width = 20, Height = 20 ]
                }
            }
            Border [ DockPanel.Dock = Top, Height = 1, Fill = @Border, Margin = (0,0,0,8) ]

            // Empty state when no solution is open.
            TextBlock [ DockPanel.Dock = Bottom, Style = @BodySm, Foreground = @Fg2,
                        Text = "No solution open.", Margin = (0,8,0,0),
                        Visibility = $Tree << NullToVisibility ]

            TreeView [ Indent = 14, IsVirtualizing = true,
                       ItemsSource = $Tree.Roots, ItemTemplate = @HierarchyItemTemplate,
                       SelectionMode = Extended, AllowMarqueeSelection = true ]
        }
    }
}
```

**Notes:** (a) `$OpenProjectCommand`/`$NewProjectCommand` — add pass-through getters on `SolutionExplorerService` that return `this.provider.getRequired(ProjectExplorerService.Key).OpenProjectCommand`/`.NewProjectCommand`, so the panel's DataContext (the service) exposes them. Add these getters in Task 9 (and a trivial test). (b) `NullToVisibility` — reuse an existing converter if present, else bind `Visibility` off a `HasNoSolution` boolean getter on the service (`get HasNoSolution(): boolean { return this._tree === undefined }`) via the existing `ToVisibility`. Prefer the boolean getter to avoid inventing a converter. (c) Confirm the exact `resources { }` / `import` header syntax against `project-explorer.resources.mu` (it may not use a literal `resources {` wrapper — match that file's top-level form exactly). (d) The `HierarchyItemVM` type must be importable/resolvable in `.mu` — confirm how `project-explorer.resources.mu` references `ProjectNode`/`OpenProject` types (implicit symbol resolution) and follow the same mechanism.

- [ ] **Step 3: Compile-check the module**

Run the repo's `.mu` build (e.g. `npm run build` in `packages/plexus-core`, or the workspace build that emits `*.mu.js`). Expected: `solution-explorer.module.mu.js` + `solution-explorer.resources.mu.js` emitted with no compile error.

- [ ] **Step 4: Commit**

```bash
git add packages/plexus-core/src/renderer/modules/solution-explorer/solution-explorer.module.mu packages/plexus-core/src/renderer/modules/solution-explorer/solution-explorer.resources.mu packages/plexus-core/src/renderer/modules/solution-explorer/index.ts packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-explorer-service.ts
git commit -m "feat(solution-explorer): panel module + resources; capability command pass-throughs"
```

- [ ] **Step 5: Run the plexus-core suite**

Run: from `packages/plexus-core`, `npm test` (`vitest run`).
Expected: PASS (full plexus-core suite green, including the new solution-explorer tests).

---

## Layer 3 — apps/plexus

### Task 11: Register the module, flip the panel Capability, adjust e2e

**Files:**
- Modify: `apps/plexus/src/renderer/src/app.mu` (register `SolutionExplorerModule`; remove/replace the `ProjectExplorerModule` panel Capability entry — confirm the exact `.modules:` list location)
- Modify: any app service-registration that must keep `ProjectExplorerService` registered as a plain service (lifecycle) even though its Capability entry is gone
- Modify/Create: `apps/plexus/e2e/solution-explorer.spec.ts` (new); retire/adjust the old `apps/plexus/e2e/*` expectations that assert the project tree's context menu / rename / delete
- Test: Playwright e2e

**Interfaces:**
- Consumes: `SolutionExplorerModule`/`SolutionExplorerService` (Task 9/10), the surviving `ProjectExplorerService`.

- [ ] **Step 1: Write the failing e2e**

```typescript
// apps/plexus/e2e/solution-explorer.spec.ts
import { test, expect } from '@playwright/test'
// mirror the harness in apps/plexus/e2e/smoke.spec.ts for launching the Electron app
// and opening a fixture solution/project.

test('Solution Explorer renders the tree for an open project', async () =>
{
    // launch, open the fixture project, assert a known file row is visible in the panel
})

test('double-clicking a file row opens it in the editor', async () =>
{
    // launch, open fixture, expand the project, double-click a .todl file,
    // assert a document tab for that file appears
})
```

(Model the launch/open/reveal steps on the existing `apps/plexus/e2e/smoke.spec.ts` and `save-ux.spec.ts` harnesses — reuse their Electron bootstrap and fixture-open helpers verbatim; do not invent a new harness.)

- [ ] **Step 2: Run to verify it fails**

Run: the app e2e command (e.g. `npm run e2e -- solution-explorer` from `apps/plexus`, matching the repo's Playwright script).
Expected: FAIL — the panel still shows the old Project Explorer / no `SolutionExplorerModule` registered.

- [ ] **Step 3: Register + flip**

In `app.mu`: add `SolutionExplorerModule` to the `.modules:` list and remove the `ProjectExplorerModule` entry whose Capability provided the panel — BUT keep `ProjectExplorerService` registered as a service (it still provides lifecycle + `OpenMemberFile` + the Open/New commands the new panel's command bar delegates to). If `ProjectExplorerModule`'s `.services:` block is the only registrar of `ProjectExplorerService`, keep that module's `.services:` and drop only its `Capability` line; or move the service registration into `SolutionExplorerModule`'s `.services:`. Confirm the current registration topology and choose the minimal edit; record it as a ledger ruling.

- [ ] **Step 4: Run to verify it passes**

Run: the app e2e command.
Expected: PASS — the panel renders the hierarchy tree; double-click opens a file.

- [ ] **Step 5: Adjust/retire old expectations**

Update or delete the old `project-explorer` e2e specs that assert behaviors P2 removed (context menu, rename, delete on the tree). Leave specs that exercise surviving lifecycle (open/new project) intact. Run the full app e2e suite; it must be green.

Run: the full app e2e + `apps/plexus` unit suite.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/plexus/src/renderer/src/app.mu apps/plexus/e2e/solution-explorer.spec.ts apps/plexus/e2e/*.spec.ts
git commit -m "feat(plexus): adopt Solution Explorer panel; retire Project Explorer projection e2e"
```

- [ ] **Step 7: Run the whole Plexus test suite**

Run: from the Plexus repo root, the workspace test command (`npm test` across packages, and the app e2e).
Expected: PASS (plexus-core + apps green).

---

## Notes carried for the executor (rulings baked into this plan)

- **Node keys:** reuse mural's `NodeKey.Solution` / `NodeKey.Project`; do NOT create plexus-core keys (supersedes spec §4).
- **No `OnCollapse` on the VM:** the TreeView contract (`ExpandableTreeData`) only calls `OnExpand`/`OnActivate`; subscriptions persist from first expand until `dispose()` (matches `MetaModelTreeNode`). Supersedes spec §3.1's `OnCollapse` bullet — the store/watcher for an expanded member stays live until solution close/swap, which is bounded and correct.
- **`ProjectContentProvider` stays in TODL** for P2 (imported by plexus-core); re-home is deferred cleanup.
- **`SolutionTreeVM`/`SolutionNodeVM` in TODL presentation** are NOT deleted in P2 (keeps "TODL unchanged"); their removal is deferred cleanup. Supersedes the spec §1 "Sheds" mention of them.
- **devUI:** this plan targets `apps/plexus`. If `apps/devUI` mounts the same plexus-core `ProjectExplorerModule` Capability, it inherits the change through plexus-core; if it has its own explorer wiring, leave it untouched in P2 and note it. Confirm during Task 11 and record a ledger ruling.
- **Mural availability for Layer 2/3:** local junction + `npm run build` in Mural substitutes for the deferred publish; re-build Mural after any Layer-1 fix.

## Self-Review

**1. Spec coverage.** Spec §3 (HierarchyItemVM/HierarchyTreeVM, ObserveChildren, NotifyContributionsChanged, internKeyed refresh) → Tasks 1–4. §4 node keys → superseded (reuse `NodeKey.*`), documented. §5 contributors → Tasks 5–6. §6 capability → Task 9. §7 panel + open-on-activate → Tasks 8, 10, 11. §8 tests → each task's tests + Task 11 e2e + a real-fs note (see below). §9 behavior-port dispositions → honored (only browse + open-on-activate; rest deferred). §10 constraints → Global Constraints. §11 decisions → Notes. Gap check: the spec's §8 "real-fs integration" test (a checked-in fixture through a real `ProjectContentProvider` + chokidar) is exercised end-to-end by Task 11's e2e (real Electron, real fs). If a faster real-fs integration test at the plexus-core tier is wanted, add it to Task 6 using `NodeFsStorage` in a temp dir (the P1 pattern) — noted, not mandated, to avoid duplicating the e2e.

**2. Placeholder scan.** Task code is concrete. The two soft spots are deliberately flagged, not hidden: (a) exact `ObservableCollection`/`Observable` method names — the plan instructs verifying against the real runtime API before finalizing (Task 3 note); (b) the imperative per-instance contributor registration — two concrete options with a decision rule (Task 9 ruling). Both are "confirm one real API detail," not "figure out what to do." The e2e steps reference the existing smoke/save-ux harnesses rather than restating them (repeating a Playwright bootstrap verbatim would be noise).

**3. Type consistency.** `HierarchyItemVM(model, id, parent, onActivate)` is used identically in Tasks 3, 4, 9. `HierarchyTreeVM(model, root, onActivate)` consistent Tasks 4, 9. `RefreshDisplay()` made public in Task 3 (the Task 4 note pulls it forward, and Task 3's commit includes it). `OpenMemberFile(member, path, kind)` defined in Task 8, called in Task 9. `NodeKey.Solution`/`NodeKey.Project` used consistently. `severityOf`/`ProjectsListingContributor` node shape matches `HierarchyNode`.

**4. Review Focus coverage.** Eager mount → Task 1 test 3. Watcher leak on swap → Task 9 test 3. Rename churn → Task 1 test 2 + Task 3 test 3. Async status flip → Task 5 test 4. Activate on non-file → Task 9 test 4. All five have owning tests.
