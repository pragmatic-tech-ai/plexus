# P5a — References Branch (Solution Hierarchy) Design

**Status:** Approved for planning (2026-09-30)

**Parent:** `docs/superpowers/specs/2026-09-29-solution-hierarchy-migration-spec.md` (defines P5 — Cross-hierarchy content: References + Connections as tree nodes under projects). P5 is split: **P5a = References branch (this spec)**, then P5b = Connections branch.

## Goal

Surface a project's **declared references** (meta-models, and libraries for architecture projects) as a first-class `References` branch under each resolved project row in the Solution Explorer tree, with **full editing parity** to the existing `Manage References…` modal — add, remove, and re-pin versions — performed **inline in the tree** (no modal round-trip), plus resolution-status decoration the modal does not offer.

## Scope decisions (resolved during brainstorming)

1. **Edit model — declared rows + Add picker** (not an inline checklist, not modal-reuse-for-add). The branch shows one live row per *declared* reference; adding surfaces the *available* set through a context submenu.
2. **Decoration — yes.** Each declared-reference row is decorated resolved-to-published / resolved-to-live-workspace-sibling / unresolved. This is beyond strict modal parity; it is the branch's main value over the modal. Distinct from P6's unresolved-*member* decoration.
3. **Surfacing — composite Project-branches provider** (Approach A). The Project node stays provider-owned; a composite provider emits References as the first child and delegates the file subtree to the existing content provider. Framework and engine untouched; all new code in plexus-core.
4. **References semantics** (a migration-spec open decision) — the branch shows **declared dependencies** (from the manifest); the Add submenu surfaces the **browsable-available** set (published ∪ workspace producers). Both, in their natural places.
5. **`PackageSourceRegistry` scope** (the other migration-spec open decision) — **deferred to P5b.** P5a needs no new engine registry: the available-set comes from the existing `SolutionBaseResolver` (workspace producers) + the existing published catalog. `PackageSourceRegistry` is a Connections/package-source concern.

## Non-goals

- No Connections branch (P5b).
- No new Mural framework API and no new TODL engine API. Reads/writes route through the existing `ProjectExplorerService` over the existing manifest + `SolutionBaseResolver`.
- No change to the shipped *files-directly-under-project* file-tree UX.
- No unresolved-*member* decoration (P6).

## Architecture

### Tree shape

Under each **resolved** project (member) row, `References` is the **first child**, above the file nodes:

```
▸ MyArchitecture                (NodeKey.Project — existing member row)
   ▾ References                 (NodeKey.References — synthetic; present iff member is a resolved references-consumer)
      ▾ Meta-models             (ReferenceNodeKey.Group)
         ● core-meta@1.2.0       (ReferenceNodeKey.Leaf — declared, decorated)
         ⚠ widgets@0.3.0         (ReferenceNodeKey.Leaf — Unresolved)
      ▾ Libraries               (ReferenceNodeKey.Group — architecture only)
         ● ui-lib@2.0.0
   ▾ (files…)                   (existing ProjectContentProvider output, unchanged)
```

- **`NodeKey.References`** — already declared and reserved in Mural's `NodeKey`. The branch root; `IsExpandable = true`; caption `"References"`. The only contributor-relevant key here (it is minted by the composite provider, not contributor-matched).
- **`ReferenceNodeKey`** — a new provider-scoped presentation-family class in plexus-core, colocated with `ReferencesProvider`, mirroring TODL's `ContentNodeKey` (below the provider boundary, never contributor-matched). Members: `Group`, `Leaf`.
- **`Meta-models`** group: always present for a consumer. **`Libraries`** group: present only when the project's factory `offersLibraries` (architecture). A group with zero declared refs still renders (so Add has a home).
- **Leaf** `ExtObject` is a stable identity `{ kind, ref }` (interning key `kind@id` so a version repin updates in place); caption `id@version`; `Severity`/`Error` from decoration.

**Visibility rule** (mirrors the file tree's empty-leaf rule): an unresolved member (no `Storage`) or a non-consumer project shows **no** References node. A resolved consumer with zero declared refs shows `References` → empty groups.

### Providers (plexus-core)

One provider owns the whole Project subtree, so References joins via composition, not a sibling contributor.

**`ProjectBranchesProvider`** — implements `IHierarchyProvider`; one per member; returned by `FileTreeContributor.Contribute(projectNode)` in place of the raw `ProjectContentProvider`. Holds `refs: ReferencesProvider` and `files: ProjectContentProvider` (existing, unchanged).
- `ObserveChildren(id, sink)`:
  - **Project root id** → emit `ChildAdded(ReferencesNode)` first, then forward every delta from `files.ObserveChildren(projectRoot)`. References is always child[0].
  - **id owned by `refs`** (the References node, groups, leaves) → delegate to `refs.ObserveChildren`.
  - **any other id** → delegate to `files.ObserveChildren`.
  - Dispatch: `refs.Owns(id)` (the references provider tracks the ids it minted) selects `refs`, else `files`.
- `GetProperty(id, prop)` → same dispatch (References node's own props from the composite; `refs`-owned from `refs`; else `files`).
- `dispose()` → dispose both sub-providers.

The model's nested-provider rule makes this work with **no framework change**: a child a provider adds is owned by that provider (`owner = entry.provider`), so expanding it re-enters `composite.ObserveChildren(childId)`, which re-dispatches.

**`ReferencesProvider`** — the References-subtree logic; one per member; deps: the mutation seam (annotated read + mutators), `ProjectEvents`, and the resolver's `StaleMemberIds` observable. It owns its own reactivity (like `ProjectContentProvider` owns its chokidar subscription).
- `ObserveChildren(referencesNodeId)` → `ChildAdded` per present group (`Meta-models`; `Libraries` iff `offersLibraries`).
- `ObserveChildren(groupId)` → `ChildAdded` per declared leaf in that group, decorated.
- Tracks minted ids (`Owns(id)`) and leaf identities (delta interning by `kind@id`).

### Reactivity — two signals

`ReferencesProvider` subscribes to two existing signals and re-fetches the annotated view (`ReferencesViewFor`) on each, emitting `ChildUpdated` only for leaves whose rendered facts changed (the model's `displayDiffers` gates churn):

1. **`ProjectEvents.ReferencesChanged`**, filtered to this member's storage — a manifest edit (add / remove / repin) from the tree *or* the modal. Emits `ChildAdded`/`ChildRemoved` for added/removed refs, `ChildUpdated` for a version repin (same `kind@id` identity).
2. **`resolver.StaleMemberIds`** (fires on `Invalidate` when a producer sibling is published/edited) — recompute decoration so an unresolved ref flips to `LiveWorkspace`/`Published` when its producer appears. Any change to the set recomputes this member's view (few refs; self-correcting; no reverse-index bookkeeping).

The composite subscribes to nothing itself; each sub-provider owns its subscriptions and lifetime.

### Edit seam

New methods on `IContentMutations`, implemented by `ProjectExplorerService`. All read/resolve on the `ProjectType` enum. Every mutator shares one extracted private tail, `writeReferences(op, mutate)`:

> read manifest → `mutate(bindings)` → write, preserving every other manifest field → `LiveValidation.RefreshBases(op.Storage)` → set status → raise `ProjectEventKind.ReferencesChanged`.

The existing `manageReferences` modal is refactored to route its confirm through the same tail (one write path).

```ts
export enum ReferenceResolution
{
    Published,
    LiveWorkspace,
    Unresolved,
}

export interface DeclaredReference
{
    readonly Ref: BaseRef
    readonly Resolution: ReferenceResolution
}

export interface MemberReferencesView
{
    readonly OffersLibraries: boolean
    readonly MetaModels: readonly DeclaredReference[]
    readonly Libraries: readonly DeclaredReference[]
}
```

- `ReferencesViewFor(member): Promise<MemberReferencesView | undefined>` — `undefined` when the member is not a references consumer (no References node). Annotates each declared ref with its `ReferenceResolution` (the service owns resolver access, keeping the provider a dumb renderer).
- `AvailableReferencesFor(member, kind: ProjectType): Promise<readonly BaseRef[]>` — published ∪ `resolver.WorkspaceProducers(kind)`, **minus already-declared**, deduped by `id@version`. Feeds the Add submenu.
- `AvailableVersionsFor(member, id: string): Promise<readonly string[]>` — published versions of `id` ∪ the live workspace-producer version if any. Feeds Set Version.
- `AddMemberReference(member, kind: ProjectType, ref: BaseRef): Promise<void>`
- `RemoveMemberReference(member, kind: ProjectType, ref: BaseRef): Promise<void>`
- `SetMemberReferenceVersion(member, kind: ProjectType, id: string, version: string): Promise<void>`

### Decoration semantics

`ReferencesViewFor` computes `ReferenceResolution` for each declared `{ id, version }` of kind `K`:
- **`LiveWorkspace`** — `id` ∈ `WorkspaceProducers(K)` id-set (local-first resolution; an open sibling producer resolves it regardless of published state, even on version drift — matching the resolver's own behavior).
- **`Published`** — not live, but `TryGet({ id, version, kind })` returns a `SourcedPackage`.
- **`Unresolved`** — neither. Covers never-published *and* a version pin that is not published (a mismatch pin fails `TryGet` — the truthful "this pin doesn't resolve").

Refs are few, so per-ref `TryGet` + one `WorkspaceProducers(K)` fetch per kind is cheap and precise (no problem-string parsing).

**Leaf rendering** (provider maps enum → node fields):
- `LiveWorkspace` → `NodeSeverity.Ok`, a distinct live/local `IconKey`.
- `Published` → `NodeSeverity.Ok`, a published `IconKey`.
- `Unresolved` → `NodeSeverity.Warning`, node `Error` = `"Unresolved: not published and no workspace producer"` (same pattern `ProjectsListingContributor` uses for member severity — the existing tree glyph + tooltip render it for free).

### Actions

**`ReferenceActionsContributor`** — new `IHierarchyActionContributor`; `ActionKeys = [NodeKey.References, ReferenceNodeKey.Group, ReferenceNodeKey.Leaf]`; constructed with `IContentMutations`; registered per-solution in `SolutionExplorerService.rebuild()` beside `ProjectActionsContributor`. Actions keyed off `context.Anchor.Key`:

- **References node** → `Add Meta-model ▸` (submenu = `AvailableReferencesFor(member, MetaModel)`), and `Add Library ▸` when `offersLibraries`. Empty submenu → a disabled `(nothing to add)` item.
- **Group node** → `Add ▸` — the available submenu for that group's kind (kind implied by the group).
- **Leaf node** → `Set Version ▸` (submenu = `AvailableVersionsFor`; current version shown checked / `canExecute:false`), and `Remove` (**selection-aware** via `HierarchyActionContext` Anchor + Selection, mirroring file Delete — removing a leaf in a multi-selection removes the whole selection). **No confirm** — a manifest edit is reversible.

Each Add-submenu item calls `AddMemberReference`; each Set-Version item calls `SetMemberReferenceVersion`; Remove calls `RemoveMemberReference`.

**Key-Delete parity:** `SolutionExplorerService.Delete(vm)` dispatches by `vm.Key` — a `ReferenceNodeKey.Leaf` → reference-removal (selection-aware); anything else → `files.DeleteFrom` (unchanged). F2/rename and drag-drop are inert on reference nodes.

**Modal retained:** `Manage References…` stays on the project row (existing `ProjectActionsContributor` action) as a bulk editor / escape hatch; it now shares `writeReferences`, so its write repaints the tree live via `ReferencesChanged`. No duplication on the References node.

### App wiring (plexus-core + markup)

- `FileTreeContributor` (the sole `[NodeKey.Project]` contributor) returns `ProjectBranchesProvider` from `Contribute`. It gains the composite's extra deps (`ProjectEvents`, resolver `StaleMemberIds` observable) alongside the existing `SetMutations`, injected in `rebuild()` where it is already constructed.
- `SolutionExplorerService.rebuild()` registers `ReferenceActionsContributor(this.explorer)` per-solution (same `RegisterInstance` + teardown-disposer pattern as the other action contributors).
- `SolutionExplorerService.Delete(vm)` gains the key dispatch above.
- **Markup:** reference rows reuse `HierarchyItemTemplate` + the existing `ContextActions` `ContextMenu` + recursive `HierarchyActionTemplate` verbatim (`Add ▸` / `Set Version ▸` render for free). Only `IconKeyGlyphs.For` gains cases: `NodeKey.References`, `ReferenceNodeKey.Group`, and the two leaf glyphs (live / published) — themed geometries, placeholder-mapped to an existing glyph where the theme lacks a dedicated one (consistent with the shipped P2 icon placeholder).

## Testing strategy

**No Mural test changes** (framework untouched) and **no TODL test changes** (no engine API added).

**plexus-core unit (vitest):**
- `ReferencesProvider`: groups→leaves deltas; `ReferencesChanged` re-fetch → add/remove/`ChildUpdated`-on-repin; `StaleMemberIds` → `ChildUpdated` only on decoration change; `offersLibraries:false` omits Libraries.
- `ProjectBranchesProvider`: References is child[0]; file deltas forwarded; id dispatch (`refs`-owned vs files); `dispose` disposes both.
- `ProjectExplorerService` reference methods: `ReferencesViewFor` annotates Live/Published/Unresolved via a fake resolver; mutators write the manifest preserving other fields + call `RefreshBases` + raise `ReferencesChanged`; `AvailableReferencesFor` excludes declared + dedupes; `AvailableVersionsFor` merges published + live.
- `ReferenceActionsContributor`: per-key action map; `offersLibraries` gating; empty submenu → disabled; current version → `canExecute:false`; selection-aware Remove.
- `SolutionExplorerService.Delete`: leaf key → `RemoveMemberReference`; else `files.DeleteFrom`.
- `IconKeyGlyphs.For`: new keys map.

**e2e (playwright, `solution-explorer-references.spec.ts`, `PLEXUS_TEST_CORPUS`):** References present as first child under a resolved project with groups; declared refs decorated (a corpus project with an unresolved pin shows the warning glyph); right-click leaf → Set Version / Remove; right-click group → Add ▸ lists available; add → appears; remove → disappears; Delete-key on a selected leaf removes. Reuses P3/P4 e2e helpers (`cloneCorpus`, `seedSession`, `rightClickRow`, expand via click + ArrowRight).

## Review Focus (for the implementation plan)

Input classes / failure modes the design implies that no single happy-path test exercises, most-likely-to-bite first:
1. **Non-consumer project** — a project type that binds no references shows *no* References node at all (`ReferencesViewFor` → `undefined`), not an empty branch.
2. **Library project** — meta-models group only; **no** Libraries group (`offersLibraries:false`), and its result manifest omits `libraries` entirely.
3. **Version-drift pin** — a declared version differs from the live workspace producer's version: resolves `LiveWorkspace` by id (local-first), *not* `Unresolved`; but the same drift against a published-only producer is `Unresolved`.
4. **Concurrent modal + tree edits** — both raise `ReferencesChanged`; the provider re-fetches from disk each time, so the last write wins and the tree matches the manifest (no stale in-memory delta).
5. **Empty available / versions submenus** — Add with nothing addable, and Set Version with only the current version, render a disabled item rather than an empty/crashing menu; and multi-select Remove spanning kinds removes each from its correct manifest list.

## Cross-repo release order (for the plan)

All work is in **plexus-core + apps/plexus** (Mural and TODL untouched). Suggested task order: `ReferenceNodeKey` + `ReferencesProvider` (with fake seam) → `ProjectBranchesProvider` → `IContentMutations` reference methods + `writeReferences` refactor on `ProjectExplorerService` → `ReferenceActionsContributor` → `SolutionExplorerService` wiring + `Delete` dispatch → `IconKeyGlyphs` + markup → e2e.
