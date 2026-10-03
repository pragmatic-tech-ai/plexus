# Plexus Main Menu Bar (Wave 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace the single-"File" title-bar menu with a full File / Edit / View / Help menu bar, building the new app-level command bridges Edit/View/Help need.

**Architecture:** A row of four `MenuButton`s in the shared window-chrome title bar, each hosting native inline `MenuItem`s. Three new renderer services (`EditCommandsService`, `ViewCommandsService`, `HelpCommandsService`) expose `ICommand`s following the `ServiceBase` + `RelayCommand` + `$service(X).YCommand` convention. Edit routes per-document-type to the active document; View routes to the diagram view + shell panel services; Help uses `DialogService` + a new Quit IPC channel.

**Tech Stack:** mural 0.61.1 shell framework, TypeScript, `.mu` markup, Electron (main/preload/renderer IPC).

**Spec:** This is Wave 5 of Milestone C2 (`docs/superpowers/specs/2026-10-02-plexus-project-explorer-migration-design.md`, §191-221 "A leftover: main-menu shell-chrome wiring + @WindowMenuItems swap"). The menu *contents/bridges* were designed and approved in-session (2026-10-03); this plan is that approved design.

## Global Constraints

- House style (all repos): OOP (no module-level free functions/data; state in class fields); Allman braces (opening brace own line for class/interface/enum/function/method/ctor/getter/setter + every control-flow block incl. try/catch/finally; else/catch/finally own line; inline OK only for object literals, block-bodied arrows, one-line `if (x) return;`); NO inline reused/user-facing string literals → `private static readonly` PascalCase constants (menu headers, command Ids/titles, dialog titles, shortcut text); VMs extend `Observable` (not MuralBase) unless they need the DP system; PascalCase interfaces + public methods; real enums not string-unions; IDisposable teardown typed as IDisposable (not bare lambdas); no seam-bags (real classes/interfaces). Generated `*.mu.js` are build output — never hand-edit. Tests live in `tests/` subfolders.
- Branch: `c2-plexus-explorer` (shared with Wave 4, already checked out). Do NOT merge/publish/push until the finish step. Big-bang does NOT apply — the repo compiles green at the start of Wave 5; keep it green (tsc 0 + compile:mu + vitest) after every task.
- New services register in the app `.services:` block in `apps/plexus/src/renderer/src/app.mu` (root singletons), following existing entries. Command binding in markup is `$service(ServiceName).CommandName`.
- Verify after every task: `npm run -w @pragmatic-tech-ai/plexus-core build` (tsc 0 + compile:mu), `npm run -w @pragmatic-tech-ai/plexus typecheck:node` + `typecheck:web` (0), app `compile:mu`, and the task's own vitest. plexus-core/dist is stale+gitignored; rebuild plexus-core before app typecheck.

## Review Focus

- Edit menu with a NON-editable active document (markdown/wiki/settings) → every Edit item must be DISABLED (CanExecute false), never throw.
- Edit menu with NO active document at all → disabled, no throw.
- View zoom with a non-diagram active document → zoom items disabled, no throw.
- Panel toggles when the panel is already open vs closed → toggles both directions; opening an already-open dock panel must not duplicate it.
- Quit with unsaved documents → routes through the existing save-on-quit confirmation (`confirmCloseDocs`), does not hard-kill with unsaved work.
- About/Shortcuts dialogs open and dismiss cleanly (scrim click / action), no leaked subscriptions.

---

### Task 1: Window-chrome popup → native per-button item hosting

**Files:**
- Modify: `packages/plexus-core/src/renderer/modules/window-chrome/window-chrome.module.mu` (the `resources:` block: `@FileMenuPopup` and, if needed, the trigger templates)
- Modify (consumer, keep working): `apps/plexus/src/renderer/src/window/plexus-window.resources.mu` (`@WindowMenuItems` → inline items under a MenuButton)

**Interfaces:**
- Consumes: mural `MenuButton` (`HeaderedItemsControl`; hosts items natively via `ItemsPresenter`; mural's `@DefaultMenuButtonPopup` at `node_modules/@pragmatic-tech-ai/mural/.../menu/menu.template.mu` is the reference), `@CompactMenuItemRow` (existing compact row template in window-chrome.module.mu), `@FileMenuTrigger`/`@FileMenuTriggerChrome` (existing, reusable across buttons).
- Produces: a shared popup template that hosts a `MenuButton`'s OWN items (via `ItemsPresenter` with `x:name="PART_PopupItems"` or mural's expected part name — verify against mural's MenuButton template contract) wrapped in the existing `Border[Fill=@Bg2]` popup chrome + `ClickAwayScrim`. The template must be reusable by all four menu buttons (not hardcode a single `@WindowMenuItems` slot).

**Steps:**
- [ ] Step 1: Read mural's `MenuButton` default templates (`menu.template.mu` `@DefaultMenuButtonPopup`/`@DefaultMenuButtonTrigger`) and the `MenuButton` `.d.ts` to learn the exact PART names it syncs for native item hosting (popup items presenter).
- [ ] Step 2: Change `@FileMenuPopup` (or add a generic `@WindowMenuPopup`) so the popup body is an `ItemsPresenter` for the MenuButton's own items, keeping the existing `@Bg2` container + scrim chrome. Remove the hardcoded `ContentControl[Template=@WindowMenuItems]` slot dependency.
- [ ] Step 3: In `plexus-window.resources.mu`, replace the `@WindowMenuItems` ControlTemplate with an inline `MenuButton[Header="File", Template=@WindowMenuPopup, TriggerTemplate=@FileMenuTrigger]{ MenuItem[...] }` carrying the SAME File items as today (New/Open Project, Save, Save All, Export…, Close All — see Task 6 for the full list; for THIS task, keep at least the existing Export… item so the menu renders). Delete the now-unused `@WindowMenuItems` key if nothing else references it.
- [ ] Step 4: Build plexus-core + app `compile:mu`; launch nothing, but confirm the compiled `.mu.js` shows the File MenuButton hosting its items natively. Run `npm run -w @pragmatic-tech-ai/plexus typecheck:web`.
- [ ] Step 5 (gate): tsc 0 + compile:mu clean both. Commit.

*Note:* this task only proves the single File button works with native item hosting. The other three buttons are added in Task 6 once their services exist.

---

### Task 2: `EditCommandsService` (diagram-scoped undo/redo/clipboard)

**Files:**
- Create: `apps/plexus/src/renderer/src/services/menu/edit-commands-service.ts`
- Test: `apps/plexus/src/renderer/src/services/menu/tests/edit-commands-service.test.ts`

**Interfaces:**
- Consumes: `ContentHostService.Key` → cast to `DocumentsContentHostService`; `host.ActiveDocument: IDocument | undefined`; `host.PropertyChanged('ActiveDocument')` signal. `DiagramDocument` (mural `framework/diagram/diagram-document`): `History: DiagramHistory` (`CanUndo`/`CanRedo`), `Undo()`, `Redo()`, `ActiveView: Diagram` with `CopyCommand`/`CutCommand`/`PasteCommand` (`ICommand` DPs). `RelayCommand`, `ServiceBase`, `ServiceKey` from mural runtime.
- Produces: `class EditCommandsService extends ServiceBase` with `static readonly Key = new ServiceKey<EditCommandsService>('EditCommandsService')` and getters `UndoCommand`/`RedoCommand`/`CutCommand`/`CopyCommand`/`PasteCommand: ICommand`. Each command: `CanExecute` true only when the active document is a `DiagramDocument` that supports the op (Undo→`History.CanUndo`, Cut/Copy→selection exists via the view command's own CanExecute, Paste→true); `Execute` routes to the active diagram. Re-raise `CanExecuteChanged` on the `ActiveDocument` signal (subscribe once in ctor, hold the sub as `IDisposable`, dispose in `dispose()`). Non-diagram/undefined active doc → all disabled, never throws.

**Steps:**
- [ ] Step 1: Write failing tests (fake `DocumentsContentHostService` exposing `ActiveDocument` + the signal; a fake diagram document w/ History + view commands; a fake non-editable document): Undo enabled+dispatches when active diagram CanUndo; Undo disabled for a non-diagram doc; Copy reflects the view command's CanExecute; all disabled when ActiveDocument is undefined; CanExecuteChanged fires when ActiveDocument changes. Watch them fail.
- [ ] Step 2: Implement the service (per-type dispatch; `isDiagramDocument` guard via `instanceof` or a duck check consistent with the codebase). 
- [ ] Step 3: Run tests green; plexus (web) typecheck 0.
- [ ] Step 4 (gate): typecheck 0, tests green. Commit.

---

### Task 3: `ViewCommandsService` (zoom + panel toggles)

**Files:**
- Create: `apps/plexus/src/renderer/src/services/menu/view-commands-service.ts`
- Test: `apps/plexus/src/renderer/src/services/menu/tests/view-commands-service.test.ts`

**Interfaces:**
- Consumes: `ContentHostService.Key` (active diagram view `ActiveDocument.ActiveView: Diagram` → `ZoomIn()`/`ZoomOut()`/`ResetZoom()`); `NavigationService.Key` (`SidePaneVisible: boolean`, `ToggleSidePaneCommand`, `SelectedItem`); `ProblemsService.Key` (`IsOpen: boolean`); `PanelDockService.Key` (`Panels: ObservableCollection<IDockPanel>`, `Add(panel)`, `Remove`/`CloseById`, `SelectedPanel`) + the Agent Chat panel identity (`ChatSessionsService`/`ChatSession` as `IDockPanel` — resolve how a chat dock panel is opened today, e.g. a command on `ChatSessionsService`). 
- Produces: `class ViewCommandsService extends ServiceBase` + `static readonly Key`; getters `ZoomInCommand`/`ZoomOutCommand`/`ResetZoomCommand` (enabled only for an active diagram), `ToggleSideBarCommand` (flip `NavigationService.SidePaneVisible` / reuse `ToggleSidePaneCommand`), `ToggleProblemsCommand` (flip `ProblemsService.IsOpen`), `ToggleAgentChatCommand` (if the chat dock panel is in `PanelDockService.Panels` → close it; else open it). CanExecute requery on the relevant signals.

**Steps:**
- [ ] Step 1: Confirm the exact seams by reading `navigation-service.ts`, `panel-dock-service.ts`, `problems-service.ts`, and how Agent Chat is opened as a dock panel (search for where the chat `IDockPanel` is Added). Record the chat-panel open/identity mechanism.
- [ ] Step 2: Write failing tests (fakes for the four services + a fake active diagram): zoom enabled+dispatches for a diagram, disabled otherwise; ToggleSideBar flips visibility both ways; ToggleProblems flips IsOpen; ToggleAgentChat opens when absent and closes when present. Watch fail.
- [ ] Step 3: Implement. Toggle semantics = show/hide.
- [ ] Step 4: Tests green; typecheck 0.
- [ ] Step 5 (gate): Commit.

---

### Task 4: `HelpCommandsService` — About + Keyboard Shortcuts dialogs

**Files:**
- Create: `apps/plexus/src/renderer/src/services/menu/help-commands-service.ts`
- Create: `apps/plexus/src/renderer/src/services/menu/about-dialog.ts` (VM) + `about-dialog.resources.mu` (template) — or a bare-TextBlock content VM if trivial
- Create: `apps/plexus/src/renderer/src/services/menu/shortcuts-dialog.ts` (VM, static shortcut list) + `shortcuts-dialog.resources.mu`
- Test: `apps/plexus/src/renderer/src/services/menu/tests/help-commands-service.test.ts`

**Interfaces:**
- Consumes: `DialogService.Key` (`Show({ Title, Content, Width?, MaxHeight? }): Promise<T|undefined>`); `EnvironmentService.Key` (`AppVersion`/`ElectronVersion`/`ChromeVersion`/`NodeVersion`/`Platform`/`Architecture`/`IsPackaged`). Dialog content VM extends `Observable` (or `MuralBase` only if the template binds DPs). Reference pattern: `DiagramExportService.openExportDialog` + `diagram-export-preview.resources.mu` (merged in app.mu).
- Produces: `class HelpCommandsService extends ServiceBase` + Key; getters `ShowAboutCommand`, `ShowShortcutsCommand` (QuitCommand added in Task 5). About VM carries app name ("Plexus") + versions from EnvironmentService. Shortcuts VM = a hand-maintained static list: Ctrl/⌘+S Save, Ctrl/⌘+Shift+S Save All, Ctrl/⌘+W Close, Ctrl/⌘+=/−/0 Zoom In/Out/Reset, F2 Rename, Ctrl+C/X/V/Delete diagram clipboard. Register both dialog `.resources.mu` templates via app.mu merge.

**Steps:**
- [ ] Step 1: Write failing tests (fake `DialogService` recording `Show` calls; fake `EnvironmentService`): ShowAbout calls Show with Title "About Plexus" and a content VM exposing the version fields; ShowShortcuts calls Show with the shortcuts VM. Watch fail.
- [ ] Step 2: Implement the service + the two VMs. Add the two templates; merge them in app.mu.
- [ ] Step 3: Tests green; typecheck 0 + compile:mu (new .mu templates).
- [ ] Step 4 (gate): Commit.

---

### Task 5: Quit — renderer→main IPC + `HelpCommandsService.QuitCommand`

**Files:**
- Modify: `packages/plexus-core/src/shared/window-api.ts` (add `WindowChannel.Quit` + `quit()` to `IWindowApi`)
- Modify: `apps/plexus/src/preload/index.ts` (`titlebar.quit: () => ipcRenderer.send(WindowChannel.Quit)`)
- Modify: the main handler file that registers window handlers (`apps/plexus/src/main/index.ts` or `main/window.ts` — find `registerWindowHandlers`): `ipcMain.on(WindowChannel.Quit, () => app.quit())`
- Modify: `apps/plexus/src/renderer/src/services/menu/help-commands-service.ts` (add `QuitCommand`)
- Test: extend `help-commands-service.test.ts`

**Interfaces:**
- Consumes: the existing `window.api.titlebar` bridge shape (wrap it in a tiny injected seam rather than touching `window.api` directly in the service — follow how `EnvironmentService` wraps `window.api.environment`). The existing save-on-quit path: `app.quit()` triggers the window close flow which already routes through `confirmCloseDocs` (`globalThis.__confirmCloseDocs` / `confirm-close-docs.ts`) — Quit must go through `app.quit()` (NOT a hard window destroy) so unsaved-work confirmation runs.
- Produces: `HelpCommandsService.QuitCommand: ICommand` → calls the quit seam → `app.quit()` in main.

**Steps:**
- [ ] Step 1: Read `window-api.ts` + `preload/index.ts` + the main window-handler registration to copy the `SetOverlay` channel pattern exactly. Confirm the save-on-quit flow `app.quit()` triggers.
- [ ] Step 2: Add the `Quit` channel end-to-end (shared enum/interface → preload → main handler). 
- [ ] Step 3: Write a failing test for `QuitCommand` (fake quit seam records the call); implement `QuitCommand` over the seam. Watch fail → green.
- [ ] Step 4: typecheck 0 (node + web) + compile. Manually confirm the main handler calls `app.quit()` (routes through confirm-close-docs).
- [ ] Step 5 (gate): Commit.

---

### Task 6: Wire the four MenuButtons + register services + stale-comment cleanup

**Files:**
- Modify: `apps/plexus/src/renderer/src/window/plexus-window.resources.mu` (add Edit/View/Help MenuButtons beside File; full File item list)
- Modify: `apps/plexus/src/renderer/src/app.mu` (register `EditCommandsService`/`ViewCommandsService`/`HelpCommandsService` in `.services:`; clean stale comments at ~L44,159,270,272,462,573)
- Modify: `apps/plexus/src/renderer/src/main.js` (clean stale comment ~L284; wake the new services if they must be eager)
- Modify: `apps/plexus/src/renderer/src/modules/project-explorer/tests/project-explorer-service.test.ts` (stale `PackagePublisher` comments — comment-only)

**Interfaces:**
- Consumes: the three new services' command getters; the native-item-hosting popup from Task 1; `@CompactMenuItemRow`; `MenuSeparator` for dividers.
- Produces: the full menu bar. File: New Project `$service(ProjectExplorerService).NewProjectCommand` · Open Project `.OpenProjectCommand` | Save `$service(ContentHostService).SaveActiveCommand` · Save All `.SaveAllCommand` | Export… `$service(DiagramExportService).OpenExportDialogCommand` (▸ Export SVG `.ExportSvgCommand`, Export PPTX `.ExportPptxCommand`) | Close All `$service(ContentHostService).CloseAllCommand`. Edit: Undo/Redo | Cut/Copy/Paste → `$service(EditCommandsService).*`. View: Zoom In/Out/Reset | Toggle Side Bar/Problems/Agent Chat → `$service(ViewCommandsService).*`. Help: About Plexus… / Keyboard Shortcuts… | Quit → `$service(HelpCommandsService).*`. Each `MenuItem` uses `RowTemplate=@CompactMenuItemRow`.

**Steps:**
- [ ] Step 1: Add the three MenuButtons (Edit/View/Help) after File in the title-bar DockPanel-hosted markup (they're declared in `plexus-window.resources.mu` as inline items under each button, matching Task 1's pattern), with the full item lists + separators.
- [ ] Step 2: Register the three services in app.mu `.services:`; clean the stale comments.
- [ ] Step 3: Build plexus-core + app compile:mu + typecheck:node/web. Confirm the compiled `.mu.js` carries four MenuButtons with the bound commands.
- [ ] Step 4 (gate): tsc 0 + compile:mu + typecheck 0. Commit.

---

### Task 7: Integration + acceptance

**Steps:**
- [ ] Step 1: Full gate — `npm run -w @pragmatic-tech-ai/plexus-core build` (tsc 0 + compile:mu); `npm run -w @pragmatic-tech-ai/plexus typecheck:node` + `typecheck:web` (0); app `compile:mu`; plexus-core vitest + app vitest green (record counts; no regressions vs the Wave-4-end baseline: plexus-core 177+, app 1490+).
- [ ] Step 2: Acceptance (best-effort, headless if feasible; else integration tests): the four menus render with correct enable/disable per active-document type (Review Focus); Quit routes through confirm-close-docs; About/Shortcuts dialogs open/dismiss. Where full e2e isn't feasible autonomously, cover via unit/integration tests and ledger what wasn't exercised.
- [ ] Step 3 (gate): all green. Commit. Then the whole Wave-5 (and Wave-4) branch goes to the final finish step (merge to main).
