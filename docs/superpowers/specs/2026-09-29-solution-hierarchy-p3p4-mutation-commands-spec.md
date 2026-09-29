# Spec — Solution Hierarchy P3+P4: Mutation, Commands & Selection

> Status: **draft for review**. Sub-project of the Solution Hierarchy Migration
> (umbrella: `2026-09-29-solution-hierarchy-migration-spec.md` §4 phases P3+P4).
> Design of record: `2026-09-19-solution-hierarchy-design.md` §9 (mutation), §10
> (commands/context-menu routing), §11 (selection), §13 (new contracts). Builds on
> P2 (`2026-09-29-solution-hierarchy-p2-explorer-spec.md`, IMPLEMENTED + merged).

## 1. What this is

P2 hard-swapped the Plexus left panel to the read-only Solution Explorer over a
`HierarchyModel`, deliberately dropping the old tree's context menu, rename, delete,
new-file, and drag-drop. This sub-project **restores that editing UX on the new model**
and adds the framework contract that makes node actions extensible.

Two umbrella phases are delivered together (user decision, 2026-09-29): **P3 —
Mutation** (new/rename/delete/move via the engine store, `CanAccept` drop validation)
and **P4 — Commands & selection** (the keyed action-contributor seam generalizing
`INodeCommandContributor`/`IProjectMenuSource`, plus one global selection surface). A
right-click menu with Rename/Delete/New spans both, so bundling avoids shipping half a
feature.

**Out of scope (later phases):** "Remove from Solution" for a member row + unresolved
decoration (P6); canonical-name persistence + full reactive reveal-in-tree (P6);
References/Connections as tree nodes (P5); cross-project move/copy. devUI's
`solution-studio` is untouched.

## 2. Global constraints

Workspace CLAUDE.md house style applies verbatim: OOP (no module-level free functions
or state; every function a method/static — the `is<X>` type-guard free-function
precedent is the sole exception); VMs derive from `Observable`, not `MuralBase`; Allman
braces; no inline reused/keyed string literals (hoist to `private static readonly`
PascalCase constants); enums over string-literal unions; PascalCase for interfaces +
public methods; tests in `tests/` subfolders. No worktrees (feature branch
`feat/hierarchy-p3p4-mutation-commands` per repo). Latest packages. Attribution:
commits end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PRs end the
Claude Code line. Merge/push to shared branches + publish are norms-gated (ask first);
publishing is deferred (the user's separate step).

Cross-repo release order (per the migration): **Mural → TODL → Plexus**. Local-dev
resolution unchanged: sibling Mural/TODL dists are copied into `Plexus/node_modules`
(with the `development` export condition stripped) and re-copied after each edit +
rebuild; the e2e corpus lives at `architecture-agent/plexus_test_projects` (pass
`PLEXUS_TEST_CORPUS=<that path>`).

## 3. The action seam (mural framework, net-new)

Node actions = **owner-supplied base + keyed-contributor additions by node `Key`**
(design §10), symmetric with node contribution and reusing the P2 registry machinery.

### 3.1 Contracts (`mural/src/framework/hierarchy/`)

- **`HierarchyAction`** — the unit of a context-menu entry:
  - `Label: string`, `IconKey?: string`
  - `Invoke: ICommand` — a no-arg command built from a `run(context)` fn + optional
    `canExecute(context)`. Because `ContextActions` is built lazily when the menu opens,
    the action captures its `HierarchyActionContext` (anchor + the tree's *current*
    `Selection`) at that moment, so the selection snapshot is live. `.mu` binds
    `Command=$Invoke` and gets enablement (`CanExecute` over the captured context —
    valid-for-all across the selection, or anchor-only, is the action's own call) for free.
  - `Children?: ObservableCollection<HierarchyAction>` — a submenu, *observable* so
    dynamic groups (Add New, Run Agent/Skill) render immediately and fill in as the
    contributor populates them (the `$ProjectMenuChoices` async pattern).
  - `IsSeparator: boolean` — a divider marker (its `Invoke`/`Label` unused).
- **`HierarchyActionContext`** — a handler's input: `Anchor: HierarchyItemVM` (the
  right-clicked / focused row) and `Selection: readonly HierarchyItemVM[]`. Each VM
  exposes `Data` (the `ExtObject` — a `SolutionMember` or `ProjectContentNode`), so
  handlers reach the engine object with no new plumbing.
- **`IHierarchyActionContributor`** — `{ readonly ActionKeys: readonly string[];
  ActionsFor(node: HierarchyItemVM): readonly HierarchyAction[] }`. Keyed by the target
  node's own `Key`.
- **`HierarchyActionContributorRegistry`** — a **sibling** of the P2
  `HierarchyContributorRegistry`, built identically: a `.hierarchyActions:` DSL block on
  `ShellModule` + `PopulateFromModules`, `ActionsFor(nodeKey): readonly HierarchyAction[]`
  returning ordered contributions, `Register(def)` (live) and `RegisterInstance(contributor)`
  (per-solution, no token — the P2 pattern). Sibling, not a second index on the node
  registry, keeps each registry single-responsibility.

The "owner-supplied base" falls out because both register the same way: `FileTreeContributor`
registers as the action contributor for file/folder keys, `ProjectActionsContributor` for
the project key, and app modules add contributors for the same keys — all merged in `Order`.

### 3.2 Generic VM changes (`hierarchy-item-vm.ts` / `hierarchy-tree-vm.ts`)

- Replace P2's bare `onActivate` callback with a **`HierarchyHost`** seam the
  `HierarchyTreeVM` owns and passes to every item:
  `Activate(vm)`, `CommitRename(vm, newName)`, `ActionsFor(vm): readonly HierarchyAction[]`,
  `CanDrop(target, dragged): boolean`, `Drop(target, dragged): void`. (Refactors the four
  P2 files that thread `onActivate`.)
- `HierarchyItemVM` gains **UI-only editing state** (design §9.2): `IsEditing`,
  `EditingName`, `BeginEdit()`, `CommitEdit()` (relays `host.CommitRename`; the row still
  updates authoritatively when the store's `ChildUpdated` arrives), `CancelEdit()`. Plus a
  `ContextActions` getter that lazily calls `host.ActionsFor(this)` when the menu opens.
- `HierarchyTreeVM` gains the **global selection surface** (design §11):
  `Selection: ObservableCollection<HierarchyItemVM>` + `Anchor`. Delta-safe: a renamed node
  keeps its VM instance (stays selected); a `ChildRemoved`/dispose prunes the VM from
  `Selection` (wired into item teardown). `Anchor` is what a `HierarchyActionContext` reports.

## 4. Mutation (TODL engine store + provider `CanAccept`)

Writes flow **UI → store → disk → watcher delta → tree** — authoritative, never
optimistic; the same channel external edits use (design §9).

`ProjectContentStore` gains mutation methods keyed by `ContentNodeId`:
- `CreateFile(parentId, name, content?)` → `WriteText(path, content ?? '')`;
  `CreateFolder(parentId, name)` → `CreateDirectory`. Watcher → `ContentAdded` →
  `ChildAdded`; the caller then selects + begins inline edit.
- `Rename(id, newName)` → `IStorage.Rename(oldPath, newPath)`. **No new delta path** —
  P1's settle-window inode reconciliation already turns a disk rename into one
  `ContentUpdated` with the same id, so an app rename round-trips in place like an
  external NTFS rename.
- `Delete(id)` → `IStorage.Delete(path)` (recursive for a folder — confirm
  `NodeFsStorage.Delete` recursion in the plan and add if missing). Watcher →
  `ContentRemoved`.
- `Move(ids, destFolderId)` → `Rename` each into `dest`. Same reconciliation
  (`ChildRemoved`+`ChildAdded`, or `ContentUpdated` if same dir).

**Drop validation** on `ProjectContentProvider.CanAccept(target, drop)` (the P0 slot):
accept only when `target` is a folder in *this* provider and no dragged id is the target
or an ancestor of it. Cross-project drops rejected this phase.

**Import File / Import OS folder** keep their app-side file-picker seam, then call
`store.CreateFile`/`WriteBytes` + `CreateFolder`.

**Deleting a member row** is a model mutation ("Remove from Solution", P6) — that action
is simply absent here; the file/folder Delete is a real disk delete.

## 5. Plexus wiring

### 5.1 Mutation façade + base contributors (plexus-core)

- **`FileTreeContributor` becomes the file mutation façade** (it already owns one
  provider+store per member): it implements `IHierarchyActionContributor` for the content
  keys + project root (Add New per project file-format, New Folder, Import File…, Import
  Folder…, Rename, Delete), and exposes `RenameNode(vm,name)`, `DeleteNode(vm)`,
  `CreateFile/CreateFolder(parentVm,…)`, `MoveNodes(dragged,target)`, `CanDrop(target,
  dragged)` — resolving `store` + `ContentNodeId` from a node — so inline F2 rename (via
  the host) and drag-drop (via the host) route to the same store methods as the menu
  actions. One home for file mutation.
- **`ProjectActionsContributor`** (plexus-core, keyed `NodeKey.Project`): Close, Publish,
  Bump/Set Version, Manage References…, Refresh Bases, Update Agent Metadata — closing over
  the surviving `ProjectExplorerService`, whose `publishProject`/`bumpVersion`/… are
  re-typed to take a `SolutionMember` instead of `OpenProject`. `CanExecute` gates
  producer-only actions.

### 5.2 App-module actions (`.hierarchyActions:` DSL)

Generalize the two retired seams, keyed by node `Key`, stateless (resolve services +
the node's `ExtObject` at `ActionsFor` time):
- skills **Run Agent/Skill** (observable `Children` filled async — the `IProjectMenuSource`
  replacement), keyed `NodeKey.Project`.
- architecture **Edit Viewpoints** (the `INodeCommandContributor` replacement), keyed on
  the arch node key.
- **Export SVG/PPTX** (`DiagramTreeExportKey`), keyed on the diagram/todl key.

### 5.3 Host + registration

`SolutionExplorerService` implements `HierarchyHost`: `Activate` (P2's logic),
`CommitRename`/`CanDrop`/`Drop` (delegate to the `FileTreeContributor` façade),
`ActionsFor(vm)` (`HierarchyActionContributorRegistry.ActionsFor(vm.Key)`). It
`RegisterInstance`s the base action contributors per solution alongside the node
contributors it already wires, and registers `HierarchyActionContributorRegistry` at the
app root (`app.mu` `.services:`), composing the `.hierarchyActions:` from every module.

### 5.4 Panel resources + input behaviors

- `.mu`: a recursive `DataTemplate[HierarchyAction]` (`MenuItem [Header=$Label,
  Command=$Invoke, ItemsControl.ItemsSource=$Children]` + separator variant); the row
  template gains `ContextMenuService.ContextMenu` → a `ContextMenu` with
  `ItemsSource=$ContextActions` + `ItemTemplate=@HierarchyActionTemplate`, and a rename
  slot (caption `TextBlock` hidden while `$IsEditing`; a focus-on-visible `TextBox` bound
  `EditingName` swaps in — the old `RenameEditorTemplate`/`EditingToLabelVisibility`).
- Plexus input behaviors driving `HierarchyHost` (ports of the retired ones, retargeted
  from `OpenProject`): `HierarchySelectionBehavior` (extend/toggle/range → `Selection`/
  `Anchor`), `HierarchyKeyBehavior` (F2→`Anchor.BeginEdit`; Delete→delete-with-close-guard;
  Enter/Escape→commit/cancel), `HierarchyDragDropBehavior` (drag selection; drop→
  `host.CanDrop` tint / `host.Drop`).

### 5.5 `IProjectTreeHost` seam re-homing (umbrella §5 inventory)

- Content **file-watch reload is retired** — the store watches disk and the tree
  self-updates; the whole-project rescan target for content is gone.
- **Cross-file open→reveal** (`ProjectTreeHostKey`, go-to-definition) re-points to
  `SolutionExplorerService` with a *minimal* reveal (open + best-effort select); full
  reactive reveal-in-tree stays P6.
- `LiveValidation`/`RefreshProjects` (base refresh + producer invalidation) are
  `ProjectExplorerService` lifecycle and survive unchanged.

## 6. Testing

Real fixtures where the engine is involved; fast fakes for logic.

- **Mural (unit, fakes):** action registry ordering / `Register` / `RegisterInstance` /
  `.hierarchyActions:` populate + collision behavior; `HierarchyItemVM` editing
  (`BeginEdit`→`IsEditing`; `CommitEdit` relays `host.CommitRename`; `Cancel`);
  `ContextActions` calls `host.ActionsFor`; `HierarchyTreeVM` selection prune on
  `ChildRemoved`; the `HierarchyHost` refactor keeps P2 activate behavior.
- **TODL (FakeStorage + real-fs):** `CreateFile`/`CreateFolder` → `ContentAdded`;
  `Rename` → single `ContentUpdated` same id; `Delete` → `ContentRemoved` (folder
  recursive); `Move` → remove+add; `ProjectContentProvider.CanAccept` (folder target,
  reject onto file / onto self / onto descendant / cross-provider).
- **plexus-core (FakeStorage-backed store):** `FileTreeContributor` façade + actions
  (Add-New per format, Rename/Delete/Create/Move); `ProjectActionsContributor` routes to a
  fake `ProjectExplorerService`, `CanExecute` gates producer actions; `SolutionExplorerService`
  host (`CommitRename`/`CanDrop`/`Drop`/`ActionsFor`).
- **e2e (apps, corpus at `plexus_test_projects`):** right-click a file → Rename → row
  updates; Delete → row gone; New file → appears + inline-edit; drag a file into a folder
  → moves; producer project → Publish present; skills Run submenu populates. Error checks
  are deltas (the app boots with pre-existing environmental `ERR_FILE_NOT_FOUND` misses —
  the smoke spec hits them identically, unrelated to this work).

## 7. Review focus (input classes the spec implies but tests must exercise)

- **Rename collision / invalid name** — `store.Rename` to an existing name or an empty/
  illegal name: the store must reject (or the disk rename fails) without corrupting the id
  map; the row reverts. Pinned in the TODL store tests.
- **Delete of an open document** — the Delete action must run the close-guard *before*
  `store.Delete`, or an open editor is orphaned. Pinned in the plexus-core action test.
- **Drag onto self / into own descendant** — `CanAccept` must reject, or `Move` renames a
  folder under itself. Pinned in the TODL `CanAccept` tests.
- **Selection survives a rename, drops on delete** — a selected row renamed stays selected
  (same VM via `ChildUpdated`); deleted drops from `Selection`. Pinned in the mural tree-VM
  tests.
- **Dynamic submenu that never resolves** — an async `Children` (skills Run) that yields
  nothing must leave a usable (empty/hidden) submenu, not a spinner-forever or a throw.
  Pinned in the app action-contributor test.

## 8. Decomposition into a single plan

One plan, tasks in release order: **Mural** (action contracts + registry + `.hierarchyActions:`
DSL; `HierarchyHost` refactor + VM editing + tree selection) → **TODL** (store mutations +
`CanAccept`) → **plexus-core** (`FileTreeContributor` façade + actions, `ProjectActionsContributor`,
host wiring) → **apps/plexus** (app `.hierarchyActions:` contributors, `.mu` resources, input
behaviors, seam re-homing, e2e). Each layer green + (Mural/TODL) dist re-copied before the
next.
