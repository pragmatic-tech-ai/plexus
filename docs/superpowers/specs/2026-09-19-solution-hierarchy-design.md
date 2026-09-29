# Solution Hierarchy — intermediate working design

> Status: **working draft** (mid-modeling). Promote to a `Kind = Spec` item in the
> GitHub Project *Architecture Agentic Suite* (org `pragmatic-tech-ai`, #1) when
> finalized. Not a local spec of record — this is the scratch we iterate on.

A provider/contributor hierarchy for TODL solutions & projects, modelled after the
VS `IVsHierarchy` family but adapted to our engine/UI split, reactive model, and
keyed-contribution idea.

## 1. Layers & ownership

| Concern | Owner | Layer |
|---|---|---|
| Open/save/close solution; reactive `SolutionModel` (members, opened project handles, per-project content store) | **SolutionManager** | engine (TODL, headless) |
| The **hierarchy** (top node, contributor walk, node identity, captions/icons, selection) | **SolutionExplorer** (capability service) | UI (presentation) |
| Keyed-node identity + contributor walk + realize/patch | **HierarchyModel** (held inside SolutionExplorer) | UI |
| Project *lifecycle* (`IProjectFactory`) | engine service resolved by SolutionManager | engine |
| Project *presentation* (`ProjectHierarchyContributor`) | contributed into the hierarchy | UI |
| Contributor registry | shared presentation infrastructure | UI |

Dependency points one way: **UI → engine**, never back. The engine holds no
hierarchy reference; the UI reads/projects and never mutates the model.

Naming: the engine service is **SolutionManager**; the presentation identity/cache
is **HierarchyModel** (deliberately *not* "manager", to avoid confusion).

## 2. Publish / observe flow

```
SolutionManager.OpenSolution()
   → builds reactive SolutionModel (engine)
   → this.ActiveSolution = model         // observable property push (Signal-only notify)
        ↓ subscription
SolutionExplorer.onActiveSolutionChanged(model)
   → dispose old HierarchyModel
   → build new HierarchyModel; seed root node { Key:'solution', ExtObject: model }
```

- `ActiveSolution` is the observable property — open/close/replace all flow through
  the one subscription (close ⇒ `ActiveSolution = undefined` ⇒ tear down).
- Two further subscription levels while open:
  - `SolutionModel.Members` — member added/removed ⇒ re-contribute under solution node (incremental).
  - per-node child subscriptions (see §6) — file/content deltas.

## 3. Keyed-contributor model

Every node carries its **`Key`** (element type), its **`ExtObject`** (the engine
instance it represents), and display facts (`Title`, `IconKey`).

```ts
interface HierarchyNode { readonly Key: string; readonly Caption: string; readonly IconKey: string; readonly ExtObject: unknown }

abstract class HierarchyContribution {}
class NodeContribution     extends HierarchyContribution { constructor(readonly Nodes: readonly HierarchyNode[]) { super() } }
class ProviderContribution extends HierarchyContribution { constructor(readonly Provider: IHierarchyProvider)   { super() } }

interface IHierarchyContributor {
    readonly ParentKeys: readonly string[]   // registers under EACH; may serve several keys
    readonly Order: number
    Contribute(parent: HierarchyNode): HierarchyContribution   // branches on parent.Key / parent.ExtObject
}
```

Contributors register for a **set** of parent keys and **decide what to return based on
the actual node in the call** (`parent.Key`, `parent.ExtObject`). The registry indexes a
contributor under every key in `ParentKeys`.

**Node keys are coarse FAMILIES, not fine discriminators.** `node.Key = NodeKey.Project`
(`'project'`) for every project regardless of type; the specific type lives on the
instance (`member.Ref.type`) and is read in the call when a contributor needs it. This
handles the open set (new project types at runtime) and pairs with decide-in-call.

Filling a node's children: gather contributors whose `ParentKey === node.Key`,
ordered; for each:
- **`NodeContribution`** → add nodes; stay in the **keyed regime** (each child's
  children come from the registry, matched on the child's `Key`). Identity minted &
  interned by **HierarchyModel**.
- **`ProviderContribution`** → hand the branch to the provider; **stop consulting
  the registry** below there. Identity interned by the **provider**.

Two identity regimes coexist; the boundary between them is a `ProviderContribution`.

**Decision rule — open vs opaque (which contribution kind to use):**
- **`NodeContribution` (keyed, open)** — where nodes from *different modules must
  coexist as siblings*: the **solution** node, the **project** node. Stay extensible.
- **`ProviderContribution` (opaque)** — where a branch is *one owner's private,
  self-driving subtree*: a folder's file listing, a resolved package set, a
  connection list. Closed to keyed extension by design.

A provider is always *delivered by* a contributor (it never replaces the contributor
layer). Provider-owned branches begin at the **leaves of composition** (folders,
References, Connections), **not** at the project node — the project node stays open so
other modules can add sibling nodes (References, Package Managers) next to its files.

## 4. Composition — everything is a contributor

```
solution                                   ← seeded by SolutionExplorer (ExtObject = SolutionModel)
 ├─ Auth  (Key "project:architecture")     ← projects-listing contributor (ParentKey "solution"); ExtObject = member
 │   └─ Viewpoints / files …               ← project presentation contributor (ParentKey "project:architecture") → ProviderContribution
 └─ Package Managers                        ← another contributor (ParentKey "solution")
     ├─ npmjs / github                      ← package-managers provider
```

- Members are no longer special — just a contributor keyed to `"solution"`.
- A project node is **owned by the solution hierarchy** (keyed node, identity by
  HierarchyModel); the project's **own provider owns everything beneath it**. The
  node is the seam: keyed node to the solution tree, and simultaneously the
  provider's `Root` (`provider.ObserveChildren(Root, …)` fills its children). This
  is the VS outer/nested identity pairing.

## 5. Factory / presentation split

`IProjectFactory` is a **pure engine service** (lifecycle only, headless):

```ts
interface IProjectFactory {
    openProject(storage: IStorage): Promise<Project>
    createProject(storage: IStorage, name: string): Promise<Project>
    saveProject(project: Project, storage: IStorage): Promise<void>
    // formats / version / publish stay here — engine capabilities, not visuals
}
```

Project **presentation** is a keyed contributor (presentation band) that reads the
node's `ExtObject`:

The project node stays **keyed/open** (see §3 rule). Multiple `project:*`-keyed
contributors add siblings under it — the file tree, References, Package Managers.
Each returns nodes; provider-owned branches begin one level down (folders,
References, Connections):

```ts
// One of several project contributors — the project's file tree. Keyed to the
// family; branches on the instance's type if it needs to.
class ProjectFilesContributor implements IHierarchyContributor {
    readonly ParentKeys = [NodeKey.Project]      // 'project' — all project types
    Contribute(parent: HierarchyNode): HierarchyContribution {
        const member = parent.ExtObject as SolutionMember   // member.Ref.type available for branching
        // top-level entries as keyed nodes; each folder is provider-owned below
        return new NodeContribution(member.Project.Content.TopLevel())
    }
}
```

**Two distinct project keys — do not conflate:**
- **Project type id** (`'architecture'`, `TODL_PACKAGE_TYPE`) — engine level; in the
  manifest; drives `factoryFor(typeId)`; the factory physically creates/opens/saves on
  disk. Discrete, owned by the defining module. **Unchanged.**
- **Node key** (`NodeKey.Project` = `'project'`) — presentation level; coarse family for
  contributor matching; the type is read from the instance (`member.Ref.type`), not the key.

Other notes:
- The `CreateHierarchy` verb is **removed** from the factory (presentation is a contributor).
- **DI for shared collaborators; `ExtObject` for the specific engine instance.**
- A **default file-tree contributor** registered for `NodeKey.Project` covers project
  types that ship no richer presentation.

## 6. Reactivity — realize = subscribe (the load-bearing correction)

The tree never pulls a one-shot list. It **subscribes** to a reactive child
collection and renders deltas. The *first* deltas are the async initial load;
*later* deltas are external changes — **one channel, both cases.**

Files live in a **reactive, lazily-loaded, disk-watched engine content store**
(per project), owned by the engine (uses `IStorage` + a watcher internally). Not
eagerly in `SolutionModel`.

```ts
abstract class HierarchyChange {}
class ChildAdded   extends HierarchyChange { constructor(readonly node: HierarchyNode)  { super() } }
class ChildRemoved extends HierarchyChange { constructor(readonly id: HierarchyItemId)  { super() } }
class ChildUpdated extends HierarchyChange { constructor(readonly id: HierarchyItemId)  { super() } } // caption/icon changed

interface IHierarchyProvider {
    ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): IDisposable
}
```

- `HierarchyModel.RealizeChildren(node)` = `provider.ObserveChildren(node.NestedItemId, delta => patch(node.Children, delta))`; collapse disposes the subscription.
- **Async load (weak point 1):** store loads a folder on first observe; results arrive as `ChildAdded` deltas.
- **External rename (weak point 2):** engine watcher → store update → delta on the same channel.
- **Rename identity:** handles interned by a **stable per-file id** (native file id / store-assigned), not by path → rename is an in-place **`ChildUpdated`** that preserves selection & expansion (VS `OnItemRenamed`). *(OPEN: stable ids in scope for v1, or accept remove+add?)*
- `member.Storage` is retained by the engine at open time (small engine change: today `OpenMembers` drops it); the content store uses it.

## 7. Open decisions

- [ ] Rename identity via stable ids (in-place update) vs remove+add for v1.
- [ ] Contributor registration: imperative bootstrap vs new module DSL block (`.solutionContributors:`).
- [ ] Key namespace: enum/registry of known keys vs free strings.
- [ ] Node↔provider-root mapping is implicit (chosen) vs explicit root child node.

## 8. Cross-hierarchy interaction (package sources → project references)

Scenario: user adds a package source under the solution's **Connections** node, then
sees that source's packages under a **project's References** node.

**Insight: cross-hierarchy interaction needs no tree-to-tree wiring.** Both branches
project the same reactive engine store (`PackageSourceRegistry`); the engine is the
only shared point.

- Engine: `PackageSourceRegistry` (reactive, `Changed` signal) + `PackageResolver`
  (async resolve across sources). Owned at solution scope (OPEN: solution vs global).
- `ConnectionsProvider` (under `connections` node) projects the registry.
- `ReferencesProvider` (under a project's `references` node) depends on the **same
  registry via DI** + the project via `ExtObject`; `ObserveChildren` subscribes to
  `registry.Changed` and re-resolves (async, diffed) on every change.
- Add-source: command handler calls `registry.Add(source)` (UI→engine) → `Changed`
  → **both** providers react independently. If References is already open, the new
  source's packages stream in live; if opened later, the resolve sees the current
  source set. Works in both orderings.

Invariants confirmed: cross-hierarchy = shared reactive engine state; providers may
depend on engine state beyond their node (via DI); writes flow UI→engine→deltas;
async network resolution is just more deltas.

## 9. Mutation from our app (new / rename / delete / move)

Writes flow **UI → engine store → deltas back**; the tree never touches storage.

- New: `store.CreateFile(parent, name)` → `ChildAdded` → select + inline edit.
- Rename: commit → `store.Rename(id, name)` → `ChildUpdated` (stable id) → in place.
- Delete: confirm → `store.Delete(id)` → `ChildRemoved`.
- Move/drag-drop: `store.Move(ids, dest)` → `ChildRemoved` + `ChildAdded`.

Decisions: (1) **authoritative, not optimistic** — tree waits for the delta;
(2) **editing state is UI-only** (`IsEditing` on the item, never engine);
(3) **drop validation is a provider capability** — providers gain `CanAccept(drop)`.

## 10. Commands & context-menu routing (IVsUIHierarchy analog)

Node actions = **owner-supplied base + keyed-contributor additions** (symmetric with
children). A provider supplies base actions for its own nodes; keyed action
contributors (generalized `INodeCommandContributor`/`IProjectMenuSource`) add actions
by node `Key`. Routing: the action runs with the selected node as context; the handler
calls the engine. `OwnerOf(node)` = the provider/engine owner backing the node.
Enablement over a selection = per-node `CanExecute` (mixed selection → valid-for-all
or anchor).

## 11. Selection across the mixed tree

**One global selection surface** owned by SolutionExplorer (set of items + anchor),
spanning keyed and provider nodes uniformly. Stable interned ids make selection
survive deltas: rename = `ChildUpdated` (stays selected), delete = drop from set,
async load doesn't disturb it. Anchor drives command context / inspector / editor.
**Hard-requires stable ids** (§6).

## 12. Persistence of expand/selection

Persist canonical names of expanded+selected nodes as **UI/workspace state keyed by
solution id** (never engine). Reopen restores **reactively**: hold the saved set,
expand/select nodes as they materialize via deltas (async restore). Reveal-in-tree
uses the same primitive (`ParseCanonicalName` → expand ancestors → select, crossing
boundaries by delegation). Decision: **both regimes produce canonical names** — provider
nodes implement `Get/ParseCanonicalName`; HierarchyModel composes them for keyed nodes.

## 13. New contracts surfaced (small)

- `CanAccept(drop): boolean` on providers (drop-target validation).
- Action-contributor seam keyed by node `Key` (generalizes existing seams).
- Canonical naming on the keyed layer (HierarchyModel), not just providers.

## 14. Unresolved members — decorated node + delete

Unresolved = type has no registered factory (`UnknownType`) or `openProject` failed
(`LoadFailed`). Engine tolerates it (no throw) and records why.

- **Engine:** `SolutionMember` gains `Status` enum (`Resolved`/`UnknownType`/`LoadFailed`)
  + `Error`. `OpenMembers` sets it (no factory → UnknownType; open throws → catch → LoadFailed).
- **Tree:** projects-listing contributor still emits the node, stamps `Severity`+`Error`
  from the member; unresolved node is a **leaf** (`IsExpandable=false`) rendered via an
  **error template** (icon overlay + reason tooltip). `HierarchyNode` carries `Severity`/`Error`.
- **Delete = model mutation, not disk delete:** "Remove from Solution" node action →
  `SolutionManager.RemoveMember(member)` → `Members` change → re-contribute → `ChildRemoved`.
  Edits the manifest, never the member's files.
- Deferred: "Reload" action (retry `openProject`); optional Problems diagnostic (second surface).

## 15. Registration — DSL block + runtime (both)

One registry, two feeds (mirrors `ProjectFactoryRegistry`):

- **Declarative:** new `.hierarchyContributors:` module block + `HierarchyContributorDefinition
  [ ParentKey, Contributor, Order ]` → adds `ShellModule.HierarchyContributors` +
  `HierarchyContributorRegistry.PopulateFromModules()` (indexes by ParentKey).
- **Runtime:** `HierarchyContributorRegistry.Register(def): IDisposable` + `Changed: ISignal`.
  A runtime registration keyed to an already-expanded node triggers re-contribution → **live**.

## 16. Layer placement (framework impact)

- **mural/framework** (shared presentation infra, alongside `Capability`/`ProjectFactoryRegistry`):
  `IHierarchyProvider`, `HierarchyNode`, contribution classes, `HierarchyModel`,
  `HierarchyContributorRegistry` + its `HierarchyContributorDefinition` DSL.
- **TODL** (engine): `SolutionManager`, `SolutionModel`, reactive per-project content store,
  `IProjectFactory` (lifecycle), `SolutionMember.Status`.
- **App modules** (plexus/devUI): concrete contributors, providers, the `SolutionExplorer`
  capability service.

This design therefore touches mural/framework (new definition type + ShellModule
collection + registry), not only the apps.

## 17. Key governance (applies repo-wide, not just hierarchy)

**One distinction decides the mechanism:** does the key ever cross a boundary where it
can't be an object — a file, `.mu` markup, or dynamic runtime matching?

| Key family | Crosses boundary? | Mechanism |
|---|---|---|
| DI service tokens (`X.Key`) | No | **`ServiceKey<T>` object token** (unchanged, well-governed) |
| Node/element keys, contributor `ParentKey` | Yes (dynamic match + DSL) | named string contract |
| Project type ids (`TODL_PACKAGE_TYPE`) | Yes (manifest + `factoryFor`) | named string contract |
| Command ids, setting keys | Yes (verbatim in `.mu`) | named string contract |
| Icon/resource keys (`@ToolBox`) | Yes (markup) | resource dictionary key (existing) |

Tokens need no change. All rules below govern **string contracts** (generalizing the
existing `TODL_PACKAGE_TYPE` / `DiagramCommandId` / `DiagramSettingKey` patterns).

**Define — owner class (DECIDED).** Each string-key domain has ONE owner class with
static members for closed keys + factory methods for parameterized ones. Never a bare
literal at a use site.
```ts
class NodeKey {
    static readonly Solution    = 'solution'
    static readonly Project     = 'project'        // coarse family; type lives on the instance
    static readonly Connections = 'connections'
    static readonly References  = 'references'
    // Factory methods remain the pattern for any GENUINELY parameterized key that still
    // needs one; node keys no longer are (families + decide-in-call removed that need).
}
```

**Node keys vs project type ids are separate string-contract domains** (different owners,
different layers): node keys (`NodeKey`, presentation) classify tree nodes coarsely;
project type ids (`TODL_PACKAGE_TYPE` etc., engine) select factories and appear in
manifests. Both follow the §17 rules, but a `project` node key ≠ an `'architecture'` type id.

**Where.** Owned by the module that defines the concept, colocated with its definition
(as `TODL_PACKAGE_TYPE` sits on its factory), re-exported from the module index. One
owner per key; no downstream re-declaration.

**Publish — two channels by reach.**
- In-repo cross-module: export the owner-class symbol; consumers import it.
- Cross-published-package at runtime (keys living in shipped data — manifest `type`,
  presentation keys): also a documented **manifest/schema** field.

**Consume.** Import the owner symbol; match by symbol (`node.Key === NodeKey.Connections`),
never literal. In `.mu` (DSL forces a literal), the literal must equal the constant's
value — validated at compose (the "markup-string ↔ code-constant" contract the diagram
settings test already asserts).

**Namespace governance — BOTH (DECIDED).**
- Convention: owner-prefixed keys (`diagram.*`, `arch.*`, `project:<type>`).
- A central **`KEY-NAMESPACES.md`** allocation doc records which prefix each module owns.
- The registry's `PopulateFromModules()` **collision-checks** all contributed keys and
  throws on a duplicate at compose.

## 18. Status

Model complete across §1–17. Ready to promote to a `Kind = Spec` Project item
(after a spec self-review pass). Open decisions remaining are the intentional ones in §7.
