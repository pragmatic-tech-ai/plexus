# Spec — Solution Hierarchy (provider/contributor tree for solutions & projects)

> Status: **draft for review**. On approval, promote to a `Kind = Spec` item in the
> GitHub Project *Architecture Agentic Suite* (org `pragmatic-tech-ai`, #1). Working
> design notes: `c:\tmp\solution-hierarchy-design.md`.

## 1. Context & problem

Today the solution tree is a single monolithic projection: `SolutionTreeVM`/`SolutionNodeVM`
expand each member straight from `IStorage`, with no shared abstraction. A project type
cannot present its own logical tree (viewpoints, packages, references); there is no stable
node identity; there is no uniform way for one part of the tree to react to another
(e.g. a package source added under the solution surfacing under a project's references);
and file/folder rows are read one-shot, so async loading and external edits are not modelled.

We want a reusable hierarchy abstraction — an analog of the Visual Studio `IVsHierarchy`
family — adapted to our engine/UI split, our reactive model, and a keyed-contribution
extensibility model, so that solutions, projects, and cross-cutting content (connections,
references) compose into one live, extensible tree.

## 2. Goals / Non-goals

**Goals**
- A single hierarchy runtime: providers + keyed contributors + a managed tree model.
- Project types contribute their own subtrees without the framework knowing them.
- Live tree: async lazy load and external file changes both flow as deltas.
- Stable node identity so selection/expansion survive load and rename.
- Cross-hierarchy reactivity with no tree-to-tree coupling (shared engine state only).
- Clean engine/UI split: engine owns data; UI owns the tree projection.
- Uniform key governance across the repo.

**Non-goals (this spec)**
- Reconciling the existing Plexus `ProjectExplorer`/`Project`/`ProjectNode` world — tracked
  as a separate follow-up (§13).
- A concrete file-watcher implementation choice (native vs library) — an engine detail.
- Full drag-and-drop UX polish beyond the drop-target validation contract.

## 3. Glossary

- **SolutionManager** — engine service (TODL, headless): opens/saves/closes solutions;
  owns the reactive `SolutionModel`; publishes it via the observable `ActiveSolution`.
- **SolutionModel** — engine model: members, opened project handles, per-project reactive
  content store. (Today's `Solution`.)
- **SolutionExplorer** — UI capability service: owns the hierarchy; observes
  `ActiveSolution`; creates/disposes the `HierarchyModel`.
- **HierarchyModel** — presentation: owns keyed-node identity, drives the contributor walk,
  realizes children by subscription, patches on deltas.
- **IHierarchyProvider** — owns an opaque subtree; answers `ObserveChildren` and node
  properties; interns its own handles.
- **HierarchyNode** — a rendered node: `Key` (family), `ExtObject` (engine instance),
  `Title`, `IconKey`, `Severity`/`Error`.
- **IHierarchyContributor** — registers for a set of parent keys; returns a contribution
  for a matching node, deciding from the actual node in the call.
- **Contribution** — `NodeContribution` (keyed, open to sibling modules) or
  `ProviderContribution` (opaque, provider-owned branch).

## 4. Architecture

### 4.1 Ownership & dependency direction

| Concern | Owner | Layer |
|---|---|---|
| Open/save/close; reactive `SolutionModel`; per-project content store | SolutionManager | engine (TODL) |
| `IProjectFactory` lifecycle (create/open/save on disk) | engine service | engine (TODL) |
| The hierarchy (nodes, contributor walk, identity, realize/patch) | SolutionExplorer / HierarchyModel | UI |
| Concrete providers & contributors; capability services | app modules | UI |

Dependency points one way: **UI → engine**. The engine holds no hierarchy reference and
never renders; the UI reads/projects and never mutates the model except through engine calls.

### 4.2 Layer placement (framework impact)

- **mural/framework** (shared presentation infra, beside `Capability`/`ProjectFactoryRegistry`):
  `IHierarchyProvider`, `HierarchyNode`, contribution classes, `HierarchyModel`,
  `HierarchyContributorRegistry` + the `.hierarchyContributors:` DSL definition.
- **TODL** (engine): `SolutionManager`, `SolutionModel`, reactive per-project content store,
  `IProjectFactory`, `SolutionMember.Status`.
- **App modules** (plexus/devUI): concrete contributors, providers, `SolutionExplorer`.

This is therefore a framework-level change, not app-only.

## 5. Core contracts

```ts
// Opaque, provider-interned node handle. Sentinels are universal.
abstract class HierarchyItemId { protected constructor() {}
    static readonly Root: HierarchyItemId
    static readonly Nil:  HierarchyItemId
}

interface HierarchyNode {
    readonly Key: string            // coarse family (NodeKey.*)
    readonly Caption: string
    readonly IconKey: string
    readonly ExtObject: unknown     // the engine instance this node represents
    // Node health — drives the error/warning DataTemplate decoration (icon overlay +
    // tooltip) instead of the normal row. Primary use: unresolved members
    // (UnknownType/LoadFailed → Error). General enough for any node that carries a
    // diagnostic later (a file with problems, a project that failed to build).
    readonly Severity: NodeSeverity
    readonly Error?: string          // reason shown in the decoration tooltip when not Ok
}

enum NodeSeverity { Ok, Warning, Error }

// Change deltas — one channel for async load AND external edits.
abstract class HierarchyChange {}
class ChildAdded   extends HierarchyChange { constructor(readonly node: HierarchyNode) { super() } }
class ChildRemoved extends HierarchyChange { constructor(readonly id: HierarchyItemId) { super() } }
class ChildUpdated extends HierarchyChange { constructor(readonly id: HierarchyItemId) { super() } }

interface IHierarchyProvider {
    readonly ProviderId: string
    ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): IDisposable
    GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown
    GetCanonicalName(id: HierarchyItemId): string
    ParseCanonicalName(name: string): HierarchyItemId          // Nil if not found
    CanAccept(target: HierarchyItemId, drop: DropData): boolean // drop-target validation
}

enum HierarchyPropertyId { Caption, IconKey, IsExpandable, CanonicalName, ExtObject, Severity }

abstract class HierarchyContribution {}
class NodeContribution     extends HierarchyContribution { constructor(readonly Nodes: readonly HierarchyNode[]) { super() } }
class ProviderContribution extends HierarchyContribution { constructor(readonly Provider: IHierarchyProvider) { super() } }

interface IHierarchyContributor {
    readonly ParentKeys: readonly string[]     // registers under each; may serve several
    readonly Order: number
    Contribute(parent: HierarchyNode): HierarchyContribution   // decides from parent.Key / parent.ExtObject
}
```

## 6. Composition model

- **Keyed vs opaque (decision rule).** `NodeContribution` where sibling modules must
  coexist (solution, project nodes — stay open). `ProviderContribution` where a branch is
  one owner's private subtree (a folder's files, References, Connections — closed to keyed
  extension). A provider is always delivered *by* a contributor.
- **Node keys are coarse families.** `NodeKey.Project = 'project'` for all project types;
  the type lives on the instance (`member.Ref.type`) and is read in the call. Contributors
  register for families and branch in-call, which handles the open set of project types.
- **Two distinct project keys (do not conflate).** *Type id* (`'architecture'`,
  `TODL_PACKAGE_TYPE`) — engine, manifest, drives `factoryFor`, factory creates on disk.
  *Node key* (`NodeKey.Project`) — presentation, family, contributor matching.
- **Project node stays open.** Provider-owned branches begin one level down (folders,
  References, Connections), so other modules can add siblings (References, Package Managers)
  under a project.
- **Identity ownership.** HierarchyModel mints/interns identity for keyed nodes; providers
  intern identity within their opaque branches. The boundary is a `ProviderContribution`.

## 7. Reactivity

- **Realize = subscribe.** `HierarchyModel.RealizeChildren(node)` subscribes via
  `ObserveChildren`; initial contents arrive as `ChildAdded` deltas, exactly like later
  external changes. Collapse disposes the subscription.
- **Engine content store.** Files live in a reactive, lazily-loaded, disk-watched per-project
  store (engine). Async initial load = first deltas; a third-party rename = watcher delta.
- **Stable ids.** Handles interned by a stable per-file id (native file id where available,
  else store-assigned), not by path — so rename is an in-place `ChildUpdated` that preserves
  selection and expansion; delete is `ChildRemoved`.
- **Subscription levels.** `ActiveSolution` (whole-solution swap) → rebuild; `Members`
  (add/remove) → incremental re-contribution; per-node child subscriptions → content deltas.

## 8. Data flows

- **Open solution.** `OpenSolution` builds `SolutionModel`, sets `ActiveSolution` →
  SolutionExplorer disposes old `HierarchyModel`, builds a new one, seeds root node
  `{ Key: NodeKey.Solution, ExtObject: model }`.
- **Expand project → files.** contributor(`NodeKey.Project`) returns file nodes / a
  `ProviderContribution` per folder → provider `ObserveChildren` → engine store lazily
  lists + watches → deltas → rows appear.
- **Mutation (new/rename/delete/move).** UI command → engine store method →
  delta back. Authoritative (no optimistic tree mutation). Editing state is UI-only.
- **Cross-hierarchy (source → references).** "Add Package Source" → engine
  `PackageSourceRegistry.Add` → `Changed` → both `ConnectionsProvider` and
  `ReferencesProvider` (each subscribed; DI to the same store) react independently. No
  tree-to-tree wiring.
- **Unresolved member.** engine records `SolutionMember.Status`
  (`UnknownType`/`LoadFailed`) → node stamped `Severity=Error` + `Error` → error-template
  leaf → "Remove from Solution" node action → `SolutionManager.RemoveMember` (manifest edit,
  not disk delete).

## 9. Commands, selection, persistence

- **Commands.** Node actions = owner-supplied base (provider/HierarchyModel) + keyed action
  contributors (generalized `INodeCommandContributor`/`IProjectMenuSource`). A command runs
  with the selected node as context; the handler calls the engine. Enablement over a
  selection = per-node `CanExecute`.
- **Selection.** One global selection surface (set + anchor) owned by SolutionExplorer,
  spanning keyed and provider nodes. Stable ids keep selection across deltas.
- **Persistence.** Canonical names of expanded/selected nodes stored as UI/workspace state
  keyed by solution id (never engine). Restore is reactive — match against streaming deltas.
  Reveal-in-tree uses `ParseCanonicalName` → expand ancestors → select. Both regimes produce
  canonical names (providers implement it; HierarchyModel composes for keyed nodes).

## 10. Registration & key governance

- **Registration — both channels.** Declarative `.hierarchyContributors:` module block
  (`HierarchyContributorDefinition [ ParentKeys, Contributor, Order ]`) →
  `HierarchyContributorRegistry.PopulateFromModules()`; plus runtime
  `Register(def): IDisposable` with a `Changed` signal (a runtime registration keyed to an
  already-expanded node re-contributes → live).
- **Key governance (repo-wide; see companion spec).** Object-identity tokens (`ServiceKey<T>`)
  vs string-identity contracts (node keys, type ids, command/setting keys). Each string-key
  domain has one **owner class** (static members + factory methods only for genuinely
  parameterized keys), colocated with its concept, owner-prefixed namespace. Governance =
  a `KEY-NAMESPACES.md` allocation doc **and** compose-time collision checks in
  `PopulateFromModules`. Recommended as its own `Kind = Spec` item, referenced here.

## 11. Phasing

> **Prerequisite (gates all phases below).** The **solution engine services**
> (`SolutionManager`, `SolutionModel`/`Solution`, `SolutionMember`, `IProjectFactory`,
> settings/session) must reach **production-ready** first — this hierarchy work builds
> directly on them (P1/P2 assume a stable engine). Finishing the engine is tracked as
> its own effort and is not in scope of this spec. Hierarchy implementation starts only
> once that is done.

- **P0 — framework primitives (mural).** `HierarchyNode`, `IHierarchyProvider`, contribution
  classes, `HierarchyModel`, `HierarchyContributorRegistry` + DSL + `PopulateFromModules` +
  collision check; `NodeKey` pattern; key-governance conventions + `KEY-NAMESPACES.md`.
  Unit-tested with fakes; no consumers.
- **P1 — engine (TODL).** `SolutionMember.Status` + retained `Storage`; reactive per-project
  content store (lazy, watched, stable ids); confirm `ActiveSolution` publication.
- **P2 — SolutionExplorer + basic tree.** Capability service owns `HierarchyModel`, observes
  `ActiveSolution`, seeds root; projects-listing contributor (solution → members); default
  file-tree contributor (project family). Realize=subscribe against the content store.
- **P3 — mutation.** New/rename/delete/move via the engine store; `CanAccept` drop validation.
- **P4 — commands & selection.** Owner-base + keyed action contributors; global selection.
- **P5 — cross-hierarchy content.** `PackageSourceRegistry` (engine) + `ConnectionsProvider`
  + `ReferencesProvider` + resolver; Connections/References contributors.
- **P6 — persistence & errors.** Canonical-name persistence + reactive restore; unresolved-
  member decoration + remove.

## 12. Testing strategy

- Engine (TODL, `tests/` subfolders): content store lazy load + watcher deltas + stable-id
  rename; `SolutionMember.Status` transitions; `PackageResolver` across sources.
- Framework (mural): `HierarchyModel` realize=subscribe + patch on each delta type; keyed vs
  provider contribution routing; contributor registry indexing + runtime `Changed`
  re-contribution; collision-check throws on duplicate; markup-literal ↔ constant validation.
- App: projects-listing + file-tree contributors; cross-hierarchy live update in both
  orderings; selection stability across rename; canonical-name reveal/restore.

## 13. Risks & follow-ups

- **Overlap with existing `ProjectExplorer`/`Project`/`ProjectNode`.** This design was
  greenfield; reconciliation is a separate follow-up (own backlog item). Until then the two
  models coexist.
- **Framework blast radius.** New definition type + `ShellModule` collection + registry
  touch mural/framework; both apps depend on it.
- **Stable file ids across platforms.** Native file id availability differs; fallback is a
  store-assigned identity carried across watcher rename events.
- **Watcher reliability.** Debounce/coalesce; a manual refresh as backstop.
- **Contribution cost.** Many contributors per node + re-contribution on runtime
  registration; keep contributions cheap, cache resolved contributions per node.

## 14. Open decisions (intentional)

- Rename identity via stable ids (in-place update) — assumed **in scope**; confirm.
- Scope of `PackageSourceRegistry` — per-solution vs global.
- Node↔provider-root mapping implicit (chosen) vs explicit root child node.
- "References" semantics — browsable available vs declared dependencies (both may coexist).
