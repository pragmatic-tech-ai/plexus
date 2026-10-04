# Finish C2 Wave 5 (menu greying + Observable dialog content) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the open Wave 5 items. Menu items grey out when their command can't execute, the About/Shortcuts dialog VMs extend `Observable`, and the compiled-binding test no longer depends on a prior `compile:mu`.

**Architecture:** There are two mural changes, released as mural 0.61.3. First, `MenuItem` becomes an `ICommandSource` and uses the existing `CommandSourceHelper`, so its `IsEnabled` follows `Command.CanExecute` and `CanExecuteChanged`. Second, `DialogOptions.Content` widens to `Observable | Visual`, matching what `ContentControl`/`ContentPresenter` already accept. Plexus then adopts 0.61.3, moves both dialog VMs to `Observable`, and adds a `pretest` script that compiles `.mu` first. The title-bar row template `@CompactMenuItemRow` already dims on `IsEnabled = false`, so it needs no markup change.

**Tech Stack:** mural (TS, tests use `node:test` via `tsx --test`), Plexus (Electron, vitest), npm workspaces, GitHub Packages registry.

**Spec:** Wave 5 plan `Plexus/docs/superpowers/plans/2026-10-03-c2-wave5-plexus-menubar.md` and its ledger `Plexus/.superpowers/sdd/2026-10-03-c2-wave5-plexus-menubar/progress.md`. That ledger's final-review ruling M1 deferred menu greying "to a future mural point release". This plan is that release. User decisions from 2026-10-04: publish mural and push both repos without asking again; `.mu` markup labels stay inline.

## Global Constraints

- House style (all repos):
  - Write OOP code: no module-level free functions or data, and keep state in class fields.
  - Use Allman braces. The opening brace goes on its own line for classes, functions, methods, ctors, getters and setters, and for every control-flow block. `else`, `catch` and `finally` go on their own line. Inline braces are OK only for object literals, block-bodied arrows and one-line `if (x) return;`.
  - In `.ts`, reused or user-facing string literals become `private static readonly` PascalCase constants. Labels inside `.mu` markup stay inline.
  - VMs extend `Observable`, not `MuralBase`, unless they need DPs.
  - Interfaces and public methods are PascalCase.
  - Disposers are typed as `IDisposable`.
- Generated `*.mu.js` files are build output. Never hand-edit them.
- Tests live in `tests/` subfolders.
- Mural repo is `C:\Users\Eugene\Projects\architecture-agent\Mural`, branch `main`. Work directly on `main`; the user authorized the push and publish.
  - One file: `npm run test:file -- <path>`.
  - Full suite: `npm test`.
  - Typecheck: `npm run typecheck`.
- Plexus repo is `C:\Users\Eugene\Projects\architecture-agent\Plexus`. Work on branch `c2-wave5-finish`, created from `main` at `7cddf40` in Task 4. It is merged to `main` and pushed only in Task 5.
- Plexus verification:
  - `npm run -w @pragmatic-tech-ai/plexus-core build` (tsc 0 + compile:mu).
  - `npm run -w @pragmatic-tech-ai/plexus typecheck:node` and `typecheck:web` (both 0).
  - The app's `compile:mu`.
  - `npm run -w @pragmatic-tech-ai/plexus test` (vitest).
- Plexus vitest resolves mural from the installed package's `dist/`, not from Mural source. Plexus only sees the mural changes after 0.61.3 is published and installed (Task 3 → Task 4).
- Mural publishes to GitHub Packages (`publishConfig.registry = https://npm.pkg.github.com`). Authentication uses the `PACKAGES_TOKEN` env var, read by `Mural/.npmrc`. If it is unset, read the PAT from the gitignored `C:\Users\Eugene\Projects\architecture-agent\ai_ea\setup-github.ps1` and export it for the command only. Never print it or commit it.

## Review Focus

- **A bound `IsEnabled` must keep winning.** The shell's `CommandMenuItemTemplate` binds both `IsEnabled = $IsEnabled` and `Command = $Command`. Mural precedence is Binding > Local, so the helper's local write must not break the binding. Task 1 has a test that pins this.
- **Changing or clearing `Command` must update the item.** Setting `Command` to `undefined` after a disabled command must re-enable the item, so a stale `false` never lingers. Swapping one disabled command for another must stay disabled. Task 1 tests both.
- **Clicking a disabled item does nothing.** It must not execute and must not close the menu (`_onActivated` doesn't fire), because pointer routing skips `IsEnabled = false`. Task 1 tests this.
- **CanExecute flips while the menu is open.** For example, an undo becomes possible: the item must re-enable live through `CanExecuteChanged`. Task 1 tests the flip, and Task 4 tests it against a real Plexus command.
- **`Observable` dialog content renders.** If it falls through to the stringify fallback, the About dialog shows `[object Object]`. Task 2 asserts the dialog mounts with `Observable` content and that the content is the dialog's `Content`.

---

### Task 1: mural — `MenuItem.IsEnabled` follows its command's `CanExecute`

**Files:**
- Modify: `Mural/src/framework/menu/menu-strip.ts`. The `MenuItem` class starts at line 171, its Command DPs are at 177-178 with accessors at 214-218, and `OnPropertyChanged` is at about 525. The class comment at about 147-148 claims ICommandSource wiring that doesn't exist yet; make it true.
- Test: `Mural/src/framework/menu/tests/menu-item-command-enable.test.ts` (new)

**Interfaces:**
- Consumes: `CommandSourceHelper` and `ICommandSource` from `Mural/src/framework/commands/command-source.ts`.
  - The ctor is `(owner: ICommandSource & Visual, onChanged?: () => void)`.
  - Its members are `CanExecute: boolean`, `OnCommandChanged(old, new)`, `OnParameterOrTargetChanged()` and `dispose()`.
  - `ICommandSource` requires `Command`, `CommandParameter` and `CommandTarget: Visual | undefined`.
  - `Element.IsEnabledKey` is inherited as `MenuItem.IsEnabledKey`.
  - `MuralBase.ClearValue(key)`.
- Produces: `MenuItem implements ICommandSource` with `CommandTarget` returning `undefined`, so a RoutedCommand targets the item itself. `IsEnabled` tracks `Command.CanExecute(CommandParameter)` whenever a `Command` is set. When no command is set, the local `IsEnabled` value is cleared, which returns it to inherited or default.

- [ ] **Step 1: Write the failing tests.** Create `menu-item-command-enable.test.ts`:

```ts
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Binding, Observable, Panel, PointerButton, NoModifiers, RelayCommand, type PointerEventInit } from '../../../runtime/index.js';
import { InputManager } from '../../../framework/index.js';
import { MenuItem } from '../menu-strip.js';

class Root extends Panel {}

class Gate
{
    public Open = false;
    public readonly Command = new RelayCommand(() => { this.Executed++; }, () => this.Open);
    public Executed = 0;
}

function pointer(): PointerEventInit
{
    return {
        HostX: 0, HostY: 0, Button: PointerButton.Primary, Buttons: 1,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0, PointerType: 'mouse',
    };
}

describe('MenuItem enable state follows Command.CanExecute', () => {
    beforeEach(() => { initTestApp(); });

    test('no Command: IsEnabled stays at its default (true)', () => {
        const mi = new MenuItem();
        assert.equal(mi.IsEnabled, true);
    });

    test('Command whose CanExecute is false disables the item', () => {
        const gate = new Gate();
        const mi = new MenuItem();
        mi.Command = gate.Command;
        assert.equal(mi.IsEnabled, false);
    });

    test('CanExecuteChanged re-enables the item live', () => {
        const gate = new Gate();
        const mi = new MenuItem();
        mi.Command = gate.Command;
        gate.Open = true;
        gate.Command.RaiseCanExecuteChanged();
        assert.equal(mi.IsEnabled, true);
        gate.Open = false;
        gate.Command.RaiseCanExecuteChanged();
        assert.equal(mi.IsEnabled, false);
    });

    test('clearing Command after a disabled command re-enables the item', () => {
        const gate = new Gate();
        const mi = new MenuItem();
        mi.Command = gate.Command;
        mi.Command = undefined;
        assert.equal(mi.IsEnabled, true);
    });

    test('swapping one disabled command for another stays disabled and stops listening to the old one', () => {
        const a = new Gate();
        const b = new Gate();
        const mi = new MenuItem();
        mi.Command = a.Command;
        mi.Command = b.Command;
        assert.equal(mi.IsEnabled, false);
        a.Open = true;
        a.Command.RaiseCanExecuteChanged();
        assert.equal(mi.IsEnabled, false);
    });

    test('CommandParameter change re-queries CanExecute', () => {
        const mi = new MenuItem();
        mi.Command = new RelayCommand(() => {}, (p) => p === 'ok');
        assert.equal(mi.IsEnabled, false);
        mi.CommandParameter = 'ok';
        assert.equal(mi.IsEnabled, true);
    });

    test('a bound IsEnabled keeps winning over the command sync (Binding > Local)', () => {
        const source = new (class extends Observable { public Enabled = true; })();
        const gate = new Gate();
        const mi = new MenuItem();
        mi.DataContext = source;
        mi.SetBinding(MenuItem.IsEnabledKey, new Binding('Enabled'));
        mi.Command = gate.Command;
        assert.equal(mi.IsEnabled, true);
    });

    test('clicking a disabled item neither executes nor activates', () => {
        const root = new Root();
        const gate = new Gate();
        const mi = new MenuItem();
        root.AddChild(mi);
        mi.Command = gate.Command;
        let activated = 0;
        mi._onActivated = (): void => { activated++; };
        const im = new InputManager();
        im.InjectPointerDown(mi, pointer());
        im.InjectPointerUp(mi, pointer());
        assert.equal(gate.Executed, 0);
        assert.equal(activated, 0);
    });
});
```

*Note for the implementer:* the bound-IsEnabled test uses `Binding`, `SetBinding` and `DataContext`. Before running, check the exact binding API used in Mural's own tests (`grep -rn "SetBinding\|new Binding(" Mural/src --include=*.test.ts | head`). Adapt that one test's three binding lines to the real API, keeping its assertion. If the API differs, write it down in the report.

- [ ] **Step 2: Run the new tests to verify they fail.**
  - Run: `cd Mural && npm run test:file -- src/framework/menu/tests/menu-item-command-enable.test.ts`
  - Expected: the "disables", "re-enables live", "swapping" and "CommandParameter" tests FAIL, because `IsEnabled` stays `true`. "no Command" and "bound" PASS.
  - The click test may already pass, because `activate()` guards Execute but still calls `_onActivated`. The `activated === 0` assertion should FAIL.

- [ ] **Step 3: Implement in `menu-strip.ts`.** Add the imports (the same relative style as the file's other imports):

```ts
import { CommandSourceHelper, type ICommandSource } from '../commands/command-source.js';
```

Change the class declaration and add the helper, the `CommandTarget` and the sync method:

```ts
export class MenuItem extends HeaderedItemsControl implements ICommandSource
{
    // ...existing static DPs unchanged...

    // Tracks Command.CanExecute (listener bookkeeping + cached value) the
    // same way Button does; on every transition it pushes the result into
    // IsEnabled so the row templates' `when ( IsEnabled = false )` dims the
    // item and pointer/keyboard routing skips it.
    private readonly _commandSource = new CommandSourceHelper(this, () => this.syncIsEnabledFromCommand());

    // MenuItem has no CommandTarget DP — a RoutedCommand targets the item.
    public get CommandTarget(): Visual | undefined { return undefined; }

    private syncIsEnabledFromCommand(): void
    {
        if (this.Command === undefined)
        {
            this.ClearValue(MenuItem.IsEnabledKey);
            return;
        }
        this.IsEnabled = this._commandSource.CanExecute;
    }
```

In `OnPropertyChanged`, right after `super.OnPropertyChanged(...)` and `const name = descriptor.Name;`, add this before the existing `RowTemplate` branch:

```ts
        if (name === 'Command')
        {
            this._commandSource.OnCommandChanged(oldValue as ICommand | undefined, newValue as ICommand | undefined);
            this.syncIsEnabledFromCommand();
            return;
        }
        if (name === 'CommandParameter')
        {
            this._commandSource.OnParameterOrTargetChanged();
            this.syncIsEnabledFromCommand();
            return;
        }
```

Import `ICommand` as a type from wherever `menu-strip.ts` already gets `ICommand`, which it does for the `CommandKey` DP.

Also check where `Visual` is imported in this file. If it isn't imported, add it to the existing `runtime` import.

If `MenuItem` has a teardown override (`dispose`/`OnDetached`), call `this._commandSource.dispose()` there. If it has none, don't add one; the helper comment documents relying on dropped references.

Rewrite the class comment's ICommandSource sentence (about lines 147-148) so it describes this wiring.

- [ ] **Step 4: Run the new tests and the existing menu tests.**
  - Run: `npm run test:file -- src/framework/menu/tests/menu-item-command-enable.test.ts src/framework/menu/tests/menu.test.ts src/framework/menu/tests/command-menu-rendering.test.ts src/framework/menu/tests/command-context-menu-lifecycle.test.ts src/framework/menu/tests/context-menu.test.ts src/framework/menu/tests/menu-button-template-swap.test.ts`
  - Expected: all PASS.
  - If the click test still fails, it means pointer routing doesn't skip the item: trace `routed-event.ts:759-765` and report it. Don't hack `activate()`.
  - Then run `npm run typecheck` (0 errors) and `npm test` (the full suite green).

- [ ] **Step 5: Commit.**

```bash
git add src/framework/menu/menu-strip.ts src/framework/menu/tests/menu-item-command-enable.test.ts
git commit -m "feat(menu): MenuItem.IsEnabled follows Command.CanExecute (ICommandSource via CommandSourceHelper)"
```

---

### Task 2: mural — `DialogOptions.Content` accepts any `Observable`

**Files:**
- Modify: `Mural/src/framework/shell/services/dialog-service.ts`. The imports are at lines 1-9, the `DialogOptions` comment and `Content` type at 23-31, and the cast at about line 113.
- Test: `Mural/src/framework/shell/tests/dialog-service.test.ts` (add one test)

**Interfaces:**
- Consumes: `Observable`, exported from `Mural/src/runtime/index.ts`. `MuralBase extends Observable`, and `ContentControl.ContentKey` is already typed `Visual | Observable | undefined`.
- Produces: `DialogOptions.Content: Observable | Visual`. This is source-compatible: every `MuralBase` is an `Observable`.

- [ ] **Step 1: Write the failing test.** Add to `dialog-service.test.ts`, mirroring the existing `FakeContent` test's host/target setup in that file:

```ts
class FakeObservableContent extends Observable { }

test('Show accepts plain Observable content (not just MuralBase)', () => {
    initTestApp();
    const host = new Border();
    const target = new HeadlessTarget(400, 300);
    target.Content = host;
    target.Flush();
    const svc = makeService(host);
    const content = new FakeObservableContent();
    void svc.Show<string>({ Title: 'About', Content: content });
    target.Flush();
    assert.equal(target.OverlayRoot.Children.Count, 2);
});
```

Add `Observable` to the file's existing `runtime/index.js` import. Match the assertion style and helper names the file already uses (the recon says it uses `makeService(host)` and `target.OverlayRoot`). Before this compiles, `Content: content` is a type error, because `FakeObservableContent` is not a `MuralBase | Visual`.

- [ ] **Step 2: Verify it fails.**
  - Run: `cd Mural && npm run typecheck`
  - Expected: an error that `FakeObservableContent` is not assignable to `MuralBase | Visual`.

- [ ] **Step 3: Implement.** In `dialog-service.ts`:
  - Import `Observable` from `../../../runtime/index.js`, next to `MuralBase` and `Visual`.
  - Change `readonly Content: MuralBase | Visual;` to `readonly Content: Observable | Visual;`.
  - Change the consumption cast to `(dialog as unknown as { Content: Observable | Visual }).Content = options.Content;`.
  - Update the comment above `DialogOptions`: "`Content` is the body — an Observable view-model (rendered by its own DataTemplate, resolved by constructor identity) or a ready-made Visual."
  - Remove the `MuralBase` import only if nothing else in the file uses it.

- [ ] **Step 4: Run.**
  - `npm run typecheck`: 0 errors.
  - `npm run test:file -- src/framework/shell/tests/dialog-service.test.ts`: all PASS.
  - `npm test`: full suite green.

- [ ] **Step 5: Commit.**

```bash
git add src/framework/shell/services/dialog-service.ts src/framework/shell/tests/dialog-service.test.ts
git commit -m "feat(dialog): DialogOptions.Content accepts any Observable view-model"
```

---

### Task 3: mural — release 0.61.3

**Files:**
- Modify: `Mural/package.json` (`"version": "0.61.2"` → `"0.61.3"`)
- Modify: `Mural/package-lock.json`. Change exactly two fields: the root `version` and `packages[""].version`. This mirrors release commit `107f08f8`.

**Interfaces:**
- Consumes: Tasks 1 and 2, committed on mural `main`.
- Produces: `@pragmatic-tech-ai/mural@0.61.3` on GitHub Packages, and mural `main` pushed to `origin`.

- [ ] **Step 1:** Bump both version fields by hand, or with `npm version 0.61.3 --no-git-tag-version`, and check the diff touches only those two lock fields.
- [ ] **Step 2:** Gate: `npm run typecheck` (0) and `npm test` (green). Do not publish on red.
- [ ] **Step 3:** Commit: `git commit -am "release: mural v0.61.3 (MenuItem greys on CanExecute=false; Observable dialog content)"`. Leave the untracked `.gitattributes` and `.graphifyignore` alone and do not add them.
- [ ] **Step 4:** Push: `git push origin main`.
- [ ] **Step 5:** Publish: `npm publish`. `prepublishOnly` runs clean and build. If `PACKAGES_TOKEN` is unset, export it for this command only, as described in Global Constraints.
  - Verify with `npm view @pragmatic-tech-ai/mural@0.61.3 version --registry https://npm.pkg.github.com`, which prints `0.61.3`.
  - If the publish fails, report the error verbatim and stop. Do not retry with different flags.

---

### Task 4: Plexus — adopt mural 0.61.3, Observable dialog VMs, self-sufficient tests

**Files:**
- Modify: `Plexus/apps/plexus/package.json`. Change the `@pragmatic-tech-ai/mural` ranges (lines 30, 49) from `^0.61.2` to `^0.61.3`. Add `"pretest": "npm run compile:mu"` next to `"test": "vitest run"` (line 17).
- Modify: `Plexus/packages/plexus-core/package.json`. Change the mural ranges (lines 44, 51) to `^0.61.3`.
- Modify: `Plexus/package-lock.json` (via `npm install`).
- Modify: `Plexus/apps/plexus/src/renderer/src/services/menu/about-dialog.ts` (`AboutDialogVm extends MuralBase` → `Observable`; rewrite the comment at lines 7-13)
- Modify: `Plexus/apps/plexus/src/renderer/src/services/menu/shortcuts-dialog.ts` (`ShortcutsDialogVm extends MuralBase` → `Observable` at about line 32; fix its justification comment; drop the `MuralBase` import if unused)
- Test: `Plexus/apps/plexus/src/renderer/src/services/menu/tests/edit-commands-service.test.ts` (add one test)

**Interfaces:**
- Consumes:
  - `MenuItem` from `@pragmatic-tech-ai/mural/framework`, whose `IsEnabled` now follows `Command.CanExecute` (Task 1).
  - `DialogOptions.Content: Observable | Visual` (Task 2).
  - `EditCommandsService.UndoCommand` (existing; `CanExecute` is false when there is no active diagram document).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Branch.** `cd Plexus && git checkout -b c2-wave5-finish` (from `main` at `7cddf40`).
- [ ] **Step 2: Bump and install.**
  - Edit the four ranges, then run `npm install` from the Plexus root.
  - Confirm that `apps/plexus/node_modules/@pragmatic-tech-ai/mural/package.json` and `packages/plexus-core/node_modules/@pragmatic-tech-ai/mural/package.json` both report `0.61.3`. If npm hoisted mural to the root instead, check that the root copy reports `0.61.3`.
  - Run `grep -n "IsEnabled\|CommandSourceHelper" <that mural>/dist/framework/menu/menu-strip.js | head` to prove the new dist is installed.
  - `npm install` breaks the workspace symlinks; see memory note `project_workspace_symlinks_and_prettier`. If `node_modules/@pragmatic-tech-ai/plexus-core` stops being a symlink to `packages/plexus-core`, restore it the way that note describes and record what you did in the report.
- [ ] **Step 3: Write the failing integration test.** Add to `edit-commands-service.test.ts`, reusing that file's existing fixture for constructing an `EditCommandsService` with no active document. Read the file first and use its helper, not a new one.

```ts
import { MenuItem } from '@pragmatic-tech-ai/mural/framework'

it('a MenuItem bound to UndoCommand is disabled with no active diagram, and re-enables on CanExecuteChanged', () =>
{
    const service = /* existing no-active-document fixture from this file */
    const item = new MenuItem()
    item.Command = service.UndoCommand
    expect(item.IsEnabled).toBe(false)
})
```

Replace the comment with the file's real fixture call. Then extend the test: use the file's existing active-diagram-document fixture to make an undo possible, and fire whatever that fixture already uses to raise `ActiveDocument`/`CanExecuteChanged`. Then assert `item.IsEnabled` becomes `true`. If no existing fixture can produce `CanUndo === true`, keep only the disabled assertion and say so in the report.

Run `npm run -w @pragmatic-tech-ai/plexus test -- src/renderer/src/services/menu/tests/edit-commands-service.test.ts`. Before Step 2's install it would fail; after the install it should pass. If it passes before any code change, that's expected (the dependency upgrade is the change). Record the output.

- [ ] **Step 4: Switch the VMs to Observable.**
  - In `about-dialog.ts`, change the import to `import { Observable } from '@pragmatic-tech-ai/mural/runtime'` and `export class AboutDialogVm extends Observable`.
  - Replace the comment at lines 7-13 with: `// Extends Observable (the VM default): DialogService.Show accepts any Observable as Content (mural 0.61.3+).`
  - In `shortcuts-dialog.ts`, make the same change for `ShortcutsDialogVm`, and replace its MuralBase-justification comment with the same one-liner.
  - Leave `ShortcutEntry` (already `Observable`) unchanged. Keep `super()` calls as they are.
- [ ] **Step 5: Verify the full gate.**
  - `npm run -w @pragmatic-tech-ai/plexus-core build`: tsc 0 + compile:mu.
  - `npm run -w @pragmatic-tech-ai/plexus typecheck:node`: 0.
  - `npm run -w @pragmatic-tech-ai/plexus typecheck:web`: 0.
  - `npm run -w @pragmatic-tech-ai/plexus test`. This now runs `pretest` (compile:mu) first; confirm the compile:mu output appears before vitest. Expect all green, including `help-commands-service.test.ts` and `window/tests/plexus-window-menu-binding.test.ts`.
  - Also prove the `pretest` fix: delete `apps/plexus/src/renderer/src/window/plexus-window.resources.mu.js` (gitignored build output), run `npm run -w @pragmatic-tech-ai/plexus test -- src/renderer/src/window/tests/plexus-window-menu-binding.test.ts`, and confirm it passes because `pretest` regenerated the file.
- [ ] **Step 6: Commit.**

```bash
git add apps/plexus/package.json packages/plexus-core/package.json package-lock.json apps/plexus/src/renderer/src/services/menu/about-dialog.ts apps/plexus/src/renderer/src/services/menu/shortcuts-dialog.ts apps/plexus/src/renderer/src/services/menu/tests/edit-commands-service.test.ts
git commit -m "feat(menu): adopt mural 0.61.3 — menu items grey on CanExecute=false; dialog VMs extend Observable; pretest compiles .mu"
```

---

### Task 5: Plexus — merge and push

**Files:** none (git only).

- [ ] **Step 1:** On `c2-wave5-finish`, re-run the Task 4 Step 5 gate one last time (all green).
- [ ] **Step 2:** `git checkout main && git merge --no-ff c2-wave5-finish -m "Merge c2-wave5-finish: menu greying (mural 0.61.3) + Observable dialog VMs"`
- [ ] **Step 3:** `git push origin main`, then delete the local branch with `git branch -d c2-wave5-finish`.
- [ ] **Step 4:** Update GitHub issue plexus#5. Comment that the "menu IsEnabled" follow-up is done (mural 0.61.3, plus the Plexus merge commit sha) and tick that item if the issue body has a checklist. The other follow-ups (Delete-key, DR8 gating, Build All) stay open.
