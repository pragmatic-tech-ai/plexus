# Engine / Presentation Reband Pilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the engine/presentation principles by rebanding TODL's solution subsystem: land the `Ask<R>`/`IPromptService`/`INotificationService` communication primitives, split `TODL/src/solution` into `engine/` + `presentation/` with an enforced no-UI boundary, rename the authoritative aggregate `SolutionViewService → Solution`, and replace the `IDiscardConfirmer` seam with `IPromptService`.

**Architecture:** Communication primitives land in `todl-runtime` (beside `Signal`, dependency-free). The solution engine keeps its authority (`SolutionManagerService` owns a `Solution` model, drives it through DI seams + `IPromptService`), the projection VMs (`SolutionTreeVM`, `SettingBagGrid`) move to a presentation band, and a boundary test enforces that `engine/` imports no UI framework. devUI is updated as the coordinated consumer of the changed todl public API.

**Tech Stack:** TypeScript (ESM, strict), `node:test` via `tsx` (todl-runtime + todl), vitest (Plexus), mural (`@pragmatic-tech-ai/mural/runtime` non-UI primitives), `@pragmatic-tech-ai/todl-runtime`.

**Spec:** `docs/superpowers/specs/2026-09-18-engine-presentation-separation-principles.md` and `docs/superpowers/specs/2026-09-18-engine-presentation-communication-architecture.md`

## Global Constraints

- **Naming (user CLAUDE.md):** all interfaces and public methods/properties PascalCase (`Ask`, `Confirm`, `Status`; `IPromptService`, `INotificationService`). Serialized-data shapes keep existing casing.
- **OOP, no globals:** helpers are class methods (private `static`); no module-level free functions or mutable module state. Module-level `const`/`type`/`class`/`interface`/`enum` are fine.
- **No seam bags:** cross-boundary collaborators are named interfaces resolved by `ServiceKey`, never closure bags.
- **P2 boundary (the point of the pilot):** files under `TODL/src/solution/engine/` must not import `@pragmatic-tech-ai/mural/framework` (the UI framework). `@pragmatic-tech-ai/mural/runtime` (ServiceBase, ObservableCollection, Observable) and `@pragmatic-tech-ai/todl-runtime` are allowed. One documented exception: `setting-bag-definition.ts` imports `SettingDefinition` (a schema type) — allowlisted as known debt.
- **Tests:** todl-runtime + todl tests use `node:test` + `node:assert/strict`, each file in a `tests/` subfolder next to its source. Plexus tests use `vitest`, also in `tests/` subfolders.
- **Commit per task** (the TDD rhythm below). Do not push. Do not publish npm packages — publishing is a user-gated outward action (Phase 3 uses local link/pack instead).

## Cross-repo build/link reality (read before Phase 2 & 3)

The three packages are **separate repos consumed as published copies**, not a workspace:
- `todl-runtime/` → `@pragmatic-tech-ai/todl-runtime` (built to `dist/`, entry = dist).
- `TODL/` → `@pragmatic-tech-ai/todl`; depends on `@pragmatic-tech-ai/todl-runtime@^0.5.4` (a real copy in `TODL/node_modules`, **not** a symlink — though `mural` there **is** symlinked).
- `Plexus/` consumes `@pragmatic-tech-ai/todl@^0.33.5` + `todl-runtime@^0.5.4` as real copies in `Plexus/node_modules`.

Because `tsx` runs TS **source** but resolves `@pragmatic-tech-ai/todl-runtime` to the **built dist** in `node_modules`, each hop needs a build + link. The bridge steps below make the updated upstream visible downstream via `npm run build` + a local symlink (matching how `mural` is already linked into TODL), never a publish.

---

## Phase 1 — communication primitives (todl-runtime)

### Task 1: `Ask<R>`, ask verbs, and `IPromptService`

**Files:**
- Create: `todl-runtime/src/prompt/ask.ts`
- Modify: `todl-runtime/src/index.ts`
- Test: `todl-runtime/src/prompt/tests/prompt.test.ts`

**Interfaces:**
- Consumes: nothing (pure new primitives).
- Produces: `abstract class Ask<TResponse>`; `class ConfirmAsk extends Ask<boolean>`, `PickFolderAsk extends Ask<string|undefined>`, `PickFileAsk extends Ask<string|undefined>`, `PromptTextAsk extends Ask<string|undefined>`, `ChooseAsk<T> extends Ask<T|undefined>`; `interface FileFilter { Name; Extensions }`; `interface Choice<T> { Label; Value }`; `interface IPromptService { Ask<R>(request: Ask<R>): Promise<R>; Confirm(...); PickFolder(...); PickFile(...); PromptText(...); Choose<T>(...) }`. All exported from the todl-runtime barrel.

- [ ] **Step 1: Write the failing test**

```ts
// todl-runtime/src/prompt/tests/prompt.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Ask, ConfirmAsk, PickFolderAsk, type IPromptService } from '../ask.js'

// A canned prompt service: dispatch by request type, return typed answers.
class FakePrompts implements IPromptService {
    constructor(private readonly confirm: boolean, private readonly folder: string | undefined) {}
    async Ask<R>(request: Ask<R>): Promise<R> {
        if (request instanceof ConfirmAsk) return this.confirm as R
        if (request instanceof PickFolderAsk) return this.folder as R
        throw new Error(`unhandled ${request.constructor.name}`)
    }
    Confirm(message: string, confirmLabel?: string): Promise<boolean> { return this.Ask(new ConfirmAsk(message, confirmLabel)) }
    PickFolder(title: string): Promise<string | undefined> { return this.Ask(new PickFolderAsk(title)) }
    PickFile(): Promise<string | undefined> { throw new Error('nyi') }
    PromptText(): Promise<string | undefined> { throw new Error('nyi') }
    Choose<T>(): Promise<T | undefined> { throw new Error('nyi') }
}

test('Ask dispatches by request type and returns the typed response', async () => {
    const p = new FakePrompts(true, 'C:/x')
    const ok: boolean = await p.Ask(new ConfirmAsk('Discard?', 'Discard'))
    assert.equal(ok, true)
    const dir: string | undefined = await p.Ask(new PickFolderAsk('Open'))
    assert.equal(dir, 'C:/x')
})

test('Confirm helper delegates to Ask', async () => {
    assert.equal(await new FakePrompts(false, undefined).Confirm('x'), false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `todl-runtime/`): `npx tsx --conditions=development --test "src/prompt/tests/prompt.test.ts"`
Expected: FAIL — `Cannot find module '../ask.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// todl-runtime/src/prompt/ask.ts

// A request the engine makes of the host that carries its response type. Concrete
// asks subclass this; the phantom marker keeps two asks with different response
// types from being structurally identical (so Ask<R> inference works).
export abstract class Ask<TResponse> {
    /** Phantom marker binding the response type; never assigned or read. */
    declare readonly _response: TResponse
}

// A file-type filter for a pick-file ask (leading-dot-free extensions).
export interface FileFilter { readonly Name: string; readonly Extensions: readonly string[] }

// One selectable option for a Choose ask.
export interface Choice<T> { readonly Label: string; readonly Value: T }

// Confirm a yes/no decision (defaults to OK). Response: the user's yes/no.
export class ConfirmAsk extends Ask<boolean> {
    constructor(readonly Message: string, readonly ConfirmLabel: string = 'OK', readonly Title?: string) { super() }
}
// Pick a folder. Response: the chosen path, or undefined if cancelled.
export class PickFolderAsk extends Ask<string | undefined> {
    constructor(readonly Title: string) { super() }
}
// Pick a file, optionally filtered. Response: the chosen path, or undefined.
export class PickFileAsk extends Ask<string | undefined> {
    constructor(readonly Title: string, readonly Filters?: readonly FileFilter[]) { super() }
}
// Prompt for a line of text. Response: the entered text, or undefined if cancelled.
export class PromptTextAsk extends Ask<string | undefined> {
    constructor(readonly Label: string, readonly Initial?: string) { super() }
}
// Choose one of a set of options. Response: the chosen value, or undefined.
export class ChooseAsk<T> extends Ask<T | undefined> {
    constructor(readonly Title: string, readonly Options: readonly Choice<T>[]) { super() }
}

// The host service the engine resolves by ServiceKey to ask the user something.
// A UI host implements it over dialogs/pickers, a test mocks it, a CLI over stdio.
// Ask is the generic channel; the rest are typed convenience wrappers over it.
export interface IPromptService {
    Ask<R>(request: Ask<R>): Promise<R>
    Confirm(message: string, confirmLabel?: string): Promise<boolean>
    PickFolder(title: string): Promise<string | undefined>
    PickFile(title: string, filters?: readonly FileFilter[]): Promise<string | undefined>
    PromptText(label: string, initial?: string): Promise<string | undefined>
    Choose<T>(title: string, options: readonly Choice<T>[]): Promise<T | undefined>
}
```

- [ ] **Step 4: Export from the barrel**

Add to `todl-runtime/src/index.ts` (after the `Signal` export):

```ts
export {
    Ask, ConfirmAsk, PickFolderAsk, PickFileAsk, PromptTextAsk, ChooseAsk,
    type FileFilter, type Choice, type IPromptService,
} from './prompt/ask.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `todl-runtime/`): `npx tsx --conditions=development --test "src/prompt/tests/prompt.test.ts"`
Expected: PASS (both).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Build (so downstream repos can consume it)**

Run (from `todl-runtime/`): `npm run build`
Expected: `dist/prompt/ask.js` + `.d.ts` emitted; build succeeds.

- [ ] **Step 7: Commit**

```bash
git -C todl-runtime add src/prompt/ask.ts src/prompt/tests/prompt.test.ts src/index.ts
git -C todl-runtime commit -m "feat(runtime): add Ask<R> + IPromptService prompt primitives"
```

---

## Phase 2 — reband the solution subsystem (TODL)

### Task 2: Bridge the updated todl-runtime into TODL

**Files:** none (environment link).

**Interfaces:**
- Consumes: the built `todl-runtime` dist from Task 1.
- Produces: `import { Ask } from '@pragmatic-tech-ai/todl-runtime'` resolves inside TODL.

- [ ] **Step 1: Link the updated runtime into TODL**

`TODL/node_modules/@pragmatic-tech-ai/todl-runtime` is currently a real copy (0.5.4). Replace it with a symlink to the sibling repo, matching how `mural` is already linked there:

```bash
rm -rf "TODL/node_modules/@pragmatic-tech-ai/todl-runtime"
ln -s "$(pwd)/todl-runtime" "TODL/node_modules/@pragmatic-tech-ai/todl-runtime"
```

(If the repo uses `npm link` instead of raw symlinks, use `npm link` from `todl-runtime/` then `npm link @pragmatic-tech-ai/todl-runtime` from `TODL/` — the effect is the same. Ensure `todl-runtime` was built in Task 1 Step 6, since TODL resolves it to `dist`.)

- [ ] **Step 2: Verify the new symbols resolve**

Run (from `TODL/`): `npx tsx --conditions=development -e "import('@pragmatic-tech-ai/todl-runtime').then(m => { if (typeof m.ConfirmAsk !== 'function') throw new Error('ConfirmAsk missing'); console.log('ok') })"`
Expected: prints `ok`.
Run (from `TODL/`): `npm test`
Expected: the existing todl suite still passes (link didn't break resolution).

- [ ] **Step 3: Commit** (records the link intent via a note; the symlink itself is gitignored `node_modules`)

No file change to commit. Proceed — this task is a verified environment gate, not a code change.

---

### Task 3: Scaffold `engine/` + `presentation/` and move the files

**Files:**
- Move (git mv) all of `TODL/src/solution/*.ts` into `engine/` or `presentation/` per the map below; move their tests into the matching `tests/` subfolder.
- Modify: `TODL/src/index.ts` (barrel paths).

**Move map** (`TODL/src/solution/` → subfolder):

*engine/*: `solution-manager-service.ts`, `solution-view-service.ts`, `solution-session.ts`, `solution-manifest.ts`, `solution-member.ts`, `solution-member-ref.ts`, `host-services.ts`, `project-factory.ts`, `solution-settings-registry.ts`, `solution-setting-bag.ts`, `setting-bag-definition.ts`

*presentation/*: `solution-tree-vm.ts`, `setting-bag-grid.ts`

*tests* move alongside: engine tests (`solution-manager-service.test.ts`, `solution-view-service.test.ts`, `solution-session.test.ts`, `solution-manifest.test.ts`, `solution-settings-registry.test.ts`, `solution-settings-values.test.ts`, `open-members.test.ts`, `fake-project-factory.ts`) → `engine/tests/`; presentation tests (`solution-tree-vm.test.ts`, `setting-bag-grid.test.ts`) → `presentation/tests/`.

**Interfaces:** no symbol changes — a pure move. The barrel keeps the same public exports (from new paths), so **no downstream consumer breaks**.

- [ ] **Step 1: Create folders and move sources**

```bash
cd TODL/src/solution
mkdir -p engine/tests presentation/tests
git mv solution-manager-service.ts solution-view-service.ts solution-session.ts solution-manifest.ts \
       solution-member.ts solution-member-ref.ts host-services.ts project-factory.ts \
       solution-settings-registry.ts solution-setting-bag.ts setting-bag-definition.ts engine/
git mv solution-tree-vm.ts setting-bag-grid.ts presentation/
git mv tests/solution-manager-service.test.ts tests/solution-view-service.test.ts tests/solution-session.test.ts \
       tests/solution-manifest.test.ts tests/solution-settings-registry.test.ts tests/solution-settings-values.test.ts \
       tests/open-members.test.ts tests/fake-project-factory.ts engine/tests/
git mv tests/solution-tree-vm.test.ts tests/setting-bag-grid.test.ts presentation/tests/
rmdir tests 2>/dev/null || true
```

- [ ] **Step 2: Fix import depths**

Files moved one level deeper, so imports that reached **sibling todl modules** gain one `../`:
- `../domain/domain.js` → `../../domain/domain.js`
- `../diagnostics/diagnostic.js` → `../../diagnostics/diagnostic.js`

Intra-band relative imports (`./solution-member.js`, etc.) stay `./` **within the same band folder**. The one cross-band import — `presentation/solution-tree-vm.ts` imports `SolutionViewService` from the engine — becomes `../engine/solution-view-service.js`. Tests under `engine/tests/` import their source as `../solution-manager-service.js` (already correct after the move). Let the TypeScript compiler drive: run `npm run typecheck` and fix each unresolved path per these rules.

- [ ] **Step 3: Update the barrel** — in `TODL/src/index.ts`, retarget the solution exports (lines ~139–160) to the new paths, keeping the exact same exported symbols:

```ts
// ── Solution (SolutionManager + cross-project settings) ──
export { SolutionManagerService } from "./solution/engine/solution-manager-service.js";
export {
  type IStorageProviderRegistry,
  type IProjectFactoryRegistry,
  type IDiscardConfirmer,
} from "./solution/engine/host-services.js";
export { SolutionSettingsRegistry } from "./solution/engine/solution-settings-registry.js";
export { SettingBagDefinition } from "./solution/engine/setting-bag-definition.js";
export { SolutionSettingBag } from "./solution/engine/solution-setting-bag.js";
export { SolutionViewService } from "./solution/engine/solution-view-service.js";
export { SolutionSession } from "./solution/engine/solution-session.js";
export { SolutionMember } from "./solution/engine/solution-member.js";
export { SolutionManifest } from "./solution/engine/solution-manifest.js";
export { type SolutionMemberRef, SolutionPath } from "./solution/engine/solution-member-ref.js";
export { SolutionTreeVM, SolutionNodeVM, SolutionMemberNodeVM, type MemberStorageFor } from "./solution/presentation/solution-tree-vm.js";
export { SettingBagGrid } from "./solution/presentation/setting-bag-grid.js";
export {
  type IProjectFactory,
  type MemberStorageResolver,
  type ProjectFactoryResolver,
} from "./solution/engine/project-factory.js";
```

(Keep whatever the current lines 156–160 name for `project-factory` — copy the exact symbol list from the pre-move barrel.)

- [ ] **Step 4: Typecheck + full suite**

Run (from `TODL/`): `npm run typecheck`
Expected: no errors.
Run: `npm test`
Expected: the whole solution suite passes from its new locations (pure move — no behavior change).

- [ ] **Step 5: Commit**

```bash
git -C TODL add -A src/solution src/index.ts
git -C TODL commit -m "refactor(solution): split into engine/ + presentation/ bands (pure move)"
```

---

### Task 4: Rename `SolutionViewService → Solution`

**Files:**
- Rename: `TODL/src/solution/engine/solution-view-service.ts` → `solution.ts`; rename its test `engine/tests/solution-view-service.test.ts` → `solution.test.ts`.
- Modify: `engine/solution-manager-service.ts`, `presentation/solution-tree-vm.ts`, `TODL/src/index.ts`, and every test referencing the old name.

**Interfaces:**
- Produces: `class Solution extends Observable` (was `SolutionViewService`) — same members (`Name`/`IsDirty`/`Storage`/`Members`/`SettingBags`/`AddMember`/`RemoveMember`/`OpenMembers`/`LoadSettings`/`BindBags`/`CollectSettings`). Barrel now exports `Solution`.
- Consumes: nothing new.

- [ ] **Step 1: Rename the file + class**

```bash
git -C TODL mv src/solution/engine/solution-view-service.ts src/solution/engine/solution.ts
git -C TODL mv src/solution/engine/tests/solution-view-service.test.ts src/solution/engine/tests/solution.test.ts
```

In `solution.ts`, rename the class `SolutionViewService` → `Solution` and update the leading comment ("The authoritative model of an open solution the SolutionManagerService owns — its name, storage, ordered members, cross-project setting bags, and dirty flag. Extends Observable so the View binds Name/IsDirty/Members. Not a view: the projection VMs live in the presentation band.").

- [ ] **Step 2: Update all references**

- `engine/solution-manager-service.ts`: `import { Solution } from './solution.js'`; every `SolutionViewService` → `Solution` (the field type `activeSolution: Solution | undefined`, `ActiveSolution(): Solution | undefined`, `setActive(s: Solution | undefined)`, and the three `new SolutionViewService(...)` → `new Solution(...)`).
- `presentation/solution-tree-vm.ts`: `import { type Solution } from '../engine/solution.js'`; the `SolutionTreeVM` constructor param `session: SolutionViewService` → `session: Solution`.
- `TODL/src/index.ts`: `export { Solution } from "./solution/engine/solution.js";` (replacing the `SolutionViewService` line).
- Every engine/presentation test that constructs `new SolutionViewService(...)` → `new Solution(...)` and updates the import.

- [ ] **Step 3: Typecheck + suite**

Run (from `TODL/`): `npm run typecheck` → no errors.
Run: `npm test` → all pass.

- [ ] **Step 4: Commit**

```bash
git -C TODL add -A src/solution src/index.ts
git -C TODL commit -m "refactor(solution): rename SolutionViewService → Solution (engine model)"
```

---

### Task 5: Refit the manager onto `IPromptService`; delete `IDiscardConfirmer`

**Files:**
- Modify: `engine/host-services.ts` (remove `IDiscardConfirmer`), `engine/solution-manager-service.ts`, `engine/tests/solution-manager-service.test.ts`, `TODL/src/index.ts` (drop `IDiscardConfirmer`; add the prompt re-exports).

**Interfaces:**
- Produces: `SolutionManagerService.PromptServiceKey: ServiceKey<IPromptService>` (replaces `DiscardConfirmerKey`). `canReplace()` now awaits `this.prompts.Ask(new ConfirmAsk(...))`. Barrel re-exports the prompt vocabulary from todl-runtime.
- Consumes: `Ask`, `ConfirmAsk`, `IPromptService` from `@pragmatic-tech-ai/todl-runtime` (Task 1).

- [ ] **Step 1: Update the manager test first (drive the change)**

In `engine/tests/solution-manager-service.test.ts`, wherever the fake `IDiscardConfirmer` is registered under `DiscardConfirmerKey`, replace it with a fake `IPromptService` under `PromptServiceKey`. Add a focused test:

```ts
import { Ask, ConfirmAsk, type IPromptService } from '@pragmatic-tech-ai/todl-runtime'

// A prompt whose ConfirmAsk answer is scripted; records that it was asked.
class ScriptedPrompts implements IPromptService {
    public asked = 0
    constructor(private readonly confirm: boolean) {}
    async Ask<R>(request: Ask<R>): Promise<R> { if (request instanceof ConfirmAsk) { this.asked++; return this.confirm as R } throw new Error('unhandled') }
    Confirm(m: string, c?: string): Promise<boolean> { return this.Ask(new ConfirmAsk(m, c)) }
    PickFolder(): Promise<string | undefined> { throw new Error('nyi') }
    PickFile(): Promise<string | undefined> { throw new Error('nyi') }
    PromptText(): Promise<string | undefined> { throw new Error('nyi') }
    Choose<T>(): Promise<T | undefined> { throw new Error('nyi') }
}

test('a dirty solution asks to discard before it is replaced', async () => {
    const prompts = new ScriptedPrompts(false)   // user declines
    const mgr = /* construct with the existing harness, registering:
        StorageRegistryKey, ProjectFactoryRegistryKey, PackageSourceKey as today,
        and PromptServiceKey → prompts (instead of DiscardConfirmerKey) */ makeManager(prompts)
    await mgr.NewSolution('C:/a')
    mgr.ActiveSolution!.IsDirty = true
    await mgr.NewSolution('C:/b')                 // should be blocked by the declined discard
    assert.equal(prompts.asked, 1)
    assert.equal(mgr.ActiveSolution!.Storage.Root, 'C:/a')   // unchanged — replace was refused
})
```

Adapt `makeManager` to the file's existing construction helper (register the same three capability seams it already registers, swapping `DiscardConfirmerKey`→`PromptServiceKey`).

- [ ] **Step 2: Run to verify it fails**

Run (from `TODL/`): `npx tsx --conditions=development --test "src/solution/engine/tests/solution-manager-service.test.ts"`
Expected: FAIL — `PromptServiceKey` does not exist.

- [ ] **Step 3: Remove `IDiscardConfirmer` from `host-services.ts`**

Delete the `IDiscardConfirmer` interface (lines 23–28) and its leading comment. Leave `IStorageProviderRegistry` + `IProjectFactoryRegistry` untouched.

- [ ] **Step 4: Refit the manager**

In `engine/solution-manager-service.ts`:
- Imports: drop `type IDiscardConfirmer` from the `host-services.js` import; add `import { Ask, ConfirmAsk, type IPromptService } from '@pragmatic-tech-ai/todl-runtime'`. (`Ask` may be unused directly — keep only what compiles; likely just `ConfirmAsk, type IPromptService`.)
- Replace the key:
  ```ts
  public static readonly PromptServiceKey =
      new ServiceKey<IPromptService>('SolutionPromptService')
  ```
  (delete the `DiscardConfirmerKey` static).
- Replace the field + resolution:
  ```ts
  private readonly prompts: IPromptService
  // …in ctor:
  this.prompts = provider.getRequired(SolutionManagerService.PromptServiceKey)
  ```
  (delete `confirmer`).
- Replace `canReplace()`'s confirm call:
  ```ts
  private async canReplace(): Promise<boolean> {
      const s = this.ActiveSolution
      if (s === undefined || !s.IsDirty) return true
      return this.prompts.Ask(new ConfirmAsk('The current solution has unsaved changes. Discard them?', 'Discard'))
  }
  ```

- [ ] **Step 5: Update the barrel**

In `TODL/src/index.ts`: remove `type IDiscardConfirmer` from the `host-services.js` export block. Add a prompt re-export (so app consumers import the vocabulary from todl, matching how `Signal` is re-exported):

```ts
export {
  Ask, ConfirmAsk, PickFolderAsk, PickFileAsk, PromptTextAsk, ChooseAsk,
  type FileFilter, type Choice, type IPromptService,
} from "@pragmatic-tech-ai/todl-runtime";
```

- [ ] **Step 6: Run tests to verify they pass**

Run (from `TODL/`): `npm run typecheck` → no errors.
Run: `npm test` → all pass (the new discard test included).

- [ ] **Step 7: Commit**

```bash
git -C TODL add -A src/solution src/index.ts
git -C TODL commit -m "refactor(solution): replace IDiscardConfirmer seam with IPromptService"
```

---

### Task 6: `INotificationService` + one wired emission

**Files:**
- Create: `engine/notification-service.ts`
- Modify: `engine/solution-manager-service.ts`, `engine/tests/solution-manager-service.test.ts`, `TODL/src/index.ts`

**Interfaces:**
- Produces: `interface INotificationService { Status(message: string): void; Progress(operation: string, done: number, total: number): void; Report(owner: string, diagnostics: readonly Diagnostic[]): void }`; `SolutionManagerService.NotificationServiceKey: ServiceKey<INotificationService>` (resolved **optionally**). `Save()` emits `Status('Saved.')` when a notifier is registered.
- Consumes: `Diagnostic` from `../../diagnostics/diagnostic.js`.

- [ ] **Step 1: Write the failing test** (append to the manager test)

```ts
import { type INotificationService } from '../notification-service.js'

class RecordingNotifier implements INotificationService {
    public statuses: string[] = []
    Status(m: string): void { this.statuses.push(m) }
    Progress(): void {}
    Report(): void {}
}

test('Save emits a Saved status when a notifier is registered', async () => {
    const notifier = new RecordingNotifier()
    const mgr = makeManager(new ScriptedPrompts(true), notifier)   // harness registers NotificationServiceKey → notifier
    await mgr.NewSolution('C:/a')
    await mgr.Save()
    assert.deepEqual(notifier.statuses, ['Saved.'])
})

test('Save works with no notifier registered', async () => {
    const mgr = makeManager(new ScriptedPrompts(true))   // no notifier
    await mgr.NewSolution('C:/a')
    await mgr.Save()   // must not throw
})
```

Extend `makeManager` to optionally register `SolutionManagerService.NotificationServiceKey → notifier` when one is passed.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — `notification-service.js` / `NotificationServiceKey` missing.

- [ ] **Step 3: Implement the interface**

```ts
// engine/notification-service.ts
import { type Diagnostic } from '../../diagnostics/diagnostic.js'

// Ambient feedback the engine emits and the host displays — status/progress/
// diagnostics that are NOT a change to a Manager's own model. A UI host renders
// these on the status strip / Problems dock; a test records them; a CLI writes to
// the console. Resolved OPTIONALLY by the engine — a headless batch may run without
// one. State-change is NOT here: that is the Manager's own PropertyChanged.
export interface INotificationService {
    Status(message: string): void
    Progress(operation: string, done: number, total: number): void
    Report(owner: string, diagnostics: readonly Diagnostic[]): void
}
```

- [ ] **Step 4: Wire the manager (optional resolve + one emission)**

In `engine/solution-manager-service.ts`:
- `import { type INotificationService } from './notification-service.js'`.
- Add the key:
  ```ts
  public static readonly NotificationServiceKey =
      new ServiceKey<INotificationService>('SolutionNotificationService')
  ```
- Field + optional resolve (note `provider.get`, not `getRequired`):
  ```ts
  private readonly notifications: INotificationService | undefined
  // …in ctor:
  this.notifications = provider.get(SolutionManagerService.NotificationServiceKey)
  ```
- In `Save()`, after `s.IsDirty = false; this.pushRecent(s.Storage.Root)`:
  ```ts
  this.notifications?.Status('Saved.')
  ```

- [ ] **Step 5: Export from the barrel**

In `TODL/src/index.ts`, add:
```ts
export { type INotificationService } from "./solution/engine/notification-service.js";
```

- [ ] **Step 6: Run tests + typecheck**

Run (from `TODL/`): `npm run typecheck` → no errors.
Run: `npm test` → all pass.

- [ ] **Step 7: Commit**

```bash
git -C TODL add -A src/solution src/index.ts
git -C TODL commit -m "feat(solution): add INotificationService; emit Saved status"
```

---

### Task 7: Enforce the engine boundary + drop `IActivatable` from the manager

**Files:**
- Modify: `engine/solution-manager-service.ts` (remove `IActivatable`/`OnActivated`).
- Create: `engine/tests/engine-boundary.test.ts`

**Interfaces:** no public change. `SolutionManagerService` no longer implements `IActivatable` (its `OnActivated` was a no-op placeholder). The boundary test is the P2 acceptance proof.

- [ ] **Step 1: Write the failing boundary test**

```ts
// engine/tests/engine-boundary.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// P2: no engine file may import the UI framework (@pragmatic-tech-ai/mural/framework).
// mural/runtime (ServiceBase, ObservableCollection) and todl-runtime are allowed.
// setting-bag-definition.ts is the single documented exception (imports the
// SettingDefinition schema type — known debt to relocate to runtime).
const ALLOWLIST = new Set(['setting-bag-definition.ts'])

test('no engine file imports the mural UI framework', () => {
    const engineDir = dirname(dirname(fileURLToPath(import.meta.url)))   // …/engine
    const offenders: string[] = []
    for (const name of readdirSync(engineDir)) {
        if (!name.endsWith('.ts')) continue
        if (ALLOWLIST.has(name)) continue
        const text = readFileSync(join(engineDir, name), 'utf8')
        if (text.includes('@pragmatic-tech-ai/mural/framework')) offenders.push(name)
    }
    assert.deepEqual(offenders, [], `engine files importing the UI framework: ${offenders.join(', ')}`)
})
```

- [ ] **Step 2: Run to verify it fails**

Run (from `TODL/`): `npx tsx --conditions=development --test "src/solution/engine/tests/engine-boundary.test.ts"`
Expected: FAIL — `solution-manager-service.ts` still imports `IActivatable` from `@pragmatic-tech-ai/mural/framework`.

- [ ] **Step 3: Drop `IActivatable` from the manager**

In `engine/solution-manager-service.ts`:
- Remove `import { type IActivatable } from '@pragmatic-tech-ai/mural/framework'`.
- Remove `implements IActivatable` from the class declaration.
- Remove the `OnActivated(): void { /* … */ }` method (it was a no-op placeholder; activation is a presentation-band concern per the spec).

- [ ] **Step 4: Run to verify it passes + full suite**

Run (from `TODL/`): `npx tsx --conditions=development --test "src/solution/engine/tests/engine-boundary.test.ts"` → PASS.
Run: `npm run typecheck` → no errors.
Run: `npm test` → all pass.
Run (from `TODL/`): `npm run build` → dist emitted (so Phase 3 can consume the new todl).

- [ ] **Step 5: Commit**

```bash
git -C TODL add -A src/solution
git -C TODL commit -m "refactor(solution): drop IActivatable from engine; enforce no-UI boundary"
```

---

## Phase 3 — coordinated devUI update (gated on making the new todl available to Plexus)

> **Gate:** Phases 1–2 are the self-contained pilot and stand alone. This phase only keeps the downstream consumer compiling against the changed todl API (removed `IDiscardConfirmer`). It requires the updated `todl` + `todl-runtime` to be visible to Plexus. **Do not publish** — use a local link/pack. Publishing (the eventual real release) is a user decision.

### Task 8: Bridge new todl into Plexus + swap devUI's discard seam for a prompt service

**Files:**
- Environment: link/pack `todl-runtime` + `todl` into `Plexus/node_modules`.
- Modify: `apps/devUI/src/renderer/modules/solution/solution-services.ts`
- (No change needed to `solution-explorer-service.ts` / `solution.resources.mu`: `SolutionTreeVM`/`SolutionMemberNodeVM` are still exported from the todl barrel after the move, and nothing imports `SolutionViewService` by name.)

**Interfaces:**
- Produces: `DialogPromptService implements IPromptService` (app-side); registered under `SolutionManagerService.PromptServiceKey`.
- Consumes: `Ask`, `ConfirmAsk`, `PickFolderAsk`, `type IPromptService` from `@pragmatic-tech-ai/todl`; `SolutionManagerService`, `IStorageProviderRegistry`, `IProjectFactoryRegistry`, `IProjectFactory` from `@pragmatic-tech-ai/todl`.

- [ ] **Step 1: Make the new todl visible to Plexus (local link)**

```bash
# both built already (Task 1 Step 6, Task 7 Step 4)
rm -rf "Plexus/node_modules/@pragmatic-tech-ai/todl-runtime" "Plexus/node_modules/@pragmatic-tech-ai/todl"
ln -s "$(pwd)/todl-runtime" "Plexus/node_modules/@pragmatic-tech-ai/todl-runtime"
ln -s "$(pwd)/TODL"         "Plexus/node_modules/@pragmatic-tech-ai/todl"
```

(If the team prefers tarballs over symlinks: `npm pack` in each repo, then `npm i ./<tarball>.tgz` in `Plexus/`. Either way, no registry publish.)

Verify: `node -e "const m=require('./Plexus/node_modules/@pragmatic-tech-ai/todl'); if(typeof m.ConfirmAsk!=='function') throw new Error('ConfirmAsk missing'); if(m.IDiscardConfirmer!==undefined) throw new Error('IDiscardConfirmer should be gone'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 2: Rewrite `solution-services.ts`** — replace the discard confirmer with a prompt service:

```ts
import { type IServiceContainer } from "@pragmatic-tech-ai/mural/runtime";
import { DialogService } from "@pragmatic-tech-ai/mural/framework";
import {
  SolutionManagerService,
  Ask, ConfirmAsk, PickFolderAsk,
  type IPromptService,
  type IStorageProviderRegistry,
  type IProjectFactoryRegistry,
  type IProjectFactory,
} from "@pragmatic-tech-ai/todl";
import { StorageService } from "@pragmatic-tech-ai/plexus-core/renderer/modules/storage";
import { ConfirmDialog } from "../../services/dialogs/confirm-dialog.js";
import { RegistryClient } from "../../services/registry/registry-client.js";
import { IpcPackageSource } from "./ipc-package-source.js";
import { TodlPackageProjectFactory, TODL_PACKAGE_TYPE } from "./todl-package-project-factory.js";

// Resolves a project type id to the factory that opens it. devUI ships one type.
export class TodlProjectFactoryRegistry implements IProjectFactoryRegistry {
  private readonly todlPackage = new TodlPackageProjectFactory();
  public factoryFor(typeId: string): IProjectFactory | undefined {
    return typeId === TODL_PACKAGE_TYPE ? this.todlPackage : undefined;
  }
}

// Answers the engine's user-decision asks over Mural dialogs / the registry
// directory picker. Implements the whole IPromptService; the pilot only needs
// Confirm (discard) + PickFolder — the rest resolve to undefined until a feature
// asks for them.
export class DialogPromptService implements IPromptService {
  constructor(private readonly dialogs: DialogService, private readonly registry: RegistryClient) {}

  async Ask<R>(request: Ask<R>): Promise<R> {
    if (request instanceof ConfirmAsk) {
      return (await ConfirmDialog.show(this.dialogs, {
        title: request.Title ?? "Confirm",
        message: request.Message,
        confirmLabel: request.ConfirmLabel,
      })) as R;
    }
    if (request instanceof PickFolderAsk) {
      const dir = await this.registry.pickDirectory();
      return (dir.length === 0 ? undefined : dir) as R;
    }
    throw new Error(`No prompt handler for ${request.constructor.name} (pilot scope)`);
  }
  Confirm(message: string, confirmLabel?: string): Promise<boolean> { return this.Ask(new ConfirmAsk(message, confirmLabel)); }
  PickFolder(title: string): Promise<string | undefined> { return this.Ask(new PickFolderAsk(title)); }
  PickFile(): Promise<string | undefined> { return Promise.resolve(undefined); }
  PromptText(): Promise<string | undefined> { return Promise.resolve(undefined); }
  Choose<T>(): Promise<T | undefined> { return Promise.resolve(undefined); }
}

// Registers the host services the SolutionManagerService resolves by key: the
// storage backend registry, the project-factory registry, the package source, and
// the prompt service (which replaces the former discard confirmer).
export class SolutionServicesRegistration {
  public static Register(services: IServiceContainer): void {
    services.register(
      SolutionManagerService.StorageRegistryKey,
      (p): IStorageProviderRegistry => p.getRequired(StorageService.Key),
    );
    services.register(
      SolutionManagerService.ProjectFactoryRegistryKey,
      (): IProjectFactoryRegistry => new TodlProjectFactoryRegistry(),
    );
    services.register(
      SolutionManagerService.PackageSourceKey,
      (p) => new IpcPackageSource(p.getRequired(RegistryClient)),
    );
    services.register(
      SolutionManagerService.PromptServiceKey,
      (p) => new DialogPromptService(p.getRequired(DialogService.Key), p.getRequired(RegistryClient)),
    );
  }
}
```

(The `DialogDiscardConfirmer` class and the `DiscardConfirmerKey` registration are deleted. `main.ts` still calls `SolutionServicesRegistration.Register(app.Services)` unchanged.)

> Verify `RegistryClient.pickDirectory()` returns `Promise<string>` (empty = cancelled) and `ConfirmDialog.show(dialogs, {title,message,confirmLabel})` returns `Promise<boolean>` against the current sources; adjust the two call sites if the signatures differ.

- [ ] **Step 3: Typecheck, test, build devUI**

Run (from `Plexus/`): `npm -w devUI run typecheck` → no errors (confirms the changed todl API resolves and `IDiscardConfirmer` is gone).
Run: `npm -w devUI exec vitest run` → PASS (the retained `ipc-package-source` / `todl-package-project-factory` tests still green).
Run: `npm -w devUI run build` → build succeeds.

- [ ] **Step 4: Manual smoke (record in the commit body)**: launch devUI, open Solutions, make a change (dirty), New/Open another → the discard prompt appears (now driven through `IPromptService.Ask(ConfirmAsk)`); Save → status reflects "Saved." if a notifier is later wired (none in the pilot — expected).

- [ ] **Step 5: Commit**

```bash
git -C Plexus add apps/devUI/src/renderer/modules/solution/solution-services.ts
git -C Plexus commit -m "refactor(devUI): drive solution discard through IPromptService (todl reband)"
```

---

## Self-review

**Spec coverage (communication-architecture spec):**
- `Ask<R>` + `IPromptService` + built-in verbs → Task 1. ✓
- `IPromptService` home = todl-runtime → Task 1. ✓
- `INotificationService` (needs `Diagnostic`) in todl → Task 6. ✓
- Manager off `IDiscardConfirmer` onto `IPromptService.Ask(ConfirmAsk)`; `IDiscardConfirmer` deleted → Task 5. ✓
- Capability seams unchanged (storage/factory/package) → untouched in Tasks 5–6. ✓
- State-change stays on the Manager (its `PropertyChanged`) → unchanged; not routed through notifications (Task 6 comment). ✓
- Seam taxonomy realized (capability = DI, user-decision = prompt, ambient = notify) → Tasks 5–6. ✓

**Spec coverage (principles spec):**
- P7 projection is presentation-band: `SolutionTreeVM` + `SettingBagGrid` moved out of the engine folder → Task 3. ✓
- P2 engine headless, enforced: boundary test + drop `IActivatable` → Task 7. ✓
- Rename the misbanded aggregate (`SolutionViewService` → `Solution`) → Task 4. ✓
- In-place reband inside todl (not cross-package) → Phase 2 keeps everything in `@pragmatic-tech-ai/todl`, barrel exports stable. ✓
- Testability acceptance (engine tests with fakes, no renderer) → Tasks 5–6 use `ScriptedPrompts`/`RecordingNotifier`. ✓

**Type consistency:** `Ask<R>` / `ConfirmAsk` / `PickFolderAsk` / `IPromptService` identical across Tasks 1, 5, 8. `PromptServiceKey` / `NotificationServiceKey` defined in Tasks 5/6, consumed in Task 8. `Solution` (Task 4) consumed by `solution-tree-vm.ts` + the manager. `INotificationService.Status/Progress/Report` stable Task 6 ↔ Task 8 note. ✓

**Placeholder scan:** every code/test step carries real content; no TBD/"handle errors"/"similar to". The one deliberate allowlist (`setting-bag-definition.ts`) is named and justified. ✓

**Executor-verify points (each has a fallback in-task):** (a) exact symbol list on the pre-move `project-factory` barrel line (Task 3 Step 3); (b) the manager test's existing construction helper name/shape (`makeManager`, Tasks 5–6); (c) `RegistryClient.pickDirectory` / `ConfirmDialog.show` signatures (Task 8 Step 2); (d) the repo's preferred link tooling (symlink vs `npm link` vs pack) for the two bridge steps.

**Deferred (not in this plan, per spec):** reveal/navigate (A5), cancellation (C4), the thin `PresentationView<TManager>` base, relocating `SettingDefinition` to runtime, and building the plexus-core solution *presentation* module (the earlier superseded plan).
