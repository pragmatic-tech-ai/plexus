# Spec — P0: Hierarchy Framework Primitives (mural/framework)

> Status: **draft for review**. First sub-project of the Solution Hierarchy Migration
> (umbrella: `2026-09-29-solution-hierarchy-migration-spec.md`). Design of record:
> `2026-09-19-solution-hierarchy-design.md` §3–6, §10–17; `-spec.md` §5–7, §10.
> Scope: **Mural only**. No consumers; unit-tested with fakes. Ships a Mural release.

## 1. Goal

Add the reusable hierarchy runtime to `mural/framework`: the node/provider/contribution
contracts, the `HierarchyModel` that walks contributors and realizes children by
subscription, the `HierarchyContributorRegistry` fed by a new `.hierarchyContributors:`
module DSL block and a runtime API, the `NodeKey` owner-class governance pattern with a
compose-time collision check, and the `KEY-NAMESPACES.md` allocation doc. Everything is
tested against fake providers/contributors — no engine, no app, no tree control.

## 2. Non-goals (P0)

- The engine content store, `SolutionMember.Status`, any `IHierarchyProvider`
  implementation over real storage (P1/P2).
- The `SolutionExplorer` capability service, any real contributors, the TreeView
  rendering / DataTemplates (P2).
- Generalizing the collision check to every existing registry (governance follow-up);
  P0 enforces it for the hierarchy registry and establishes the pattern + the doc.
- Selection UI, commands, persistence, cross-hierarchy (P4–P6).

## 3. Placement

- Runtime + contracts: `Mural/src/framework/hierarchy/` (beside `shell/`).
- Tests: `Mural/src/framework/hierarchy/tests/`.
- DSL/collection on `ShellModule`: `Mural/src/framework/shell/module.ts` (+ the
  `PopulateFromModules` registry in `hierarchy/`, mirroring
  `shell/documents/document-type-registry.ts`).
- Compiler support for the `.hierarchyContributors:` block: `Mural/src/compiler/compiler.ts`.
- Governance doc: `Mural/docs/KEY-NAMESPACES.md` (referenced repo-wide).

Naming: the tree contributor is **`HierarchyContributor`** (TODL's Domain already owns a
different `Contributor`). All public methods/interfaces PascalCase; classes use Allman
braces; string keys hoisted to owner-class constants.

## 4. Contracts (final signatures)

Lifted from `-spec.md` §5, with house-style method casing.

```ts
// Opaque, provider-interned node handle. Sentinels are universal.
abstract class HierarchyItemId
{
    protected constructor() {}
    static readonly Root: HierarchyItemId
    static readonly Nil:  HierarchyItemId
}

enum NodeSeverity { Ok, Warning, Error }

interface HierarchyNode
{
    readonly Key: string          // coarse family (NodeKey.*)
    readonly Caption: string
    readonly IconKey: string
    readonly ExtObject: unknown   // the engine instance this node represents
    readonly Severity: NodeSeverity
    readonly Error?: string       // reason shown in the decoration tooltip when not Ok
}

// Change deltas — ONE channel for async initial load AND external edits.
abstract class HierarchyChange {}
class ChildAdded   extends HierarchyChange { constructor(readonly Node: HierarchyNode) { super() } }
class ChildRemoved extends HierarchyChange { constructor(readonly Id: HierarchyItemId) { super() } }
class ChildUpdated extends HierarchyChange { constructor(readonly Id: HierarchyItemId) { super() } }

enum HierarchyPropertyId { Caption, IconKey, IsExpandable, CanonicalName, ExtObject, Severity }

interface IHierarchyProvider
{
    readonly ProviderId: string
    ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): IDisposable
    GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown
    GetCanonicalName(id: HierarchyItemId): string
    ParseCanonicalName(name: string): HierarchyItemId            // Nil if not found
    CanAccept(target: HierarchyItemId, drop: DropData): boolean  // drop-target validation
}

abstract class HierarchyContribution {}
class NodeContribution     extends HierarchyContribution { constructor(readonly Nodes: readonly HierarchyNode[]) { super() } }
class ProviderContribution extends HierarchyContribution { constructor(readonly Provider: IHierarchyProvider)  { super() } }

interface IHierarchyContributor
{
    readonly ParentKeys: readonly string[]   // registers under each; may serve several families
    readonly Order: number
    Contribute(parent: HierarchyNode): HierarchyContribution   // decides from parent.Key / parent.ExtObject
}
```

## 5. HierarchyModel (the keyed-regime walker)

Owns keyed-node identity + interning; drives the contributor walk; realizes children by
subscription; patches on deltas. Design §3, §6.

- `SeedRoot(node: HierarchyNode): HierarchyItemId` — interns the root (e.g. the solution
  node) and returns its id.
- `RealizeChildren(id)` — gather contributors whose `ParentKeys` include the node's
  `Key`, ordered by `Order`; for each contribution:
  - `NodeContribution` → intern each child (mint/reuse a stable `HierarchyItemId` keyed
    by `(parentId, child.Key, identity(child.ExtObject))`), stay in the keyed regime.
  - `ProviderContribution` → subscribe `provider.ObserveChildren(providerRootId, sink)`;
    below this point the **provider** interns identity and the registry is NOT consulted.
  - **Realize = subscribe:** initial children arrive as `ChildAdded` deltas exactly like
    later external changes — one channel. Collapse/dispose tears the subscription down.
- `Collapse(id)` — dispose the child subscription(s); no leak.
- Identity is **stable across re-contribution**: the same `(parent, key, ExtObject)`
  maps to the same `HierarchyItemId`, so selection/expansion survive a re-contribute and
  a `ChildUpdated`.
- Canonical names: providers implement `Get/ParseCanonicalName` for their opaque
  branches; `HierarchyModel` composes canonical names for keyed nodes and delegates
  across the provider boundary (design §12).
- Runtime re-contribution: subscribe to `HierarchyContributorRegistry.Changed`; a new
  registration keyed to an **already-realized** node re-runs its contributor walk live.

## 6. HierarchyContributorRegistry

Mirrors `DocumentTypeRegistry`/`CommandRegistry` (`shell/*/…-registry.ts`).

- `PopulateFromModules(app)` — resolve `ApplicationService`, iterate `app.Modules`,
  up-cast `IShellModule → ShellModule`, read each `.HierarchyContributors` collection,
  index by every key in `ParentKeys`, ordered by `Order`.
- Runtime: `Register(def: HierarchyContributorDefinition): IDisposable` +
  `Changed: ISignal`. Unregister on dispose; both fire `Changed`.
- `For(parentKey): readonly IHierarchyContributor[]` — ordered lookup used by
  `HierarchyModel.RealizeChildren`.
- **Compose-time collision check:** `PopulateFromModules` throws on a duplicate *owned*
  key across modules (a NodeKey declared by two owners), per §8. Contributor
  registrations under the same `ParentKey` are NOT collisions — that is the extension
  mechanism; the collision check is about **key ownership**, not contributor multiplicity.

## 7. DSL block `.hierarchyContributors:`

- `ShellModule` gains `HierarchyContributors: ObservableCollection<HierarchyContributorDefinition>`
  (module.ts, beside `Documents`/`Commands`/`Settings`).
- `HierarchyContributorDefinition [ ParentKeys, Contributor, Order ]` — a `MuralBase`/DP
  definition mirroring `DocumentTypeDefinition`.
- Compiler: map the `hierarchyContributors` member-block to the `HierarchyContributors`
  collection accessor (compiler.ts `compileMemberBlock`; the generic path already lowers
  an unknown member-block to `module.<name>.Add(...)`, so this is a named remap +
  definition wiring, not a new lowering mechanism).
- Authored form:
  ```
  module SomeModule {
      .hierarchyContributors: {
          HierarchyContributorDefinition [ ParentKeys = [NodeKey.Solution], Contributor = ProjectsListingContributor, Order = 0 ]
      }
  }
  ```

## 8. NodeKey governance (design §17)

- `NodeKey` owner class in `hierarchy/node-key.ts` with static string members for the
  framework-owned families: `Solution`, `Project`, `Connections`, `References` (coarse
  families; the concrete project *type* lives on the instance, never in the key). Factory
  methods only for genuinely parameterized keys (none needed for these).
- Modules that introduce new node families own their own `NodeKey`-style owner class,
  owner-prefixed, colocated with the concept, re-exported from the module index.
- `Mural/docs/KEY-NAMESPACES.md` records which prefix each module owns (the allocation
  doc), referenced repo-wide.
- `PopulateFromModules` collision-checks contributed/owned node keys and throws on a
  duplicate owner at compose.
- **Markup-literal ↔ constant validation:** the `.mu` DSL forces a string literal at the
  `ParentKeys` site; a test asserts the literal equals the `NodeKey` constant's value
  (the existing `diagram-settings`/`diagram-command` "markup-string ↔ code-constant"
  contract is the precedent).

## 9. Test matrix (unit, fakes, no consumers)

`Mural/src/framework/hierarchy/tests/`:

- **realize = subscribe (both cases, one channel):** a fake provider that emits
  `ChildAdded` on subscribe AND later (simulated external edit) — `HierarchyModel` patches
  the same child collection for both; initial and later deltas are indistinguishable.
- **patch per delta type:** `ChildAdded` inserts, `ChildRemoved` drops, `ChildUpdated`
  refreshes caption/icon *in place* (same `HierarchyItemId`, selection preserved).
- **keyed vs provider routing:** `NodeContribution` stays in the keyed regime (children
  come from the registry); `ProviderContribution` hands off and the registry is NOT
  consulted below it. The boundary is exactly the `ProviderContribution`.
- **stable identity across re-contribution:** same `(parent, key, ExtObject)` → same id;
  a re-contribute (e.g. after `Members` change) does not churn ids for survivors.
- **collapse disposes:** collapsing a realized node disposes its provider subscription
  (fake provider records dispose); no delta after dispose mutates the tree.
- **registry indexing:** a contributor with multiple `ParentKeys` is indexed under each;
  `For(key)` returns contributors ordered by `Order`.
- **runtime live re-contribution:** `Register` a contributor keyed to an already-realized
  node → `Changed` → that node re-contributes and the new children appear live; dispose
  removes them.
- **collision check:** two modules declaring the same *owned* NodeKey → `PopulateFromModules`
  throws at compose; two contributors under the same `ParentKey` do NOT throw.
- **markup ↔ constant:** a `.hierarchyContributors:` literal `ParentKey` equals the
  `NodeKey` constant value (compile-a-fixture-module test).
- **canonical name compose:** keyed-node canonical name composes across a provider
  boundary; `ParseCanonicalName` round-trips to the same id, `Nil` for unknown.

## 10. Review focus (design-implied, must be pinned by a test above)

1. Initial load and external edit are the **same** delta channel (not two code paths).
2. Collapse/dispose leaks no subscription.
3. A runtime registration keyed to an already-expanded node re-contributes **live**.
4. `ProviderContribution` stops registry consultation below it (two identity regimes).
5. Selection/expansion survive `ChildUpdated` (stable identity).
6. Collision check fires at **compose**, on key ownership — not on contributor multiplicity.

## 11. Deliverable & release

Green Mural suite + typecheck; the hierarchy framework is importable from
`@pragmatic-tech-ai/mural/framework`, exercised only by its own fake-backed tests. Publish
a Mural minor version so P1/P2 can consume it. No Plexus/devUI change in P0.
