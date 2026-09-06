# Architecture Item "Go to Definition" Navigation — Design

**Status:** Approved for planning
**Date:** 2026-09-06

## Goal

Give architecture nodes on a diagram a **Go to Definition ▸** context-menu
submenu that navigates from the selected item to the declaration of:

- **its component** (the node's own entity),
- **its technology / technologies** (`implementedBy`),
- **its category** (`categorisedAs`).

Each target opens either the **open project's `.todl` source** (when the
entity is declared locally) or is **revealed as a node in the Libraries
panel** (when it comes from a published library) — the same
published-vs-project provenance fork the Wiki flow already uses.

## Decisions (locked during brainstorming)

1. **Destination = the model declaration now; external code later.**
   "Source code" means the `.todl` declaration of the entity (IDE-style go
   to definition within the architecture model). Navigating to an external
   implementation (repo/file) is deferred until entities carry a
   code-location attribute — explicitly out of scope here.
2. **Published entities reveal in the Libraries panel** (expand the tree to
   the term, select it, scroll into view) — not a read-only definition tab.
3. **"Go to technology" targets `implementedBy`** (a list). Exactly one →
   navigate directly; several → a nested submenu listing each technology by
   name. `hostedIn` is ignored.
4. **All arch nodes carry the menu, adaptively.** Only relations that
   resolve are shown: a component node shows component / technology /
   category; a technology node shows technology (itself) + category; a
   category node shows category (itself). Non-resolving entries are hidden.

## Background: what already exists

- **Provenance.** `ArchModel.wikiOriginOf(concept)` returns a `WikiOrigin`
  that is either a **published-package** origin or
  `openProjectOrigin(storage)` (the local project). A resolvable-but-untagged
  concept was declared by the project's own source. This is the fork the
  navigation reuses.
- **Own-entity source file.** `ArchModel.homeOf(id)` returns the `.todl` uri
  an own entity round-trips to.
- **Relations.** The repo entity carries the refs. The typed VMs
  (`Component.implementedBy: Technology[]`, `Component.cat` via
  `categorisedAs`, `hostedIn`) live in
  `arch-view-models.ts`; navigation reads the same refs off
  `ArchModel.repository()`.
- **Libraries panel** (`LibrariesPanelService`) is a `TreeView`:
  `Roots: ObservableCollection<LibraryTreeNode>`, a settable `SelectedNode`,
  and leaves carrying `TermId` + `Concept`. Structure: library → concept
  group → class leaf.
- **Open a project file.** `ProjectExplorerService.OpenFileInProject(projectId,
  relpath, line, col)` opens a file in a Monaco tab and reveals a position;
  the cross-file `todl://` opener resolves a target uri to (project, relpath).
- **Arch node context menu.** `DataTemplate[ArchNodeVM]` in
  `diagram.resources.mu` uses the shared `@DiagramContextMenu` plus a
  node-only "Open Wiki". The `ArchNodeVM` exposes `EntityId` / `Concept`, and
  `arch-diagram-binding` already holds the node's `ArchModel`.

## Architecture

Three units with clear boundaries:

### 1. `ArchNavigationService` (root-scoped service)

The resolve-and-route brain. No view state.

**Resolution** — given an entity id + the `ArchModel`, produce the target
sets off `repository()`:

- `resolveComponent(entityId)` → the entity itself, only when its concept is
  (a subtype of) `component`.
- `resolveTechnologies(entityId)` → the `implementedBy` referents (ordered).
- `resolveCategory(entityId)` → the `categorisedAs` referent; if absent on a
  component, fall back to the **first** technology's `categorisedAs`. A
  technology node resolves its own `categorisedAs`.

Each resolved target is `{ entityId, concept, label }`.

**Routing** — `navigateTo(target, model)`:

- **Own-project entity** (`wikiOriginOf` is the open-project origin, or
  `homeOf(id)` is defined) → resolve `homeOf(id)` to (project, relpath) and
  call `OpenFileInProject`, revealing the declaration line. The line is found
  by searching the opened `.todl` text for the entity's declaration (the
  entity id / `<concept> <id>` token). A precise LSP definition range is a
  possible later refinement, not required.
- **Published entity** → `LibrariesPanelService.RevealTerm(termId)` (below).

The service resolves `ProjectExplorerService`, `LibrariesPanelService`,
`NavigationService`, and (via the bound document) the active `ArchModel`
lazily.

### 2. `LibrariesPanelService.RevealTerm(termId)`

Reveal a published term as a node:

1. Activate the Libraries capability so its panel is the visible side pane
   (via `NavigationService`).
2. Walk `Roots` to find the leaf whose `TermId === termId`.
3. Expand its ancestor chain (`LibraryTreeNode.IsExpanded = true` on
   library + concept group — add `IsExpanded` to `LibraryTreeNode` if absent).
4. Set `SelectedNode` to the leaf and bring it into view (TreeView
   scroll-into-view of the selected item).

No-op with a status message when the term isn't found in any loaded library.

### 3. `ArchNodeVM` navigation facet + menu

`ArchNodeVM` exposes the resolved, bindable targets so the menu is adaptive
and thin:

- `CanGoToComponent: bool` + `GoToComponentCommand`
- `Technologies: ObservableCollection<{ Name, GoCommand }>` (drives the
  single-or-submenu shape) + `HasTechnologies` / `HasManyTechnologies`
- `CanGoToCategory: bool` + `GoToCategoryCommand`

These are populated by `arch-diagram-binding` when it binds a node to its
`ArchModel` (it already rescans on model change), computed via
`ArchNavigationService`'s resolve methods. The commands delegate to
`ArchNavigationService.navigateTo`.

The `Go to Definition ▸` submenu is added to the arch node's context menu in
`diagram.resources.mu`. Item visibility binds to the `Can*/Has*` flags; the
technology entry renders as a single item when `HasManyTechnologies` is false
and as a nested submenu (`ItemsSource = $Technologies`) when true.

## Data flow

1. User right-clicks an arch node → context menu bound to the `ArchNodeVM`.
2. Menu items read the node's precomputed `Can*/Has*/Technologies` targets
   (computed at bind/rescan time).
3. Firing a command calls `ArchNavigationService.navigateTo(target, model)`.
4. The service checks provenance: own → `OpenFileInProject` + reveal line;
   published → `LibrariesPanelService.RevealTerm`.

## Error handling

- Unresolved relation → entry hidden (adaptive menu), never a dead command.
- Published term not present in any loaded library → `RevealTerm` sets a
  status message; no throw.
- Own entity with no `homeOf` (shouldn't happen for own instances) →
  status message, no navigation.
- No bound `ArchModel` (non-arch diagram) → the node isn't an `ArchNodeVM`,
  so the submenu never appears.

## Files

- **Create:** `modules/architecture-projects/services/arch-navigation-service.ts`
  (+ `tests/arch-navigation-service.test.ts`).
- **Modify:** `modules/library/services/libraries-panel-service.ts`
  (`RevealTerm`), `modules/library/services/library-tree-node.ts`
  (`IsExpanded` if absent) (+ tests).
- **Modify:** `modules/architecture-projects/services/arch-node-vm.ts`
  (nav-target facet) (+ tests).
- **Modify:** `modules/architecture-projects/services/arch-diagram-binding*.ts`
  (populate targets on bind/rescan).
- **Modify:** `modules/diagram/diagram.resources.mu` (the submenu).
- **Modify:** `app.mu` `.services:` (register `ArchNavigationService`).

## Testing

- **Unit — resolver:** off a composed model, `resolveComponent` /
  `resolveTechnologies` (ordered, multiple) / `resolveCategory` (direct, and
  the technology fallback); adaptive rules per concept (component vs
  technology vs category node).
- **Unit — provenance fork:** with a fake model + fakes for
  `ProjectExplorerService` / `LibrariesPanelService`, assert an own entity
  routes to `OpenFileInProject` and a published entity routes to
  `RevealTerm`.
- **Unit — `RevealTerm`:** finds the leaf by `TermId`, expands the ancestor
  chain, sets `SelectedNode`; no-op + status when absent.
- **e2e:** open the architecture test project, right-click a component node,
  assert the `Go to Definition` submenu exposes the expected entries and that
  firing each triggers the corresponding navigation (file opened / library
  term revealed).

## Out of scope

- External code-location navigation for a component (deferred; needs a
  code/repo attribute on the entity).
- Precise LSP definition ranges for the `.todl` reveal (search-based line
  location is sufficient for v1).
- `hostedIn` navigation.
