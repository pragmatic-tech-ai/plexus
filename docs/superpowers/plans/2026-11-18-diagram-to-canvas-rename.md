# Diagram → Canvas Rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the node-and-connector surface from "Diagram" to "Canvas" end-to-end — identifiers, file/folder names, user-facing labels, and wire strings (command ids, setting keys, the `.diagram` extension, the `"diagram"` document type) — across four repos, with zero behavior change and no loss of saved files or settings.

**Architecture:** A layered big-bang sweep, lowest layer first: **fresco → mural → TODL → Plexus**. fresco and mural are consumed by Plexus as *published* GitHub Packages, so each is version-bumped and **published** (a gated stop-point) as its phase finishes; TODL is a live junction (rebuild `dist`). Two persisted surfaces get back-compat shims (the only non-mechanical code): legacy `.diagram` files keep opening (the extension stays in the accepted list; file bytes are already valid `.canvas`), and legacy `diagram.*` settings keep applying (a `diagram.*→canvas.*` alias in Plexus's `ElectronSettingsStore.Load()`).

**Tech Stack:** TypeScript (ESM, strict), the `mural` UI framework + `.mu` markup (compiled via `compile:mu`), `fresco` layout engine, `TODL` engine, Electron (electron-vite), vitest + node:test, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-18-diagram-to-canvas-rename-design.md`

## Global Constraints

- **Pure rename, zero behavior change.** Every task's diff is rename + back-compat shim only. No logic changes, no "while I'm here" edits.
- **No data loss (anti-goal).** Existing `.diagram` files must still open; existing `diagram.*` settings must still apply. These are verified by tests, not assumed.
- **Layer order + gated publishes.** fresco → mural → (TODL, independent) → Plexus. Each `fresco`/`mural` publish is a **STOP point**: do not publish without explicit owner approval. Plexus reinstalls the published versions before its phase.
- **House rules:** OOP (methods on classes, no free functions / module-global mutable state; module `const` for true constants ok); Allman braces; no inline string literals in `.ts` (hoist to `private static readonly` PascalCase) — applies to the new shim code; `.mu` labels stay inline (no-inline is TS-only). PascalCase interfaces/public methods. Engine never calls up.
- **Tests live in `tests/` subfolders.** Renamed test files keep that.
- **Generated files** (`*.mu.js`, `*.generated.ts`) are regenerated (via `compile:mu` / typings build), never hand-edited.
- **Merge locally; never push/publish without explicit instruction.**
- **Target term is `Canvas`.** `.archdiagram` is NOT renamed (legacy, stays readable). The Rust mural port is out of scope (flag to mirror separately).

## Review Focus

Inputs the rename could break that no rename-table exercises — each gets a test in the owning task:
- **A legacy `.diagram` file opens** after the rename (extension stays accepted). → Task 7 test.
- **A new document is created as `.canvas`**, not `.diagram`. → Task 7 test.
- **Persisted `diagram.*` settings still apply** once keys are `canvas.*` (the alias). → Task 8 (TDD).
- **`canvas.*` wins when both legacy and new keys exist** (no stale-value regression). → Task 8 (TDD).
- **Command routing survives the wire-string rename** — mural's renamed `CanvasCommandId` values match Plexus's `.mu` literal `Id=` strings exactly (a mismatch silently breaks toolbar commands). → Task 6 (build + an e2e that exercises one canvas command).

---

## Task 1: Fresco — rename the `Diagram (native)` label

**Files:**
- Modify: `D:\architecture-agent\Fresco\src\...\cardinal-side-router.ts` (`CardinalSideRouter.Name`)
- Modify: `D:\architecture-agent\Fresco\src\...\pipeline-elements-data.ts` (catalog entry)
- Test: `D:\architecture-agent\Fresco\src\...\configuration-loader.test.ts` (asserting string)

**Interfaces:**
- Produces: the new router display name (pick `Canvas (native)`) — a user-facing string only; no API shape change.

- [ ] **Step 1:** Grep fresco for the literal `Diagram (native)` and `'Diagram'` catalog/label occurrences; confirm the three sites above are the complete set.
- [ ] **Step 2:** Rename the label to `Canvas (native)` at the router + catalog; update the asserting test to expect the new string (this test is the RED→GREEN: it fails on the old assertion vs new value until both are changed together).
- [ ] **Step 3:** Run fresco's suite. Expected: green.
- [ ] **Step 4:** Commit `rename(fresco): 'Diagram (native)' router label → 'Canvas (native)'`.
- [ ] **Step 5 — GATED PUBLISH:** Stop and request owner approval to version-bump + publish fresco to GitHub Packages. On approval, publish; record the new version.

## Task 2: Mural — rename identifiers, files, folder, `.mu`, enum values

**Files:** (folder) `Mural/src/framework/diagram/` → `Mural/src/framework/canvas/`; `framework/index.ts` re-exports; `resources/framework.resources.mu` import; mural `demo/` consumers; ~40 mural tests. Authoritative symbol map below.

**Interfaces — Produces (the renamed public API other repos consume):**
- Types/classes: `Diagram→Canvas`, `IDiagramViewHost→ICanvasViewHost`, `DiagramPositionSnap→CanvasPositionSnap`, `DiagramDocument→CanvasDocument`, `DiagramStorage→CanvasStorage`, `DiagramStorageKey→CanvasStorageKey` (ServiceKey string `'DiagramStorage'→'CanvasStorage'`), `DiagramEditingContext→CanvasEditingContext` (ServiceKey `'diagram.editing'→'canvas.editing'`), `DiagramInspector→CanvasInspector`, `DiagramHistory→CanvasHistory`, `FileDiagramStorage→FileCanvasStorage`, `DiagramMutator→CanvasMutator`, `attachStandardDiagramMutations→attachStandardCanvasMutations`, `DiagramSelectionSource→CanvasSelectionSource`, `DiagramConnectorsMaterializer→CanvasConnectorsMaterializer`, `DiagramCommands→CanvasCommands`, `DiagramWorkspaceService→CanvasWorkspaceService`, `DiagramCameraService/Store/State→CanvasCamera…`, `DiagramGuidesService/Store/State→CanvasGuides…`, `DiagramSettings→CanvasSettings`, `diagramSpaceRect→canvasSpaceRect`, test helpers `Diagram…→Canvas…`.
- **Collision:** `DiagramCanvasService → CanvasSurfaceService` (NOT `CanvasCanvasService`).
- Enums (member + string VALUE both): `DiagramCommandId→CanvasCommandId` (`diagram.*` values → `canvas.*`, all 31), `DiagramSettingKey→CanvasSettingKey` (~70 `diagram.*` values → `canvas.*`), `HistoryLayerId.Diagram='diagram'→Canvas='canvas'`.
- `.mu`: `resources Diagrams`→`resources Canvases` (changes generated const `DiagramModule→CanvasModule`), keys `DefaultDiagram→DefaultCanvas`, `Style[TargetType=Diagram]`, `DataTemplate[DataType=DiagramInspector]`.

- [ ] **Step 1:** Rename the folder and the ~20 `*diagram*` source files to `*canvas*` (git mv); update every internal relative import.
- [ ] **Step 2:** Rename all identifiers per the map (IDE/`tsserver` rename where possible; handle the `DiagramCanvasService→CanvasSurfaceService` collision by hand). Update `framework/index.ts` re-exports.
- [ ] **Step 3:** Rename the enum string **values** (`canvas.*` command ids + setting keys, `'canvas'` layer id, `'CanvasStorage'`/`'canvas.editing'` ServiceKey strings). These are the wire contract Plexus matches in Task 6.
- [ ] **Step 4:** Rename the `.mu` template block + keys; run `compile:mu`; confirm the generated const is now `CanvasModule` and `framework.resources.mu` imports it.
- [ ] **Step 5:** Update mural `demo/` consumers and the ~40 mural test files (names + bodies).
- [ ] **Step 6:** Build mural + run its full suite. Expected: green (the existing tests are the rename's safety net).
- [ ] **Step 7:** Commit `rename(mural): Diagram → Canvas (identifiers, files, wire strings)`.
- [ ] **Step 8 — GATED PUBLISH:** Stop and request owner approval to bump + publish mural (depends on the Task 1 fresco version). On approval, publish; record the version.

## Task 3: TODL — ProjectNodeKind family + accept `.canvas`

**Files:**
- Modify: `TODL/src/solution-services/project-services/core/project.ts` (`ProjectNodeKind.Diagram`), `.../content/project-content-store.ts` (`ContentNodeKind.Diagram`, `DiagramExts`), `.../architecture-project/architecture-project-factory.ts` (`displayName`, format), `.../core/todl-project-factory.ts` (format list).
- Test: the sibling `tests/` for each (`architecture-project-factory.test.ts`, `todl-project-factory.test.ts`, content-store tests).

**Interfaces — Produces:** `ProjectNodeKind.Canvas = 'canvas'` (value rename is safe — kind is recomputed from extension, never read from a persisted field); the extension→kind maps accept `.canvas` (new), keep `.diagram` + `.archdiagram` (legacy).

- [ ] **Step 1 (RED):** Add a test: `kindForFile('x.canvas')` / content-store `kindOf('x.canvas')` returns the Canvas kind, AND `x.diagram` still returns it. Run — fails (`.canvas` unmapped).
- [ ] **Step 2 (GREEN):** Add `{ extension: '.canvas', kind: ProjectNodeKind.Canvas, displayName: 'Canvas' }` to the format lists; add `'.canvas'` to `DiagramExts` (rename it `CanvasExts = ['.archdiagram', '.diagram', '.canvas']`). Rename `ProjectNodeKind.Diagram→Canvas` and `ContentNodeKind.Diagram→Canvas` + `displayName`.
- [ ] **Step 3:** Update existing TODL tests + the two scaffold `claude-root.md` docs (prose `.diagram`→`.canvas`).
- [ ] **Step 4:** Run TODL suite. Expected: green (note the known pre-existing `config.test.ts` env failure is unrelated). Rebuild `dist`.
- [ ] **Step 5:** Commit `rename(todl): ProjectNodeKind Diagram→Canvas; accept .canvas (keep .diagram legacy)`.

## Task 4: Plexus — reinstall published framework

**Files:** `apps/plexus/package.json`, `packages/plexus-core/package.json`, root `package.json` overrides, `.npmrc`-driven install.

**Interfaces — Consumes:** the Task 1/2 published fresco + mural versions.

- [ ] **Step 1:** Bump the `@pragmatic-tech-ai/mural` and `@pragmatic-tech-ai/fresco` pins in all three sites to the versions published in Tasks 1–2; reinstall.
- [ ] **Step 2:** `npm run typecheck` (node+web). Expected: FAILS loudly with every renamed symbol — this is the worklist for Tasks 5–7. Capture the failure list to the workspace.
- [ ] **Step 3:** Commit `chore(plexus): bump mural/fresco to the renamed versions`.

## Task 5: Plexus — rename the consumer code + `.mu` + wire strings

**Files:** `modules/diagram/**` → `modules/canvas/**` (incl. `plexus-diagram-document.ts`, `diagram-document-factory.ts`, `diagram-command-extension.ts`, `diagram-layout-store.ts`, `layout-pipeline-service.ts`, `zoom-shortcuts.ts`, etc.), `modules/diagram-export/**`, `architecture-projects/services/arch-diagram-*.ts`, `services/menu/view-commands-service.ts`, `src/renderer/src/main.js`, `app.mu`, `window/plexus-window.resources.mu`, `main/index.ts`, the `.mu` module/resources files, and their `tests/`.

**Interfaces — Consumes:** mural's renamed `Canvas*` API + `canvas.*` command/setting wire strings. **Produces:** nothing new (app layer).

- [ ] **Step 1:** Rename folders/files `*diagram*`→`*canvas*` (git mv); rename identifiers to the `Canvas*` imports from mural.
- [ ] **Step 2:** In `.mu`: update the `CommandDefinition [ Id = "diagram.*" ]` and `Setting [ Key = "diagram.*" ]` literal strings to `canvas.*` to match mural's renamed enum values (the wire contract — a mismatch breaks command/settings at runtime).
- [ ] **Step 3:** Update `main.js`/`app.mu`/window chrome/`main/index.ts` imports + any user-facing labels (module name, tab title "Diagram"→"Canvas", "New Diagram"→"New Canvas", settings category).
- [ ] **Step 4:** `compile:mu`; `typecheck`. Expected: green (worklist from Task 4 cleared).
- [ ] **Step 5:** Commit `rename(plexus): Diagram → Canvas consumers + .mu + wire strings`.

## Task 6: Plexus — flip the document definition + extension gates

**Files:** `apps/plexus/src/renderer/src/modules/canvas/canvas.module.mu` (the renamed `diagram.module.mu`), `canvas-document-factory.ts` (`newFile`), `diagram-headless-renderer.ts` (`GetByExtension`), `arch-new-diagram-participant.ts` + the two `DiagramExt` contributors (`.endsWith` gates).

**Interfaces — Produces:** the `.canvas` document type registration that accepts both extensions.

- [ ] **Step 1:** `DocumentDefinition`: `Type = "canvas"`, `FileExtensions = [".canvas", ".diagram"]` (new canonical + legacy read).
- [ ] **Step 2:** `newFile` → `ensureExtension(name, '.canvas')`; headless renderer `GetByExtension('.canvas')`; extend every `.endsWith('.diagram')` gate to also accept `.canvas`.
- [ ] **Step 3:** `compile:mu`; `typecheck`; run the Plexus unit suite. Expected: green.
- [ ] **Step 4:** Commit `feat(plexus): canvas document type accepts .canvas (+ legacy .diagram)`.

## Task 7: Plexus — extension back-compat tests + e2e fixtures

**Files:** new/updated unit tests next to the factory/registry; `apps/plexus/e2e/*.spec.ts` (~60 fixtures referencing `.diagram` / `diagram.*`).

- [ ] **Step 1 (RED):** Unit test: opening a `.diagram` file resolves the canvas factory (legacy still opens); creating a new canvas writes a `.canvas` path. Run — the "new file is `.canvas`" assertion drives it; confirm the legacy-open assertion passes (Task 6) and the new-extension assertion is green.
- [ ] **Step 2:** Update the e2e specs: new scenes authored as `.canvas`, plus at least one spec that opens a pre-existing `.diagram` fixture (prove legacy open) and one that exercises a canvas toolbar command (prove the `canvas.*` wire contract end-to-end).
- [ ] **Step 3:** Run unit + the touched e2e. Expected: green.
- [ ] **Step 4:** Commit `test(plexus): .canvas new + .diagram legacy open; canvas command e2e`.

## Task 8: Plexus — settings legacy-key back-compat (TDD)

**Files:**
- Create: `apps/plexus/src/main/settings/legacy-settings-keys.ts` (the alias helper) + `tests/`.
- Modify: `apps/plexus/src/main/...ElectronSettingsStore` `Load()`.

**Interfaces — Produces:** `LegacySettingsKeys.Apply(snapshot: Record<string,unknown>): Record<string,unknown>` — rewrites `diagram.<x>` entries to `canvas.<x>`, preferring an existing `canvas.<x>`.

- [ ] **Step 1 (RED):** Test: a snapshot with `{ "diagram.grid.show": true }` → `Apply` yields `{ "canvas.grid.show": true }`. A snapshot with both `diagram.grid.show=true` and `canvas.grid.show=false` → keeps `canvas.grid.show=false` (new wins). Keys without the `diagram.` prefix pass through untouched. Run — fails (helper absent).
- [ ] **Step 2 (GREEN):** Implement `LegacySettingsKeys` (class, static method; the `'diagram.'`/`'canvas.'` prefixes as `private static readonly` consts). Call `LegacySettingsKeys.Apply(...)` in `ElectronSettingsStore.Load()` before the snapshot reaches mural.
- [ ] **Step 3:** Run the suite. Expected: green.
- [ ] **Step 4:** Commit `fix(plexus): apply legacy diagram.* settings under canvas.* keys`.

## Task 9: Docs

**Files:** `pragmatic-docs/docs/projects/mural/diagram-api-guide.md` (→ `canvas-api-guide.md`), Plexus design/plan docs citing `DiagramCommandId`/`DiagramSettingKey`, this spec's own cross-refs.

- [ ] **Step 1:** Rename/update the API guide and the stale citations to the `Canvas*` names.
- [ ] **Step 2:** Commit `docs: Diagram → Canvas`.
