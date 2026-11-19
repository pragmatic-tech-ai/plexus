# Diagram → Board Rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the node-and-connector surface from "Diagram" to "Board" end-to-end — identifiers, file/folder names, user-facing labels, and wire strings (command ids, setting keys, the `.diagram` extension, the `"diagram"` document type) — across four repos, with zero behavior change and no loss of saved files or settings.

**Architecture:** A layered big-bang sweep, lowest layer first: **fresco → mural → TODL → Plexus**. fresco and mural are consumed by Plexus as *published* GitHub Packages, so each is version-bumped and **published** (a gated stop-point) as its phase finishes; TODL is a live junction (rebuild `dist`). Two persisted surfaces get back-compat shims (the only non-mechanical code): legacy `.diagram` files keep opening (the extension stays in the accepted list; file bytes are already valid `.board`), and legacy `diagram.*` settings keep applying (a `diagram.*→board.*` alias in Plexus's `ElectronSettingsStore.Load()`).

**Tech Stack:** TypeScript (ESM, strict), the `mural` UI framework + `.mu` markup (compiled via `compile:mu`), `fresco` layout engine, `TODL` engine, Electron (electron-vite), vitest + node:test, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-18-diagram-to-canvas-rename-design.md`

> **Term note (post-execution).** This plan was written with the working name
> **Canvas**. During execution "Canvas" collided with mural's existing
> `Canvas extends Panel`; the retries "Surface" (61 identifier collisions) and
> "Pane" (overlapping meaning) also failed, so the landed term is **Board**.
> The text below has been swept Canvas→Board to match what shipped; read any
> remaining "Canvas" as the mural-owned layout type that was deliberately kept
> (e.g. `BoardCanvasService`). Filenames keep their original
> `diagram-to-canvas` stem as a dated historical artifact. **Status: shipped,
> merged to `main`, and published (fresco@0.4.7, mural@0.67.0).**

## Global Constraints

- **Pure rename, zero behavior change.** Every task's diff is rename + back-compat shim only. No logic changes, no "while I'm here" edits.
- **No data loss (anti-goal).** Existing `.diagram` files must still open; existing `diagram.*` settings must still apply. These are verified by tests, not assumed.
- **Layer order + gated publishes.** fresco → mural → (TODL, independent) → Plexus. Each `fresco`/`mural` publish is a **STOP point**: do not publish without explicit owner approval. Plexus reinstalls the published versions before its phase.
- **House rules:** OOP (methods on classes, no free functions / module-global mutable state; module `const` for true constants ok); Allman braces; no inline string literals in `.ts` (hoist to `private static readonly` PascalCase) — applies to the new shim code; `.mu` labels stay inline (no-inline is TS-only). PascalCase interfaces/public methods. Engine never calls up.
- **Tests live in `tests/` subfolders.** Renamed test files keep that.
- **Generated files** (`*.mu.js`, `*.generated.ts`) are regenerated (via `compile:mu` / typings build), never hand-edited.
- **Merge locally; never push/publish without explicit instruction.**
- **Target term is `Board`.** `.archdiagram` is NOT renamed (legacy, stays readable). The Rust mural port is out of scope (flag to mirror separately).

## Review Focus

Inputs the rename could break that no rename-table exercises — each gets a test in the owning task:
- **A legacy `.diagram` file opens** after the rename (extension stays accepted). → Task 7 test.
- **A new document is created as `.board`**, not `.diagram`. → Task 7 test.
- **Persisted `diagram.*` settings still apply** once keys are `board.*` (the alias). → Task 8 (TDD).
- **`board.*` wins when both legacy and new keys exist** (no stale-value regression). → Task 8 (TDD).
- **Command routing survives the wire-string rename** — mural's renamed `BoardCommandId` values match Plexus's `.mu` literal `Id=` strings exactly (a mismatch silently breaks toolbar commands). → Task 6 (build + an e2e that exercises one board command).

---

## Task 1: Fresco — rename the `Diagram (native)` label

**Files:**
- Modify: `D:\architecture-agent\Fresco\src\...\cardinal-side-router.ts` (`CardinalSideRouter.Name`)
- Modify: `D:\architecture-agent\Fresco\src\...\pipeline-elements-data.ts` (catalog entry)
- Test: `D:\architecture-agent\Fresco\src\...\configuration-loader.test.ts` (asserting string)

**Interfaces:**
- Produces: the new router display name (pick `Board (native)`) — a user-facing string only; no API shape change.

- [ ] **Step 1:** Grep fresco for the literal `Diagram (native)` and `'Diagram'` catalog/label occurrences; confirm the three sites above are the complete set.
- [ ] **Step 2:** Rename the label to `Board (native)` at the router + catalog; update the asserting test to expect the new string (this test is the RED→GREEN: it fails on the old assertion vs new value until both are changed together).
- [ ] **Step 3:** Run fresco's suite. Expected: green.
- [ ] **Step 4:** Commit `rename(fresco): 'Diagram (native)' router label → 'Board (native)'`.
- [ ] **Step 5 — GATED PUBLISH:** Stop and request owner approval to version-bump + publish fresco to GitHub Packages. On approval, publish; record the new version.

## Task 2: Mural — rename identifiers, files, folder, `.mu`, enum values

**Files:** (folder) `Mural/src/framework/diagram/` → `Mural/src/framework/board/`; `framework/index.ts` re-exports; `resources/framework.resources.mu` import; mural `demo/` consumers; ~40 mural tests. Authoritative symbol map below.

**Interfaces — Produces (the renamed public API other repos consume):**
- Types/classes: `Diagram→Board`, `IDiagramViewHost→IBoardViewHost`, `DiagramPositionSnap→BoardPositionSnap`, `DiagramDocument→BoardDocument`, `DiagramStorage→BoardStorage`, `DiagramStorageKey→BoardStorageKey` (ServiceKey string `'DiagramStorage'→'BoardStorage'`), `DiagramEditingContext→BoardEditingContext` (ServiceKey `'diagram.editing'→'board.editing'`), `DiagramInspector→BoardInspector`, `DiagramHistory→BoardHistory`, `FileDiagramStorage→FileBoardStorage`, `DiagramMutator→BoardMutator`, `attachStandardDiagramMutations→attachStandardBoardMutations`, `DiagramSelectionSource→BoardSelectionSource`, `DiagramConnectorsMaterializer→BoardConnectorsMaterializer`, `DiagramCommands→BoardCommands`, `DiagramWorkspaceService→BoardWorkspaceService`, `DiagramCameraService/Store/State→BoardCamera…`, `DiagramGuidesService/Store/State→BoardGuides…`, `DiagramSettings→BoardSettings`, `diagramSpaceRect→boardSpaceRect`, test helpers `Diagram…→Board…`.
- **Collision:** `DiagramCanvasService → BoardCanvasService` (the `Canvas` segment is mural's own `Canvas extends Panel` type — only the `Diagram` prefix flips).
- Enums (member + string VALUE both): `DiagramCommandId→BoardCommandId` (`diagram.*` values → `board.*`, all 31), `DiagramSettingKey→BoardSettingKey` (~70 `diagram.*` values → `board.*`), `HistoryLayerId.Diagram='diagram'→Board='board'`.
- `.mu`: `resources Diagrams`→`resources Boards` (changes generated const `DiagramModule→BoardModule`), keys `DefaultDiagram→DefaultBoard`, `Style[TargetType=Diagram]`, `DataTemplate[DataType=DiagramInspector]`.

- [ ] **Step 1:** Rename the folder and the ~20 `*diagram*` source files to `*board*` (git mv); update every internal relative import.
- [ ] **Step 2:** Rename all identifiers per the map (IDE/`tsserver` rename where possible; handle the `DiagramCanvasService→BoardCanvasService` rename by hand, keeping the mural-owned `Canvas` segment). Update `framework/index.ts` re-exports.
- [ ] **Step 3:** Rename the enum string **values** (`board.*` command ids + setting keys, `'board'` layer id, `'BoardStorage'`/`'board.editing'` ServiceKey strings). These are the wire contract Plexus matches in Task 6.
- [ ] **Step 4:** Rename the `.mu` template block + keys; run `compile:mu`; confirm the generated const is now `BoardModule` and `framework.resources.mu` imports it.
- [ ] **Step 5:** Update mural `demo/` consumers and the ~40 mural test files (names + bodies).
- [ ] **Step 6:** Build mural + run its full suite. Expected: green (the existing tests are the rename's safety net).
- [ ] **Step 7:** Commit `rename(mural): Diagram → Board (identifiers, files, wire strings)`.
- [ ] **Step 8 — GATED PUBLISH:** Stop and request owner approval to bump + publish mural (depends on the Task 1 fresco version). On approval, publish; record the version.

## Task 3: TODL — ProjectNodeKind family + accept `.board`

**Files:**
- Modify: `TODL/src/solution-services/project-services/core/project.ts` (`ProjectNodeKind.Diagram`), `.../content/project-content-store.ts` (`ContentNodeKind.Diagram`, `DiagramExts`), `.../architecture-project/architecture-project-factory.ts` (`displayName`, format), `.../core/todl-project-factory.ts` (format list).
- Test: the sibling `tests/` for each (`architecture-project-factory.test.ts`, `todl-project-factory.test.ts`, content-store tests).

**Interfaces — Produces:** `ProjectNodeKind.Board = 'board'` (value rename is safe — kind is recomputed from extension, never read from a persisted field); the extension→kind maps accept `.board` (new), keep `.diagram` + `.archdiagram` (legacy).

- [ ] **Step 1 (RED):** Add a test: `kindForFile('x.board')` / content-store `kindOf('x.board')` returns the Board kind, AND `x.diagram` still returns it. Run — fails (`.board` unmapped).
- [ ] **Step 2 (GREEN):** Add `{ extension: '.board', kind: ProjectNodeKind.Board, displayName: 'Board' }` to the format lists; add `'.board'` to `DiagramExts` (rename it `BoardExts = ['.archdiagram', '.diagram', '.board']`). Rename `ProjectNodeKind.Diagram→Board` and `ContentNodeKind.Diagram→Board` + `displayName`.
- [ ] **Step 3:** Update existing TODL tests + the two scaffold `claude-root.md` docs (prose `.diagram`→`.board`).
- [ ] **Step 4:** Run TODL suite. Expected: green (note the known pre-existing `config.test.ts` env failure is unrelated). Rebuild `dist`.
- [ ] **Step 5:** Commit `rename(todl): ProjectNodeKind Diagram→Board; accept .board (keep .diagram legacy)`.

## Task 4: Plexus — reinstall published framework

**Files:** `apps/plexus/package.json`, `packages/plexus-core/package.json`, root `package.json` overrides, `.npmrc`-driven install.

**Interfaces — Consumes:** the Task 1/2 published fresco + mural versions.

- [ ] **Step 1:** Bump the `@pragmatic-tech-ai/mural` and `@pragmatic-tech-ai/fresco` pins in all three sites to the versions published in Tasks 1–2; reinstall.
- [ ] **Step 2:** `npm run typecheck` (node+web). Expected: FAILS loudly with every renamed symbol — this is the worklist for Tasks 5–7. Capture the failure list to the workspace.
- [ ] **Step 3:** Commit `chore(plexus): bump mural/fresco to the renamed versions`.

## Task 5: Plexus — rename the consumer code + `.mu` + wire strings

**Files:** `modules/diagram/**` → `modules/board/**` (incl. `plexus-diagram-document.ts`, `diagram-document-factory.ts`, `diagram-command-extension.ts`, `diagram-layout-store.ts`, `layout-pipeline-service.ts`, `zoom-shortcuts.ts`, etc.), `modules/diagram-export/**`, `architecture-projects/services/arch-diagram-*.ts`, `services/menu/view-commands-service.ts`, `src/renderer/src/main.js`, `app.mu`, `window/plexus-window.resources.mu`, `main/index.ts`, the `.mu` module/resources files, and their `tests/`.

**Interfaces — Consumes:** mural's renamed `Board*` API + `board.*` command/setting wire strings. **Produces:** nothing new (app layer).

- [ ] **Step 1:** Rename folders/files `*diagram*`→`*board*` (git mv); rename identifiers to the `Board*` imports from mural.
- [ ] **Step 2:** In `.mu`: update the `CommandDefinition [ Id = "diagram.*" ]` and `Setting [ Key = "diagram.*" ]` literal strings to `board.*` to match mural's renamed enum values (the wire contract — a mismatch breaks command/settings at runtime).
- [ ] **Step 3:** Update `main.js`/`app.mu`/window chrome/`main/index.ts` imports + any user-facing labels (module name, tab title "Diagram"→"Board", "New Diagram"→"New Board", settings category).
- [ ] **Step 4:** `compile:mu`; `typecheck`. Expected: green (worklist from Task 4 cleared).
- [ ] **Step 5:** Commit `rename(plexus): Diagram → Board consumers + .mu + wire strings`.

## Task 6: Plexus — flip the document definition + extension gates

**Files:** `apps/plexus/src/renderer/src/modules/board/board.module.mu` (the renamed `diagram.module.mu`), `board-document-factory.ts` (`newFile`), `diagram-headless-renderer.ts` (`GetByExtension`), `arch-new-diagram-participant.ts` + the two `DiagramExt` contributors (`.endsWith` gates).

**Interfaces — Produces:** the `.board` document type registration that accepts both extensions.

- [ ] **Step 1:** `DocumentDefinition`: `Type = "board"`, `FileExtensions = [".board", ".diagram"]` (new canonical + legacy read).
- [ ] **Step 2:** `newFile` → `ensureExtension(name, '.board')`; headless renderer `GetByExtension('.board')`; extend every `.endsWith('.diagram')` gate to also accept `.board`.
- [ ] **Step 3:** `compile:mu`; `typecheck`; run the Plexus unit suite. Expected: green.
- [ ] **Step 4:** Commit `feat(plexus): board document type accepts .board (+ legacy .diagram)`.

## Task 7: Plexus — extension back-compat tests + e2e fixtures

**Files:** new/updated unit tests next to the factory/registry; `apps/plexus/e2e/*.spec.ts` (~60 fixtures referencing `.diagram` / `diagram.*`).

- [ ] **Step 1 (RED):** Unit test: opening a `.diagram` file resolves the board factory (legacy still opens); creating a new board writes a `.board` path. Run — the "new file is `.board`" assertion drives it; confirm the legacy-open assertion passes (Task 6) and the new-extension assertion is green.
- [ ] **Step 2:** Update the e2e specs: new scenes authored as `.board`, plus at least one spec that opens a pre-existing `.diagram` fixture (prove legacy open) and one that exercises a board toolbar command (prove the `board.*` wire contract end-to-end).
- [ ] **Step 3:** Run unit + the touched e2e. Expected: green.
- [ ] **Step 4:** Commit `test(plexus): .board new + .diagram legacy open; board command e2e`.

## Task 8: Plexus — settings legacy-key back-compat (TDD)

**Files:**
- Create: `apps/plexus/src/main/settings/legacy-settings-keys.ts` (the alias helper) + `tests/`.
- Modify: `apps/plexus/src/main/...ElectronSettingsStore` `Load()`.

**Interfaces — Produces:** `LegacySettingsKeys.Apply(snapshot: Record<string,unknown>): Record<string,unknown>` — rewrites `diagram.<x>` entries to `board.<x>`, preferring an existing `board.<x>`.

- [ ] **Step 1 (RED):** Test: a snapshot with `{ "diagram.grid.show": true }` → `Apply` yields `{ "board.grid.show": true }`. A snapshot with both `diagram.grid.show=true` and `board.grid.show=false` → keeps `board.grid.show=false` (new wins). Keys without the `diagram.` prefix pass through untouched. Run — fails (helper absent).
- [ ] **Step 2 (GREEN):** Implement `LegacySettingsKeys` (class, static method; the `'diagram.'`/`'board.'` prefixes as `private static readonly` consts). Call `LegacySettingsKeys.Apply(...)` in `ElectronSettingsStore.Load()` before the snapshot reaches mural.
- [ ] **Step 3:** Run the suite. Expected: green.
- [ ] **Step 4:** Commit `fix(plexus): apply legacy diagram.* settings under board.* keys`.

## Task 9: Docs

**Files:** `pragmatic-docs/docs/projects/mural/diagram-api-guide.md` (→ `board-api-guide.md`), Plexus design/plan docs citing `DiagramCommandId`/`DiagramSettingKey`, this spec's own cross-refs.

- [ ] **Step 1:** Rename/update the API guide and the stale citations to the `Board*` names.
- [ ] **Step 2:** Commit `docs: Diagram → Board`.
