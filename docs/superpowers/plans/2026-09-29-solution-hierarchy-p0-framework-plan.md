# Hierarchy Framework Primitives (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the reusable hierarchy runtime (contracts, `HierarchyModel`, contributor registry + DSL, `NodeKey` governance) to `mural/framework`, exercised only by fake-backed unit tests.

**Architecture:** Net-new `Mural/src/framework/hierarchy/` package mirroring the existing shell-module patterns: DP-backed definitions (like `DocumentDefinition`), a `ServiceBase` registry populated from modules (like `DocumentTypeRegistry.PopulateFromModules`), a `.hierarchyContributors:` member-block that lowers to a `ShellModule` collection (like `.documents:`), and a standalone `HierarchyModel` walker that realizes children by subscription. No consumers; ships a Mural minor release.

**Tech Stack:** TypeScript, Mural runtime (`MuralBase`/DP system, `ObservableCollection`, `Observable.PropertyChanged`/`RaisePropertyChanged`, `ServiceBase`/`ServiceKey`), Mural `.mu` compiler, node:test-style Mural unit tests.

**Spec:** `Plexus/docs/superpowers/specs/2026-09-29-solution-hierarchy-p0-framework-spec.md` (umbrella: `…-solution-hierarchy-migration-spec.md`; design of record: `…2026-09-19-solution-hierarchy-design.md` §3–6,§10–17).

## Global Constraints

- **Mural repo only** (`C:\Users\Eugene\Projects\architecture-agent\Mural`). No TODL/Plexus edits. No consumers of the new code beyond its own tests.
- **Placement:** runtime + contracts in `src/framework/hierarchy/`; tests in `src/framework/hierarchy/tests/`; `ShellModule` collection in `src/framework/shell/module.ts`; compiler remap in `src/compiler/compiler.ts`; symbol registration in `src/compiler/symbol-table.ts`; governance doc at `docs/KEY-NAMESPACES.md`.
- **Naming:** the tree contributor is `HierarchyContributor` (never bare `Contributor` — TODL's Domain owns that). All interfaces and public methods PascalCase.
- **House style:** Allman braces (opening brace on its own line) for every class/method/control block; view-model/definition classes extend `MuralBase` (DP-backed, declarable in markup) mirroring `DocumentDefinition`; reused string literals hoisted to `private static readonly` PascalCase constants; enums, not string-literal unions.
- **Disposer convention:** subscriptions/registrations return a `() => void` unsubscribe function (the codebase convention — `ObservableCollection.Subscribe` returns `() => void`), NOT an `IDisposable` object. This deviates from the design doc's `IDisposable`; it aligns to the mural idiom.
- **Change notification:** a registry/model exposes "changed" via `Observable.PropertyChanged(name).subscribe(cb)` + `RaisePropertyChanged(name, old, new)` (the `NavigationService` idiom), not a bespoke `Signal` class (mural runtime has no standalone `Signal`).
- **TDD:** each task writes a failing test first, then the minimal code, then commits. Run the Mural suite for the touched area after each task.

## Review Focus

- **Realize=subscribe is one channel:** a provider that emits `ChildAdded` on subscribe AND later (external edit) patches the same collection identically — Task 6a test.
- **Collapse leaks no subscription:** collapsing a realized node calls the provider's disposer; a post-dispose delta mutates nothing — Task 6a test.
- **Live re-contribution:** a runtime `Register` keyed to an already-realized node re-contributes and new children appear; its disposer removes them — Task 6b test.
- **Provider boundary stops the keyed regime:** below a `ProviderContribution` the registry is never consulted — Task 6a test.
- **Stable identity across re-contribution / `ChildUpdated`:** same `(parent,key,ExtObject)` → same `HierarchyItemId`; a `ChildUpdated` keeps the id so selection survives — Task 6a test.
- **Collision fires at compose on key OWNERSHIP, not contributor multiplicity:** two owners of one `NodeKey` throw; two contributors under one `ParentKey` do not — Task 2 + Task 5 tests.

---

### Task 1: Core contracts + sentinels

**Files:**
- Create: `src/framework/hierarchy/hierarchy-node.ts`
- Create: `src/framework/hierarchy/index.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-node.test.ts`

**Interfaces:**
- Produces: `HierarchyItemId` (abstract, `static Root`, `static Nil`), `enum NodeSeverity { Ok, Warning, Error }`, `interface HierarchyNode { Key, Caption, IconKey, ExtObject, Severity, Error? }`, `abstract class HierarchyChange` + `ChildAdded(Node)` / `ChildRemoved(Id)` / `ChildUpdated(Id)`, `enum HierarchyPropertyId { Caption, IconKey, IsExpandable, CanonicalName, ExtObject, Severity }`, `interface DropData { readonly Kind: string; readonly Payload: unknown }`, `interface IHierarchyProvider`, `interface IHierarchyContributor`, `abstract class HierarchyContribution` + `NodeContribution(Nodes)` / `ProviderContribution(Provider)`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    HierarchyItemId, NodeSeverity, ChildAdded, ChildRemoved, ChildUpdated,
    NodeContribution, ProviderContribution, HierarchyContribution, type HierarchyNode,
} from '../index.js';

function node(key: string, ext: unknown): HierarchyNode
{
    return { Key: key, Caption: key, IconKey: '', ExtObject: ext, Severity: NodeSeverity.Ok };
}

test('HierarchyItemId sentinels are distinct and stable', () =>
{
    assert.notEqual(HierarchyItemId.Root, HierarchyItemId.Nil);
    assert.equal(HierarchyItemId.Root, HierarchyItemId.Root);
});

test('contribution classes carry their payload and are instanceof HierarchyContribution', () =>
{
    const n = new NodeContribution([node('project', {})]);
    assert.ok(n instanceof HierarchyContribution);
    assert.equal(n.Nodes.length, 1);
    const p = new ProviderContribution({ ProviderId: 'x' } as never);
    assert.ok(p instanceof HierarchyContribution);
    assert.equal(p.Provider.ProviderId, 'x');
});

test('change deltas carry node / id', () =>
{
    const add = new ChildAdded(node('a', 1));
    assert.equal(add.Node.Key, 'a');
    assert.equal(new ChildRemoved(HierarchyItemId.Nil).Id, HierarchyItemId.Nil);
    assert.equal(new ChildUpdated(HierarchyItemId.Nil).Id, HierarchyItemId.Nil);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/framework/hierarchy/tests/hierarchy-node.test.ts`
Expected: FAIL — cannot find module `../index.js`.

- [ ] **Step 3: Write minimal implementation**

`src/framework/hierarchy/hierarchy-node.ts`:

```ts
// Opaque, provider-interned node handle. Concrete ids are minted by HierarchyModel
// (keyed nodes) or a provider (opaque branches); callers only compare identity. The
// two sentinels are universal: Root = the tree root anchor, Nil = "no such node".
export abstract class HierarchyItemId
{
    protected constructor() {}
    public static readonly Root: HierarchyItemId = new (class extends HierarchyItemId {})();
    public static readonly Nil:  HierarchyItemId = new (class extends HierarchyItemId {})();
}

export enum NodeSeverity { Ok, Warning, Error }

// A rendered node: its coarse family Key (NodeKey.*), the engine instance it stands
// for (ExtObject), display facts, and health that drives the error/warning decoration.
export interface HierarchyNode
{
    readonly Key: string;
    readonly Caption: string;
    readonly IconKey: string;
    readonly ExtObject: unknown;
    readonly Severity: NodeSeverity;
    readonly Error?: string;
}

// One channel for async initial load AND external edits.
export abstract class HierarchyChange {}
export class ChildAdded extends HierarchyChange
{
    constructor(public readonly Node: HierarchyNode) { super(); }
}
export class ChildRemoved extends HierarchyChange
{
    constructor(public readonly Id: HierarchyItemId) { super(); }
}
export class ChildUpdated extends HierarchyChange
{
    constructor(public readonly Id: HierarchyItemId) { super(); }
}

export enum HierarchyPropertyId { Caption, IconKey, IsExpandable, CanonicalName, ExtObject, Severity }

// Minimal drop payload; real drop validation is P3 — P0 ships the contract only.
export interface DropData
{
    readonly Kind: string;
    readonly Payload: unknown;
}

// Owns an opaque subtree: answers ObserveChildren (realize = subscribe), node
// properties, canonical names, and drop-target validation; interns its own handles.
export interface IHierarchyProvider
{
    readonly ProviderId: string;
    ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void;
    GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown;
    GetCanonicalName(id: HierarchyItemId): string;
    ParseCanonicalName(name: string): HierarchyItemId;   // Nil if not found
    CanAccept(target: HierarchyItemId, drop: DropData): boolean;
}

export abstract class HierarchyContribution {}
export class NodeContribution extends HierarchyContribution
{
    constructor(public readonly Nodes: readonly HierarchyNode[]) { super(); }
}
export class ProviderContribution extends HierarchyContribution
{
    constructor(public readonly Provider: IHierarchyProvider) { super(); }
}

// Registers for a SET of parent families; decides what to return from the actual node
// in the call (parent.Key / parent.ExtObject).
export interface IHierarchyContributor
{
    readonly ParentKeys: readonly string[];
    readonly Order: number;
    Contribute(parent: HierarchyNode): HierarchyContribution;
}
```

`src/framework/hierarchy/index.ts`:

```ts
export * from './hierarchy-node.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/framework/hierarchy/tests/hierarchy-node.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-node.ts src/framework/hierarchy/index.ts src/framework/hierarchy/tests/hierarchy-node.test.ts
git commit -m "feat(hierarchy): P0 core contracts (node, changes, provider, contributor)"
```

---

### Task 2: NodeKey owner class + NodeKeyRegistry (collision check) + KEY-NAMESPACES.md

**Files:**
- Create: `src/framework/hierarchy/node-key.ts`
- Create: `src/framework/hierarchy/node-key-registry.ts`
- Create: `docs/KEY-NAMESPACES.md`
- Modify: `src/framework/hierarchy/index.ts`
- Test: `src/framework/hierarchy/tests/node-key.test.ts`

**Interfaces:**
- Consumes: (none)
- Produces: `class NodeKey` with `static readonly Solution/Project/Connections/References: string`; `class NodeKeyRegistry` with `DeclareOwned(key: string, ownerId: string): void` (throws `DuplicateNodeKeyError` on a second, different owner; idempotent for the same owner) and `Owners(): ReadonlyMap<string,string>`; `class DuplicateNodeKeyError extends Error`.

**Ruling (spec §8 was thin on the collision mechanism):** key OWNERSHIP is tracked explicitly. A module that defines a node-key family declares it via `NodeKeyRegistry.DeclareOwned(key, ownerId)`; a second, different owner of the same key string throws at compose. This is separate from contributor indexing (Task 5), where many contributors under one `ParentKey` is the extension mechanism, never a collision. `KEY-NAMESPACES.md` is the human allocation record. (A `.nodeKeys:` DSL block is a deferred convenience, not P0.)

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeKey, NodeKeyRegistry, DuplicateNodeKeyError } from '../index.js';

test('NodeKey families have their canonical string values (markup literal <-> constant)', () =>
{
    assert.equal(NodeKey.Solution, 'solution');
    assert.equal(NodeKey.Project, 'project');
    assert.equal(NodeKey.Connections, 'connections');
    assert.equal(NodeKey.References, 'references');
});

test('declaring the same key from two different owners throws at compose', () =>
{
    const reg = new NodeKeyRegistry();
    reg.DeclareOwned(NodeKey.Project, 'todl-project-system');
    assert.throws(() => reg.DeclareOwned(NodeKey.Project, 'some-other-module'), DuplicateNodeKeyError);
});

test('re-declaring the same key from the SAME owner is idempotent, not a collision', () =>
{
    const reg = new NodeKeyRegistry();
    reg.DeclareOwned(NodeKey.Solution, 'framework');
    assert.doesNotThrow(() => reg.DeclareOwned(NodeKey.Solution, 'framework'));
    assert.equal(reg.Owners().get(NodeKey.Solution), 'framework');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/framework/hierarchy/tests/node-key.test.ts`
Expected: FAIL — `NodeKey`/`NodeKeyRegistry` not exported.

- [ ] **Step 3: Write minimal implementation**

`src/framework/hierarchy/node-key.ts`:

```ts
// Owner class for the framework's coarse node families (design §17). Coarse: the
// concrete project TYPE lives on the instance (member.Ref.type), never in the key.
// Modules that introduce new families own their own owner-prefixed NodeKey-style
// class, colocated with the concept, and declare them via NodeKeyRegistry.
export class NodeKey
{
    public static readonly Solution    = 'solution';
    public static readonly Project     = 'project';
    public static readonly Connections = 'connections';
    public static readonly References  = 'references';
}
```

`src/framework/hierarchy/node-key-registry.ts`:

```ts
// Thrown when two different owners declare the same node-key string — the
// compose-time collision the governance model forbids (design §17).
export class DuplicateNodeKeyError extends Error
{
    constructor(key: string, existing: string, offender: string)
    {
        super(`Node key '${key}' is already owned by '${existing}'; '${offender}' cannot also own it.`);
        this.name = 'DuplicateNodeKeyError';
    }
}

// Tracks which module owns each node-key string. DeclareOwned throws on a second,
// different owner; the same owner re-declaring is idempotent (a module composed
// twice, or a re-populate). Contributor MULTIPLICITY (Task 5) is unrelated — many
// contributors may register under one ParentKey.
export class NodeKeyRegistry
{
    private readonly owners = new Map<string, string>();

    public DeclareOwned(key: string, ownerId: string): void
    {
        const existing = this.owners.get(key);
        if (existing !== undefined && existing !== ownerId)
        {
            throw new DuplicateNodeKeyError(key, existing, ownerId);
        }
        this.owners.set(key, ownerId);
    }

    public Owners(): ReadonlyMap<string, string>
    {
        return this.owners;
    }
}
```

Append to `src/framework/hierarchy/index.ts`:

```ts
export * from './node-key.js';
export * from './node-key-registry.js';
```

`docs/KEY-NAMESPACES.md` (allocation record):

```markdown
# Key namespaces

Repo-wide allocation of string-key ownership (design §17). Each string-key domain has
ONE owner class; this file records which prefix/family each module owns. A compose-time
`NodeKeyRegistry.DeclareOwned` collision check enforces node-key ownership.

## Node keys (hierarchy families — `NodeKey.*`)
| Key | Owner | Notes |
|-----|-------|-------|
| `solution` | mural/framework (`NodeKey.Solution`) | the root family |
| `project` | mural/framework (`NodeKey.Project`) | coarse family; type on the instance |
| `connections` | mural/framework (`NodeKey.Connections`) | P5 |
| `references` | mural/framework (`NodeKey.References`) | P5 |

## Other string-key domains (existing)
| Domain | Owner |
|--------|-------|
| Diagram setting keys | `DiagramSettingKey` (mural framework/diagram) |
| Diagram command ids | `DiagramCommandId` (mural framework/diagram) |
| Project type ids | per-app factory consts (e.g. `TODL_PACKAGE_TYPE`) |
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/framework/hierarchy/tests/node-key.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/node-key.ts src/framework/hierarchy/node-key-registry.ts src/framework/hierarchy/index.ts docs/KEY-NAMESPACES.md src/framework/hierarchy/tests/node-key.test.ts
git commit -m "feat(hierarchy): NodeKey families + NodeKeyRegistry ownership collision check + KEY-NAMESPACES"
```

---

### Task 3: HierarchyContributorDefinition (DP definition) + symbol-table registration

**Files:**
- Create: `src/framework/hierarchy/hierarchy-contributor-definition.ts`
- Modify: `src/compiler/symbol-table.ts:128` area (add the symbol entry)
- Modify: `src/framework/hierarchy/index.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-contributor-definition.test.ts`

**Interfaces:**
- Consumes: `MuralBase`, `MetaData`, `ServiceToken` (from `../../../runtime/index.js`)
- Produces: `class HierarchyContributorDefinition extends MuralBase` with DPs `ParentKeys: readonly string[]` (default frozen `[]`), `Contributor: ServiceToken<unknown> | undefined` (default `undefined`), `Order: number` (default `0`), each with the `static …Key` + get/set pattern of `DocumentDefinition`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HierarchyContributorDefinition } from '../index.js';

test('definition exposes DP-backed ParentKeys / Contributor / Order with defaults', () =>
{
    const d = new HierarchyContributorDefinition();
    assert.deepEqual(d.ParentKeys, []);
    assert.equal(d.Contributor, undefined);
    assert.equal(d.Order, 0);
});

test('definition round-trips set values', () =>
{
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = ['solution'];
    d.Order = 5;
    assert.deepEqual(d.ParentKeys, ['solution']);
    assert.equal(d.Order, 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/framework/hierarchy/tests/hierarchy-contributor-definition.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Write minimal implementation**

`src/framework/hierarchy/hierarchy-contributor-definition.ts` (mirror `document-definition.ts`):

```ts
import { MetaData, MuralBase, type ServiceToken } from '../../runtime/index.js';

const EMPTY_KEYS: readonly string[] = Object.freeze([]);

// A HierarchyContributor's registration schema — what a module declares in its
// `.hierarchyContributors:` block. A MuralBase so it is DP-backed and declarable in
// markup, the same shape as DocumentDefinition:
//
//     .hierarchyContributors: {
//         HierarchyContributorDefinition
//             [ ParentKeys = [NodeKey.Solution], Contributor = ProjectsListingContributor, Order = 0 ]
//     }
export class HierarchyContributorDefinition extends MuralBase
{
    public static readonly ParentKeysKey = MuralBase.RegisterProperty<readonly string[]>(
        HierarchyContributorDefinition, 'ParentKeys', EMPTY_KEYS, MetaData.None);

    public static readonly ContributorKey = MuralBase.RegisterProperty<ServiceToken<unknown> | undefined>(
        HierarchyContributorDefinition, 'Contributor', undefined, MetaData.None);

    public static readonly OrderKey = MuralBase.RegisterProperty<number>(
        HierarchyContributorDefinition, 'Order', 0, MetaData.None);

    public get ParentKeys(): readonly string[]  { return this.get_property_value(HierarchyContributorDefinition.ParentKeysKey); }
    public set ParentKeys(v: readonly string[]) { this.set_property_value(HierarchyContributorDefinition.ParentKeysKey, v); }

    public get Contributor(): ServiceToken<unknown> | undefined  { return this.get_property_value(HierarchyContributorDefinition.ContributorKey); }
    public set Contributor(v: ServiceToken<unknown> | undefined) { this.set_property_value(HierarchyContributorDefinition.ContributorKey, v); }

    public get Order(): number  { return this.get_property_value(HierarchyContributorDefinition.OrderKey); }
    public set Order(v: number) { this.set_property_value(HierarchyContributorDefinition.OrderKey, v); }
}
```

In `src/compiler/symbol-table.ts`, add next to the `DocumentDefinition` entry (line ~128):

```ts
['HierarchyContributorDefinition', '@pragmatic-tech-ai/mural/framework/hierarchy/hierarchy-contributor-definition.js'],
```

Append to `src/framework/hierarchy/index.ts`:

```ts
export * from './hierarchy-contributor-definition.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/framework/hierarchy/tests/hierarchy-contributor-definition.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-contributor-definition.ts src/compiler/symbol-table.ts src/framework/hierarchy/index.ts src/framework/hierarchy/tests/hierarchy-contributor-definition.test.ts
git commit -m "feat(hierarchy): HierarchyContributorDefinition (DP) + symbol-table registration"
```

---

### Task 4: `.hierarchyContributors:` DSL block — ShellModule collection + compiler remap

**Files:**
- Modify: `src/framework/shell/module.ts` (add `HierarchyContributors` collection + import)
- Modify: `src/compiler/compiler.ts` (`compileMemberBlock` name remap, ~line 3872)
- Test: `src/framework/shell/tests/module-hierarchy-contributors.test.ts` (compile-a-fixture-module test)

**Interfaces:**
- Consumes: `HierarchyContributorDefinition` (Task 3), `ObservableCollection`
- Produces: `ShellModule.HierarchyContributors: ObservableCollection<HierarchyContributorDefinition>`; the compiler lowers a `.hierarchyContributors:` member-block to `module.HierarchyContributors.Add(def)`.

- [ ] **Step 1: Write the failing test**

Use the repo's existing compiler-test harness (compile a `.mu` source string and evaluate it). Mirror an existing `.documents:`/`.commands:` module compile test — find one under `src/compiler/tests/` or `src/framework/shell/tests/` and copy its harness imports.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileAndEval } from '<the existing module-compile test harness>'; // reuse the .documents:/.commands: test's harness
import { ShellModule } from '../module.js';

test('.hierarchyContributors: lowers each entry onto ShellModule.HierarchyContributors', () =>
{
    const src = `
        module TestModule {
            .hierarchyContributors: {
                HierarchyContributorDefinition [ ParentKeys = ["solution"], Order = 0 ]
            }
        }`;
    const mod = compileAndEval(src) as ShellModule;
    assert.equal(mod.HierarchyContributors.Count, 1);
    assert.deepEqual(mod.HierarchyContributors.ToArray()[0].ParentKeys, ['solution']);
});
```

> Implementer note: if no reusable `compileAndEval` helper exists, replicate the exact harness the nearest existing `.documents:`/`.commands:` compile test uses (compile → `new Function`/module eval → read the collection). Do NOT invent a new harness style.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/framework/shell/tests/module-hierarchy-contributors.test.ts`
Expected: FAIL — `HierarchyContributors` is undefined (remap + collection missing).

- [ ] **Step 3: Write minimal implementation**

In `src/framework/shell/module.ts`, add the import and the collection beside `Commands`:

```ts
import { HierarchyContributorDefinition } from '../hierarchy/hierarchy-contributor-definition.js';
```
```ts
    // Declared hierarchy contributors — HierarchyContributorDefinitions this module
    // contributes to the HierarchyContributorRegistry. Authored as a
    // `.hierarchyContributors: { HierarchyContributorDefinition … }` block: a generic
    // member-block, so each entry lowers to `module.HierarchyContributors.Add(def)`
    // (the compiler remaps the lowercase section to this PascalCase collection, exactly
    // as `.documents:` → `Documents`). HierarchyContributorRegistry aggregates these
    // across every composed module.
    public readonly HierarchyContributors: ObservableCollection<HierarchyContributorDefinition> =
        new ObservableCollection<HierarchyContributorDefinition>();
```

In `src/compiler/compiler.ts` `compileMemberBlock`, extend the name remap ternary (~line 3872):

```ts
        const memberName = block.name === 'settings'              ? 'Settings'
                         : block.name === 'documents'             ? 'Documents'
                         : block.name === 'commands'              ? 'Commands'
                         : block.name === 'hierarchyContributors' ? 'HierarchyContributors'
                         : block.name;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/framework/shell/tests/module-hierarchy-contributors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/framework/shell/module.ts src/compiler/compiler.ts src/framework/shell/tests/module-hierarchy-contributors.test.ts
git commit -m "feat(hierarchy): .hierarchyContributors: DSL block -> ShellModule.HierarchyContributors"
```

---

### Task 5: HierarchyContributorRegistry (populate, index, runtime register, Changed)

**Files:**
- Create: `src/framework/hierarchy/hierarchy-contributor-registry.ts`
- Modify: `src/framework/hierarchy/index.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts`

**Interfaces:**
- Consumes: `IHierarchyContributor`, `HierarchyContributorDefinition`, `ShellModule`, `ApplicationService`, `ServiceBase`, `ServiceKey`, `IServiceProvider`.
- Produces: `class HierarchyContributorRegistry extends ServiceBase` with `static Key`; `PopulateFromModules(): void` (index each module's `HierarchyContributors` by every `ParentKeys` entry, resolving the `Contributor` token lazily on first `For`); `For(parentKey: string): readonly IHierarchyContributor[]` (ordered by `Order`); `Register(def: HierarchyContributorDefinition): () => void` (runtime add, returns a remover); the `Changed` notification via `this.PropertyChanged(HierarchyContributorRegistry.ChangedProp)` raised by `RaisePropertyChanged` after populate/register/remove. Constant `private static readonly ChangedProp = 'Contributors'`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyContributorRegistry, HierarchyContributorDefinition, NodeContribution,
    type IHierarchyContributor, type HierarchyNode,
} from '../index.js';

class FakeContributor implements IHierarchyContributor
{
    constructor(public readonly ParentKeys: readonly string[], public readonly Order: number, private readonly tag: string) {}
    public Contribute(_p: HierarchyNode): NodeContribution { return new NodeContribution([]); }
    public get Tag(): string { return this.tag; }
}

function defFor(token: ServiceKey<IHierarchyContributor>, parents: string[], order: number): HierarchyContributorDefinition
{
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = parents; d.Order = order; d.Contributor = token;
    return d;
}

test('runtime Register indexes by every ParentKey, ordered by Order; disposer removes', () =>
{
    const provider = new ServiceProvider();
    const kA = new ServiceKey<IHierarchyContributor>('A');
    const kB = new ServiceKey<IHierarchyContributor>('B');
    provider.registerInstance(kA, new FakeContributor(['solution', 'project'], 10, 'A'));
    provider.registerInstance(kB, new FakeContributor(['solution'], 0, 'B'));
    const reg = new HierarchyContributorRegistry(provider);

    const offB = reg.Register(defFor(kB, ['solution'], 0));
    reg.Register(defFor(kA, ['solution', 'project'], 10));

    assert.deepEqual(reg.For('solution').map((c) => (c as FakeContributor).Tag), ['B', 'A']); // Order 0 then 10
    assert.deepEqual(reg.For('project').map((c) => (c as FakeContributor).Tag), ['A']);        // multi-ParentKey

    offB();
    assert.deepEqual(reg.For('solution').map((c) => (c as FakeContributor).Tag), ['A']);
});

test('Changed fires on register and on remove', () =>
{
    const provider = new ServiceProvider();
    const k = new ServiceKey<IHierarchyContributor>('K');
    provider.registerInstance(k, new FakeContributor(['solution'], 0, 'K'));
    const reg = new HierarchyContributorRegistry(provider);
    let fired = 0;
    reg.PropertyChanged('Contributors').subscribe(() => { fired++; });
    const off = reg.Register(defFor(k, ['solution'], 0));
    off();
    assert.equal(fired, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts`
Expected: FAIL — registry not exported.

- [ ] **Step 3: Write minimal implementation**

`src/framework/hierarchy/hierarchy-contributor-registry.ts` (mirror `document-type-registry.ts` for populate + `ServiceBase`):

```ts
import { ApplicationService, ServiceBase, ServiceKey, type IServiceProvider } from '../../runtime/index.js';
import { ShellModule } from '../shell/module.js';
import type { HierarchyContributorDefinition } from './hierarchy-contributor-definition.js';
import type { IHierarchyContributor } from './hierarchy-node.js';

// Aggregates every composed module's declared HierarchyContributorDefinitions and
// answers ordered contributor lookups by parent family key. Definitions flow module →
// service exactly as DocumentDefinitions flow into DocumentTypeRegistry. Also supports
// runtime Register for live contributions; both feeds raise the Changed notification so
// a HierarchyModel re-contributes already-realized nodes.
export class HierarchyContributorRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<HierarchyContributorRegistry>('HierarchyContributorRegistry');
    private static readonly ChangedProp = 'Contributors';

    // parentKey -> definitions registered under it (insertion order; sorted on read).
    private readonly byParent = new Map<string, HierarchyContributorDefinition[]>();
    // resolved-instance cache, keyed by definition (token resolved lazily on first For).
    private readonly resolved = new Map<HierarchyContributorDefinition, IHierarchyContributor>();

    constructor(provider: IServiceProvider)
    {
        super(provider);
        this.PopulateFromModules();
    }

    public PopulateFromModules(): void
    {
        const app = this.Provider.getRequired(ApplicationService.Key);
        for (const module of app.Modules)
        {
            for (const def of (module as ShellModule).HierarchyContributors)
            {
                this.add(def);
            }
        }
        this.RaisePropertyChanged(HierarchyContributorRegistry.ChangedProp, undefined, undefined);
    }

    // Live registration. Returns a remover that unregisters the definition and raises
    // Changed — a HierarchyModel keyed to an already-realized parent re-contributes.
    public Register(def: HierarchyContributorDefinition): () => void
    {
        this.add(def);
        this.RaisePropertyChanged(HierarchyContributorRegistry.ChangedProp, undefined, undefined);
        return () =>
        {
            this.remove(def);
            this.RaisePropertyChanged(HierarchyContributorRegistry.ChangedProp, undefined, undefined);
        };
    }

    // Contributors registered for `parentKey`, ordered by Order (ascending). Tokens are
    // resolved + cached on first read.
    public For(parentKey: string): readonly IHierarchyContributor[]
    {
        const defs = this.byParent.get(parentKey);
        if (defs === undefined) return [];
        return [...defs]
            .sort((a, b) => a.Order - b.Order)
            .map((d) => this.resolve(d));
    }

    private add(def: HierarchyContributorDefinition): void
    {
        for (const key of def.ParentKeys)
        {
            const list = this.byParent.get(key) ?? [];
            list.push(def);
            this.byParent.set(key, list);
        }
    }

    private remove(def: HierarchyContributorDefinition): void
    {
        for (const key of def.ParentKeys)
        {
            const list = this.byParent.get(key);
            if (list === undefined) continue;
            const i = list.indexOf(def);
            if (i >= 0) list.splice(i, 1);
        }
        this.resolved.delete(def);
    }

    private resolve(def: HierarchyContributorDefinition): IHierarchyContributor
    {
        let hit = this.resolved.get(def);
        if (hit === undefined)
        {
            hit = this.Provider.getRequired(def.Contributor!) as IHierarchyContributor;
            this.resolved.set(def, hit);
        }
        return hit;
    }
}
```

Append to `src/framework/hierarchy/index.ts`:

```ts
export * from './hierarchy-contributor-registry.js';
```

> Implementer note: confirm `ServiceProvider.registerInstance` and `getRequired` names against the runtime (the exploration cited `getRequired` and `registerInstance`); if the runtime uses different method names, adjust the test + `resolve` accordingly. Do not change the runtime.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-contributor-registry.ts src/framework/hierarchy/index.ts src/framework/hierarchy/tests/hierarchy-contributor-registry.test.ts
git commit -m "feat(hierarchy): HierarchyContributorRegistry (populate + index + runtime register + Changed)"
```

---

### Task 6a: HierarchyModel — realize=subscribe, keyed/provider routing, stable identity, collapse

**Files:**
- Create: `src/framework/hierarchy/hierarchy-model.ts`
- Modify: `src/framework/hierarchy/index.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-model.test.ts`

**Interfaces:**
- Consumes: `HierarchyContributorRegistry`, all contracts from Task 1.
- Produces: `class HierarchyModel` — `constructor(registry: HierarchyContributorRegistry)`; `SeedRoot(node: HierarchyNode): HierarchyItemId`; `RealizeChildren(id: HierarchyItemId): void`; `Collapse(id: HierarchyItemId): void`; `ChildrenOf(id: HierarchyItemId): readonly HierarchyItemId[]`; `NodeAt(id: HierarchyItemId): HierarchyNode`. Identity: a `MintedItemId extends HierarchyItemId` interned per `(parentId, key, ExtObject)`.

- [ ] **Step 1: Write the failing test** (the core behaviors — one channel, patch, routing, identity, collapse)

```ts
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

// A provider whose ObserveChildren emits controllable deltas and records disposal.
class FakeProvider implements IHierarchyProvider
{
    public readonly ProviderId = 'fake';
    public Sink: ((c: HierarchyChange) => void) | undefined;
    public Disposed = false;
    public ObserveChildren(_n: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        this.Sink = sink;
        return () => { this.Disposed = true; };
    }
    public GetProperty(): unknown { return undefined; }
    public GetCanonicalName(): string { return ''; }
    public ParseCanonicalName(): HierarchyItemId { return HierarchyItemId.Nil; }
    public CanAccept(): boolean { return false; }
}

function registryWith(provider: ServiceProvider, contributors: { token: ServiceKey<IHierarchyContributor>, parents: string[] }[]): HierarchyContributorRegistry
{
    const reg = new HierarchyContributorRegistry(provider);
    for (const c of contributors)
    {
        const d = new HierarchyContributorDefinition();
        d.ParentKeys = c.parents; d.Contributor = c.token; d.Order = 0;
        reg.Register(d);
    }
    return reg;
}

test('realize = subscribe: initial ChildAdded and a later ChildAdded patch the same collection', () =>
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const model = new HierarchyModel(registryWith(provider, [{ token: tok, parents: ['project'] }]));

    const root = model.SeedRoot(node('project', { id: 'p' }));
    model.RealizeChildren(root);
    assert.equal(model.ChildrenOf(root).length, 0);            // nothing yet — subscribed, no deltas
    fake.Sink!(new ChildAdded(node('file', { id: 'f1' })));    // initial load
    assert.equal(model.ChildrenOf(root).length, 1);
    fake.Sink!(new ChildAdded(node('file', { id: 'f2' })));    // later external add — SAME channel
    assert.equal(model.ChildrenOf(root).length, 2);
});

test('ChildUpdated keeps the same id (selection survives); ChildRemoved drops it', () =>
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const model = new HierarchyModel(registryWith(provider, [{ token: tok, parents: ['project'] }]));
    const root = model.SeedRoot(node('project', {}));
    model.RealizeChildren(root);
    fake.Sink!(new ChildAdded(node('file', { id: 'f1' }, 'old')));
    const id = model.ChildrenOf(root)[0];
    fake.Sink!(new ChildUpdated(id));
    assert.equal(model.ChildrenOf(root)[0], id);               // same identity
    fake.Sink!(new ChildRemoved(id));
    assert.equal(model.ChildrenOf(root).length, 0);
});

test('keyed regime: NodeContribution children come from the registry; provider boundary stops it', () =>
{
    const provider = new ServiceProvider();
    // solution -> keyed project node
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([node('project', { id: 'p' })]) } as IHierarchyContributor);
    // project -> provider (opaque)
    const files = new ServiceKey<IHierarchyContributor>('files');
    const fake = new FakeProvider();
    provider.registerInstance(files, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    // a spy contributor ALSO under 'project' proves the registry is NOT consulted below a provider
    let projectConsulted = 0;
    const spy = new ServiceKey<IHierarchyContributor>('spy');
    provider.registerInstance(spy, { ParentKeys: ['project'], Order: 1,
        Contribute: () => { projectConsulted++; return new NodeContribution([]); } } as IHierarchyContributor);

    const model = new HierarchyModel(registryWith(provider, [
        { token: listing, parents: ['solution'] },
        { token: files, parents: ['project'] },
        { token: spy, parents: ['project'] },
    ]));
    const root = model.SeedRoot(node('solution', {}));
    model.RealizeChildren(root);                       // keyed: contributes the project node
    const projectId = model.ChildrenOf(root)[0];
    model.RealizeChildren(projectId);                  // project has a ProviderContribution first
    // Under a provider boundary the keyed registry ('spy') must not be consulted:
    assert.equal(projectConsulted, 0);
});

test('collapse disposes the provider subscription; later deltas are ignored', () =>
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const model = new HierarchyModel(registryWith(provider, [{ token: tok, parents: ['project'] }]));
    const root = model.SeedRoot(node('project', {}));
    model.RealizeChildren(root);
    model.Collapse(root);
    assert.equal(fake.Disposed, true);
    fake.Sink!(new ChildAdded(node('file', {})));      // post-dispose delta
    assert.equal(model.ChildrenOf(root).length, 0);
});

test('stable identity: same (parent,key,ExtObject) re-realized keeps the id', () =>
{
    const provider = new ServiceProvider();
    const ext = { id: 'p' };
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    provider.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([node('project', ext)]) } as IHierarchyContributor);
    const model = new HierarchyModel(registryWith(provider, [{ token: listing, parents: ['solution'] }]));
    const root = model.SeedRoot(node('solution', {}));
    model.RealizeChildren(root);
    const first = model.ChildrenOf(root)[0];
    model.RealizeChildren(root);                        // re-contribute
    assert.equal(model.ChildrenOf(root)[0], first);     // survivor keeps identity
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/framework/hierarchy/tests/hierarchy-model.test.ts`
Expected: FAIL — `HierarchyModel` not exported.

- [ ] **Step 3: Write minimal implementation**

`src/framework/hierarchy/hierarchy-model.ts`:

```ts
import type { HierarchyContributorRegistry } from './hierarchy-contributor-registry.js';
import {
    HierarchyItemId, NodeContribution, ProviderContribution,
    ChildAdded, ChildRemoved, ChildUpdated,
    type HierarchyNode, type HierarchyChange, type IHierarchyProvider,
} from './hierarchy-node.js';

// A concrete, model-interned id. Identity is object identity (one instance per
// (parent,key,ExtObject)); consumers compare by ===.
class MintedItemId extends HierarchyItemId
{
    constructor(public readonly Key: string, public readonly Ext: unknown) { super(); }
}

// One realized node's bookkeeping: its node data, its ordered children, and — when a
// provider owns its subtree — the provider + its ObserveChildren disposer.
interface Entry
{
    node: HierarchyNode;
    children: HierarchyItemId[];
    provider?: IHierarchyProvider;
    dispose?: () => void;
    // provider-child id interning (by the delta's node identity), so ChildUpdated /
    // ChildRemoved can target an existing row.
    providerChildIds: Map<unknown, MintedItemId>;
}

// The keyed-regime walker (design §3,§5,§6). Owns keyed-node identity + interning,
// drives the contributor walk, realizes children by SUBSCRIPTION, and patches on
// deltas. Providers own identity within their opaque branches; the boundary is a
// ProviderContribution.
export class HierarchyModel
{
    private readonly entries = new Map<HierarchyItemId, Entry>();
    // keyed-child interning: parentId -> (key\u0000extIdentity) -> id.
    private readonly keyedChildren = new Map<HierarchyItemId, Map<unknown, MintedItemId>>();

    constructor(private readonly registry: HierarchyContributorRegistry)
    {
    }

    public SeedRoot(node: HierarchyNode): HierarchyItemId
    {
        const id = new MintedItemId(node.Key, node.ExtObject);
        this.entries.set(id, { node, children: [], providerChildIds: new Map() });
        return id;
    }

    public NodeAt(id: HierarchyItemId): HierarchyNode
    {
        return this.entry(id).node;
    }

    public ChildrenOf(id: HierarchyItemId): readonly HierarchyItemId[]
    {
        return this.entry(id).children;
    }

    // Fill (or refill) a node's children. Gathers contributors for the node's Key in
    // Order; a NodeContribution stays in the keyed regime (children interned here); a
    // ProviderContribution hands off — the provider is subscribed and the registry is
    // NOT consulted below this node.
    public RealizeChildren(id: HierarchyItemId): void
    {
        const entry = this.entry(id);
        for (const contributor of this.registry.For(entry.node.Key))
        {
            const contribution = contributor.Contribute(entry.node);
            if (contribution instanceof ProviderContribution)
            {
                this.attachProvider(id, entry, contribution.Provider);
                return;   // provider owns the subtree — stop consulting the registry
            }
            if (contribution instanceof NodeContribution)
            {
                for (const childNode of contribution.Nodes) this.internKeyed(id, entry, childNode);
            }
        }
    }

    public Collapse(id: HierarchyItemId): void
    {
        const entry = this.entry(id);
        if (entry.dispose !== undefined)
        {
            entry.dispose();
            entry.dispose = undefined;
            entry.provider = undefined;
        }
    }

    private attachProvider(id: HierarchyItemId, entry: Entry, provider: IHierarchyProvider): void
    {
        if (entry.provider === provider) return;   // already subscribed
        entry.provider = provider;
        entry.dispose = provider.ObserveChildren(id, (c) => this.patch(id, entry, c));
    }

    private patch(_id: HierarchyItemId, entry: Entry, change: HierarchyChange): void
    {
        if (entry.dispose === undefined) return;   // collapsed — ignore late deltas
        if (change instanceof ChildAdded)
        {
            const childId = new MintedItemId(change.Node.Key, change.Node.ExtObject);
            entry.providerChildIds.set(change.Node.ExtObject, childId);
            this.entries.set(childId, { node: change.Node, children: [], providerChildIds: new Map() });
            entry.children.push(childId);
        }
        else if (change instanceof ChildUpdated)
        {
            // identity preserved; node data refresh would land here (caption/icon).
            // No structural change — the id stays, so selection/expansion survive.
        }
        else if (change instanceof ChildRemoved)
        {
            const i = entry.children.indexOf(change.Id);
            if (i >= 0) entry.children.splice(i, 1);
            this.entries.delete(change.Id);
        }
    }

    private internKeyed(parentId: HierarchyItemId, parent: Entry, childNode: HierarchyNode): void
    {
        let map = this.keyedChildren.get(parentId);
        if (map === undefined) { map = new Map(); this.keyedChildren.set(parentId, map); }
        const identity = childNode.ExtObject;
        let childId = map.get(identity);
        if (childId === undefined)
        {
            childId = new MintedItemId(childNode.Key, childNode.ExtObject);
            map.set(identity, childId);
            this.entries.set(childId, { node: childNode, children: [], providerChildIds: new Map() });
            parent.children.push(childId);
        }
        else
        {
            this.entry(childId).node = childNode;   // refresh survivor's node data in place
        }
    }

    private entry(id: HierarchyItemId): Entry
    {
        const e = this.entries.get(id);
        if (e === undefined) throw new Error('HierarchyModel: unknown HierarchyItemId');
        return e;
    }
}
```

Append to `src/framework/hierarchy/index.ts`:

```ts
export * from './hierarchy-model.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/framework/hierarchy/tests/hierarchy-model.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-model.ts src/framework/hierarchy/index.ts src/framework/hierarchy/tests/hierarchy-model.test.ts
git commit -m "feat(hierarchy): HierarchyModel realize=subscribe + keyed/provider routing + stable identity + collapse"
```

---

### Task 6b: HierarchyModel — live re-contribution + canonical names

**Files:**
- Modify: `src/framework/hierarchy/hierarchy-model.ts`
- Test: `src/framework/hierarchy/tests/hierarchy-model-live.test.ts`

**Interfaces:**
- Consumes: `HierarchyContributorRegistry.PropertyChanged('Contributors')`, provider `GetCanonicalName`/`ParseCanonicalName`.
- Produces: `HierarchyModel` subscribes to the registry's Changed and re-realizes already-realized keyed nodes; `CanonicalNameOf(id): string` (keyed segment composition, delegating across a provider boundary); `Reveal(canonicalName): HierarchyItemId` (Nil if not found).

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyModel, HierarchyContributorRegistry, HierarchyContributorDefinition,
    NodeContribution, NodeSeverity, HierarchyItemId,
    type IHierarchyContributor, type HierarchyNode,
} from '../index.js';

function node(key: string, ext: unknown): HierarchyNode
{
    return { Key: key, Caption: key, IconKey: '', ExtObject: ext, Severity: NodeSeverity.Ok };
}

test('a runtime Register keyed to an already-realized node re-contributes live', () =>
{
    const provider = new ServiceProvider();
    const reg = new HierarchyContributorRegistry(provider);
    const model = new HierarchyModel(reg);
    const root = model.SeedRoot(node('solution', {}));
    model.RealizeChildren(root);
    assert.equal(model.ChildrenOf(root).length, 0);

    const tok = new ServiceKey<IHierarchyContributor>('late');
    provider.registerInstance(tok, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([node('project', { id: 'p' })]) } as IHierarchyContributor);
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = ['solution']; d.Contributor = tok; d.Order = 0;
    const off = reg.Register(d);                       // Changed -> model re-contributes root

    assert.equal(model.ChildrenOf(root).length, 1);
    off();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Mural && npx tsx --test src/framework/hierarchy/tests/hierarchy-model-live.test.ts`
Expected: FAIL — re-contribution not wired (child count stays 0).

- [ ] **Step 3: Write minimal implementation**

In `HierarchyModel`, subscribe to the registry in the constructor and re-realize realized keyed nodes on Changed. Add the canonical-name methods. Minimal additions:

```ts
    // in constructor, after field init:
    // Re-contribute already-realized keyed nodes when the contributor set changes
    // (a runtime Register/unregister). Provider-owned subtrees are unaffected (they
    // self-drive via ObserveChildren).
    // registry.PropertyChanged('Contributors').subscribe(() => this.reRealizeKeyed());
```

Wire it (constructor body):

```ts
    constructor(private readonly registry: HierarchyContributorRegistry)
    {
        this.registry.PropertyChanged('Contributors').subscribe(() => this.reRealizeKeyed());
    }

    private reRealizeKeyed(): void
    {
        // Re-run RealizeChildren for every entry that is NOT provider-owned. Interning
        // keeps survivors' ids stable; new contributions append.
        for (const [id, entry] of this.entries)
        {
            if (entry.provider === undefined) this.RealizeChildren(id);
        }
    }

    // Canonical name = slash-joined keyed segments (Key:extIdentity) from the root,
    // delegating to a provider's GetCanonicalName across the boundary. Minimal keyed
    // composition for P0 (providers' own scheme is exercised in P6).
    public CanonicalNameOf(id: HierarchyItemId): string
    {
        const e = this.entry(id);
        return `${e.node.Key}`;
    }

    public Reveal(canonicalName: string): HierarchyItemId
    {
        for (const [id, e] of this.entries)
        {
            if (e.node.Key === canonicalName) return id;
        }
        return HierarchyItemId.Nil;
    }
```

> Implementer note: `reRealizeKeyed` iterating `this.entries` while `RealizeChildren` mutates it can invalidate the iterator — snapshot the ids first (`[...this.entries.keys()]`) before the loop. Keep canonical-name composition minimal (P0); full ancestor-path canonical names + provider delegation are P6.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Mural && npx tsx --test src/framework/hierarchy/tests/hierarchy-model-live.test.ts` (and re-run Task 6a's file — no regressions)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/framework/hierarchy/hierarchy-model.ts src/framework/hierarchy/tests/hierarchy-model-live.test.ts
git commit -m "feat(hierarchy): HierarchyModel live re-contribution on registry change + canonical name stub"
```

---

### Task 7: Framework barrel export + green-suite gate

**Files:**
- Modify: `src/framework/index.ts` (or the framework barrel that consumers import) — re-export `./hierarchy/index.js`
- Test: run the full Mural suite + typecheck

**Interfaces:**
- Produces: `@pragmatic-tech-ai/mural/framework` re-exports the hierarchy package.

- [ ] **Step 1: Add the barrel re-export**

Find the framework barrel (`src/framework/index.ts` or equivalent that maps to the `@pragmatic-tech-ai/mural/framework` export) and add:

```ts
export * from './hierarchy/index.js';
```

- [ ] **Step 2: Typecheck**

Run: `cd Mural && npm run typecheck` (or `npx tsc --noEmit`)
Expected: 0 errors.

- [ ] **Step 3: Full suite**

Run: `cd Mural && npm test`
Expected: green (all prior + the new hierarchy tests). No skips introduced.

- [ ] **Step 4: Commit**

```bash
git add src/framework/index.ts
git commit -m "feat(hierarchy): export the hierarchy framework from @pragmatic-tech-ai/mural/framework"
```

- [ ] **Step 5: Release note (no publish here)**

Leave a one-line note in the PR/branch summary that P0 warrants a Mural minor version bump + publish so P1/P2 can consume it. Do NOT publish as part of this plan — publishing is a norms-gated step the human partner runs.

---

## Notes for the executor

- **Test harness:** Mural tests run under `node:test` via `tsx` (`npx tsx --test <file>`), matching existing `src/framework/**/tests/*.test.ts`. Confirm the exact command from a sibling test's npm script before Task 1; use whatever the repo actually uses.
- **`ServiceProvider` API:** the tests assume `registerInstance(key, value)` and `getRequired(key)`; verify against `src/runtime` and adjust test setup (not production code) if the names differ.
- **`ApplicationService`:** `HierarchyContributorRegistry.PopulateFromModules` resolves `ApplicationService.Key` and reads `.Modules` — identical to `DocumentTypeRegistry`. In the registry unit tests we drive `Register` directly rather than standing up an Application; a populate-from-modules integration test is deferred to P2 (where a real module exists).
- **Compiler test (Task 4):** reuse the existing `.documents:`/`.commands:` module-compile test's harness verbatim; do not author a new compile-eval mechanism.
