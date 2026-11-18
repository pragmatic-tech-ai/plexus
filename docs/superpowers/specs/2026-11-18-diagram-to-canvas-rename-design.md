# Diagram → Canvas Rename — Design

**Status:** awaiting approval
**Author:** (brainstormed 2026-11-18)
**Kind:** Spec (to be registered in GitHub Project #1 per repo CLAUDE.md on approval)

## Intent and why

The node-and-connector editing surface is called a *diagram* throughout the
product and the `mural` framework. The owner wants it called a **canvas** —
end to end, including type names and the on-disk file extension — because
"canvas" better names what the surface is (a live drawing space), and because
an upcoming feature (a read-only **graph viewer** that renders an environment
graph's nodes/edges onto this surface) reads more naturally as "open the graph
on a canvas" than "...on a diagram."

This design covers **only the rename**. The graph viewer is a separate project,
brainstormed after this lands; the owner chose to do the rename first so the
viewer is built on the renamed vocabulary.

## Goals

- Every **user-facing** occurrence of "Diagram" becomes "Canvas": module name,
  tab/document title, the "New Diagram" command, settings category and labels,
  menu items, icons' display names.
- Every first-party **TS identifier** containing `Diagram`/`diagram` is renamed
  to the `Canvas` equivalent, across `fresco`, `mural`, `TODL`, and `Plexus`
  (full list in the plan; authoritative inventory already gathered).
- The one user-facing `Diagram` string in **fresco** (`'Diagram (native)'`, the
  `CardinalSideRouter.Name` connector-routing label) is renamed so no visible
  "Diagram" survives anywhere.
- File and folder names are renamed (`mural/src/framework/diagram/` → `.../canvas/`,
  `diagram-document.ts` → `canvas-document.ts`, etc.).
- The **wire strings** are renamed too (the owner chose "full rename incl.
  types/extension"): `diagram.*` command ids → `canvas.*`; `diagram.*` setting
  keys → `canvas.*`; the `"diagram"` document **Type** → `"canvas"`; the
  `.diagram` file **extension** → `.canvas`; the `ServiceKey` identity strings
  and the `HistoryLayerId.Diagram = 'diagram'` layer id.
- **No user data is lost.** Existing `.diagram` files keep opening; existing
  `diagram.*` persisted settings keep applying.
- The tree stays green (build + tests) at the end; the e2e/unit fixtures that
  reference `.diagram` / `diagram.*` are updated.

## Non-goals

- **The graph viewer** — separate follow-on project. This design does not add any
  viewing/rendering capability; it only renames.
- **The Rust mural port** (`pragmatic-ai-platform`). It is mid-port and in another
  agent's lane. This rename is TS-only; the Rust port is flagged to mirror the
  vocabulary separately. (Doing both now means doing it twice or desyncing.)
- **Behavior changes.** Zero functional change. A renamed thing behaves
  identically; a reviewer diff should be pure rename + back-compat shims.
- **`.archdiagram`** is not renamed. It is a legacy/parallel architecture-diagram
  extension already read as the Diagram kind; it stays readable (back-compat) but
  is out of the canonical rename. New files are `.canvas`.

## Anti-goals (would make this a failure even if it "works")

- Orphaning a user's saved `.diagram` files or their persisted `diagram.*`
  settings. Either one silently losing work is a failure.
- A half-rename where `Diagram` and `Canvas` identifiers coexist permanently in
  first-party code (the owner rejected the aliased-migration approach; coexistence
  is only allowed transiently *within* the sweep, never as the end state).
- Leaving the wire-string contracts inconsistent between `mural` (the enum values)
  and `Plexus` (the `.mu` literal strings that must match them), which would break
  command routing or settings at runtime.

## Constraints

- **Propagation is publish-per-phase, not local dist.** Correction to an earlier
  assumption: Plexus consumes **mural** and **fresco** as *published* GitHub
  Packages (pinned `^0.66.2`), not local `dist` — only **TODL** is a live Windows
  junction. So a framework rename does NOT reach Plexus by "rebuild dist": each
  framework repo is **version-bumped and published** as its phase finishes, then
  the next consumer reinstalls. Order (lowest layer first): **fresco → mural →
  Plexus**, with **TODL** renamed independently (it's the engine; it does not
  import mural/fresco, and Plexus sees it live via the junction).
- **Each publish is a gated step.** Publishing is stronger than pushing; the
  owner chose publish-per-phase, so every `fresco`/`mural` publish during
  execution pauses for explicit approval. The plan marks these as stop points.
- Lower layers must not import upward (fresco ⊄ mural ⊄ plexus).
- **OOP / Allman / no-inline-literals / PascalCase** house rules apply to any new
  back-compat code (the legacy-key reader, the multi-extension list). `.mu` labels
  stay inline (the no-inline rule is TS-only).
- **Tests live in `tests/` subfolders**; renamed test files keep that.
- **Generated files** (`*.mu.js`, `*.generated.ts`) keep their generator's style;
  they regenerate from the renamed `.mu`/sources rather than being hand-edited.
- Merge locally; **never push without explicit instruction.**

## Approaches considered

1. **Coordinated sweep (big-bang) — CHOSEN.** Rename across fresco → mural → TODL
   → Plexus in one effort; each framework repo is version-bumped and **published**
   as its phase completes (a gated step), then the consumer reinstalls. The tree
   is red mid-sweep and green at the end of each phase. Feasible because the
   consumer set is small and fully in-workspace (no external consumer stuck on an
   old major). Clean end state, no lingering `Diagram` names.
2. **Aliased migration — rejected by owner.** Add `Canvas` names in mural with
   `Diagram` kept as deprecated aliases, migrate consumers incrementally, then
   delete the aliases. Lower risk and reversible, but both names coexist for a
   while and it needs a cleanup phase. The owner wants a clean full rename.

The chosen approach's risk (a large red window) is mitigated by phasing per repo
and by the rename being mechanical: each phase ends green before the next starts.

## The design

### Two renames, one safe and one with contracts

- **Identifier + file/folder + label rename** is mechanical and non-breaking:
  rename symbols and update imports. The authoritative symbol map (every
  `Diagram*` export in mural, the `arch-diagram-*` and `diagram-*` clusters in
  Plexus, the `ProjectNodeKind.Diagram` family in TODL) is carried in the plan.
  One naming trap to resolve by hand, not by sed: `DiagramCanvasService` →
  **`CanvasSurfaceService`** (a naive rename yields `CanvasCanvasService`).
- **Wire-string rename** is a contract change and is done in lockstep across the
  producer (mural enum values) and every consumer (Plexus `.mu` literal strings,
  TODL extension/type maps, e2e fixtures). The string sites are enumerated in the
  plan. Non-persisted wire strings (command ids, `ServiceKey` identity strings,
  the `"diagram"` Type, the history-layer id) are renamed outright — they are
  runtime-only, so lockstep edits are sufficient. The two **persisted** wire
  strings get back-compat (below).

### Back-compat for persisted data (never lose work)

- **File extension `.diagram` → `.canvas`.** The on-disk format carries no
  "diagram" marker (top-level `{version, nodes, visuals, connectors, nextId,
  metadata}`), so an old file's bytes are already valid `.canvas` content — no
  content migration. Mechanism: the canvas `DocumentDefinition.FileExtensions`
  becomes `[".canvas", ".diagram"]` (the registry already loops the array and is
  first-claim-wins); `newFile` writes `.canvas`; the project-tree extension→kind
  maps accept both (mirroring the existing `DiagramExts = ['.archdiagram',
  '.diagram']` precedent, extended to include `.canvas`); the hardcoded
  `GetByExtension('.diagram')` in the headless renderer and the
  `.endsWith('.diagram')` gates (new-file participant, export/arch contributors)
  accept `.canvas` too. Result: old `.diagram` files open and, on next save, are
  written as `.canvas` (re-point on save) — or left in place; the plan picks
  whichever is least surprising and states it. **Open question for the plan:**
  whether opening a legacy `.diagram` silently re-saves it as `.canvas` (migrates
  on touch) or leaves the old file and only writes `.canvas` for new files. Lean:
  leave legacy files as-is, write `.canvas` for new — least surprising, no
  silent disk churn.
- **Settings keys `diagram.*` → `canvas.*`.** These persist in the user's
  `settings.json`. Renaming the keys would orphan a user's saved canvas settings
  (grid, default icon sizes, connector optimizer, …). The per-key read + overlay
  lives in **mural's `ApplicationSettings`** (where the renamed `canvas.*`
  definitions register), but the back-compat is placed **in Plexus's host seam
  `ElectronSettingsStore.Load()`**: it rewrites legacy `diagram.<x>` entries to
  `canvas.<x>` in the loaded snapshot before mural applies the overlay (keeping
  the newer `canvas.<x>` when both exist), and writes `canvas.<x>` going forward.
  Placing it here means the back-compat does not depend on a mural release and
  keeps mural free of legacy-key knowledge. Implemented as a small tested helper
  with one home for the legacy-prefix map.
- **Confirmed safe (no migration needed):** renaming `ProjectNodeKind`'s string
  value `'diagram' → 'canvas'` does not orphan saved projects (node kind is
  recomputed from the file extension on load, never read from a persisted field),
  and the `"diagram"` document **Type** is runtime-only (never serialized into a
  saved document, project manifest, solution file, or session/tab-restore state).

### Scope by repo (and order)

Order follows the dependency layering, lowest first. Each framework repo ends its
phase with a **gated** version-bump + publish; the next phase reinstalls it.

0. **fresco** (`D:\architecture-agent\Fresco`): rename the user-facing
   `'Diagram (native)'` router label (`CardinalSideRouter.Name`), its catalog
   entry in `pipeline-elements-data.ts`, and the asserting test
   (`configuration-loader.test.ts`). Small. Bump + **publish** (gated); mural
   reinstalls it.
1. **mural** (`D:\architecture-agent\Mural`): rename the `framework/diagram/`
   folder → `framework/canvas/`; rename the ~20 source files and all exported
   `Diagram*` identifiers; rename the `.mu` template block `resources Diagrams`
   (which changes the generated `DiagramModule` const) and its keys
   (`DefaultDiagram`, `Style[TargetType=Diagram]`, `DataTemplate[DataType=
   DiagramInspector]`); update `framework/index.ts` re-exports and
   `framework.resources.mu` import; rename the enum **values** (`DiagramCommandId`,
   `DiagramSettingKey`, `HistoryLayerId.Diagram`) and `ServiceKey` strings; update
   mural's own `demo/` consumers and ~40 mural tests. Bump + **publish** (gated);
   Plexus reinstalls the new mural (and fresco).
2. **TODL** (`D:\architecture-agent\TODL`): rename `ProjectNodeKind.Diagram` /
   `ContentNodeKind.Diagram` family and the `displayName: 'Diagram'`; add
   `.canvas` to the extension→kind maps (`architecture-project-factory`,
   `todl-project-factory`, `project-content-store.DiagramExts`) keeping
   `.diagram`/`.archdiagram` for back-compat; update TODL tests + scaffold docs.
   Rebuild TODL `dist`.
3. **Plexus** (`D:\architecture-agent\Plexus`): reinstall the published mural +
   fresco first; then rename the `modules/diagram/`, `modules/diagram-export/`,
   and `architecture-projects/services/arch-diagram-*` clusters (identifiers,
   files, `.mu` module/resources, command/setting Id strings to match mural's
   renamed values); flip the `DocumentDefinition` to `Type="canvas"`,
   `FileExtensions=[".canvas",".diagram"]`; implement the settings legacy-key
   alias in `ElectronSettingsStore.Load()`; update `main.js`, `app.mu`, window
   chrome, `main/index.ts`, and the ~60 e2e/unit fixtures. Rebuild. (Plexus is the
   app — no publish.)
4. **Docs**: `pragmatic-docs/docs/projects/mural/diagram-api-guide.md` and the
   Plexus design/plan docs that cite `DiagramCommandId`/`DiagramSettingKey`.

### What is left to the builder

- The exhaustive identifier → new-name map and the exhaustive wire-string site
  list (both already inventoried; the plan transcribes them as the rename tables).
- The settings legacy-key fallback mechanism's exact shape (after reading the
  settings store), as a small tested helper.
- The migrate-on-open vs leave-legacy decision for `.diagram` files (lean: leave
  legacy, write `.canvas` for new).
- Collision-safe renames (`DiagramCanvasService` → `CanvasSurfaceService`; verify
  no other document type already claims `.canvas`).
- Keeping the two extension-matching strategies in sync (the exact-match
  `ProjectFileFormat.formats` list and the `endsWith` `DiagramExts` list).
