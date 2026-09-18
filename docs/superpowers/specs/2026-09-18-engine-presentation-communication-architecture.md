# Engine / Presentation Communication Architecture

**Status:** Design converged 2026-09-18. Companion to
`2026-09-18-engine-presentation-separation-principles.md` — that spec fixes the
*principles*; this one fixes the *mechanism*: how an engine (`Manager`) and a
presentation (`View`) communicate, and the two new host services the pattern
introduces. Naming and package-home items flagged **(recommendation)** are open
for review.

**Goal:** Define the concrete communication architecture between the two bands so
every feature can be built the same way — a headless `I<X>Manager` engine paired
with an `I<X>View` presentation — with user-interaction and ambient feedback
factored into reusable host services rather than re-invented per feature.

## The pairing convention

Each capability is a pair of interfaces:

- **`I<X>Manager`** — the **engine**: authoritative, headless (P2), owns the model
  and the operations. Example: `ISolutionManager` (today `SolutionManagerService`).
- **`I<X>View`** — the **presentation**: shell-bound, rendered by
  `DataTemplate[DataType=View]` via a `Capability` (P6). Example: `ISolutionView`
  (the panel service).

The authoritative aggregate the Manager owns is a plain engine **model**, *not*
part of the pairing and never named `…View` (this is what today's misnamed
`SolutionViewService` actually is — renamed to `Solution`). The Manager manages a
`Solution`; the `View` observes the Manager.

## The five channels

All Manager↔View traffic reduces to five channels — every one is either a method
call or a DI-resolved service. **No raw signal crosses a band boundary.**

| # | Direction | Channel | Use-cases |
|---|-----------|---------|-----------|
| 1 | View → Manager | **Commands** — typed methods on `I<X>Manager`, wrapped as `ICommand` in the View | C: New/Open/Save/Close, Add/Remove member, Compose, Cancel |
| 2 | Manager → View | **State-change** — the Manager is observable (`PropertyChanged`); the View subscribes and re-projects | A1: active set/cleared, `IsDirty`, members, settings |
| 3 | Manager → View | **Queries** — the View reads the Manager's model to build the projection | D: read Members/Name/IsDirty/settings/recents |
| 4 | Manager → user | **`IPromptService`** — a DI host service; the engine awaits an answer | B: confirm, pick folder/file, choose, prompt text |
| 5 | Manager → host | **notification service** — a DI host service for ambient feedback | A2–A4: status, progress, diagnostics |

Channels 4–5 (and the capability seams) are the same *kind* of thing: named
service interfaces the engine resolves by `ServiceKey`. The View is **not** in the
path for channels 4–5 — asking the user and emitting status are host concerns the
engine reaches on its own, so they work with no View at all (a CLI, a batch run).

Reveal/navigate (A5 — "engine asks the View to expand/open something") is deferred;
it is genuinely Manager→View and will be modeled later (likely a small navigation
service or a View-owned reveal subscription). It is out of scope for the pilot.

## Channel 4 — `IPromptService` (asking the user)

A dedicated host service. The engine depends on it by `ServiceKey` like any
capability seam; the host implements it over dialogs/pickers, a test mocks it, a
CLI implements it over stdio. It **replaces** the family of one-question seams
(`IDiscardConfirmer`, a folder-pick seam, a type-pick seam) with one service.

Shape: a generic `Ask<R>` carrying typed request classes, plus a few convenience
helpers for the common verbs.

```ts
// todl-runtime (recommendation): a request that carries its response type.
export abstract class Ask<TResponse> {}

// Built-in ask verbs (todl-runtime): feature code may subclass Ask<R> for its own.
export class ConfirmAsk extends Ask<boolean> {
  constructor(readonly message: string, readonly confirmLabel = 'OK', readonly title?: string) { super() }
}
export class PickFolderAsk extends Ask<string | undefined> {
  constructor(readonly title: string) { super() }
}
export class PickFileAsk extends Ask<string | undefined> {
  constructor(readonly title: string, readonly filter?: FileFilter) { super() }
}
export class PromptTextAsk extends Ask<string | undefined> {
  constructor(readonly label: string, readonly initial?: string) { super() }
}
export class ChooseAsk<T> extends Ask<T | undefined> {
  constructor(readonly title: string, readonly options: readonly Choice<T>[]) { super() }
}

// The service the engine resolves by ServiceKey. Undefined = cancelled.
export interface IPromptService {
  Ask<R>(request: Ask<R>): Promise<R>
  // thin helpers over Ask (optional sugar):
  Confirm(message: string, confirmLabel?: string): Promise<boolean>
  PickFolder(title: string): Promise<string | undefined>
  PickFile(title: string, filter?: FileFilter): Promise<string | undefined>
  PromptText(label: string, initial?: string): Promise<string | undefined>
  Choose<T>(title: string, options: readonly Choice<T>[]): Promise<T | undefined>
}
```

Engine use (replaces `canReplace()`'s `confirmDiscard()`):

```ts
const discard = await this.prompts.Ask(new ConfirmAsk('Discard unsaved changes?', 'Discard'))
if (!discard) return
```

Host implementation dispatches by request type (over the existing Plexus
`DialogService` + `FileSystemService`):

```ts
export class DialogPromptService implements IPromptService {
  async Ask<R>(request: Ask<R>): Promise<R> {
    if (request instanceof ConfirmAsk)    return await this.confirm(request) as R
    if (request instanceof PickFolderAsk) return await this.fs.OpenFolder({ Title: request.title }) as R
    if (request instanceof PickFileAsk)   return await this.fs.OpenFile({ Title: request.title, Filters: /*…*/ }) as R
    if (request instanceof PromptTextAsk) return await this.promptText(request) as R
    if (request instanceof ChooseAsk)     return await this.choose(request) as R
    throw new Error(`No prompt handler for ${request.constructor.name}`)
  }
  Confirm(message, confirmLabel) { return this.Ask(new ConfirmAsk(message, confirmLabel)) }
  // …other helpers delegate to Ask the same way…
}
```

Test mock (headless — proves the engine needs no renderer):

```ts
class FakePrompts implements IPromptService {
  constructor(private readonly answers: Map<string, unknown>) {}
  async Ask<R>(request: Ask<R>): Promise<R> { return this.answers.get(request.constructor.name) as R }
  // helpers delegate to Ask
}
```

A feature adds a new interaction by defining an `Ask<R>` subclass and handling it
in the host dispatcher — **no interface change**, which is why the generic form
was chosen over a fixed method menu.

## Channel 5 — the notification service (ambient feedback)

A dedicated host service for status / progress / diagnostics — feedback that is
*not* a change to a specific Manager's model and often targets shell-level UI (the
status strip, the Problems dock). The engine emits; the host displays; a test
records; a CLI writes to the console.

```ts
export interface INotificationService {          // name: recommendation, see Open items
  Status(message: string): void                                        // transient status line
  Progress(operation: string, done: number, total: number): void       // long-op progress
  Report(owner: string, diagnostics: readonly Diagnostic[]): void       // problems (clears on empty)
}
```

`Report`'s `Diagnostic` is TODL's existing diagnostic type, so the *interface*
lives in the engine floor that has it (todl), while `Status`/`Progress` are
primitive. (See Open items — the interface may split if we keep `Ask<R>` in
todl-runtime but `Report` needs `Diagnostic`.)

## Channel 2 — state-change stays on the Manager

State-change is the Manager's own observability, not the notification service. The
Manager extends the observable base and raises `PropertyChanged` on transitions
(`ActiveSolution`, `IsDirty`, member add/remove). The View subscribes and calls a
single `Project()` to re-derive its bindable VMs from the Manager's model. Coarse
re-projection is fine for the pilot; incremental reconcile is a later toolkit
concern.

```ts
// In the View's activation:
this.sub = this.manager.PropertyChanged('ActiveSolution').subscribe(() => this.Project())
this.Project()   // initial
```

## The seam taxonomy (what this clarifies)

Every engine dependency now lands in exactly one bucket:

- **Capability seams** (DI `ServiceKey`) — the engine needs a *service to do work*:
  `IStorageProviderRegistry`, `IProjectFactoryRegistry`, `PackageSource`. Unchanged.
- **`IPromptService`** (DI) — the engine needs a *human decision*. Absorbs the old
  user-decision seams (`IDiscardConfirmer`, folder/type/name pickers).
- **`INotificationService`** (DI) — the engine needs to *report ambient feedback*.
- **State-change** — the engine's *own observable state* (not a seam).

An engine therefore depends only on DI-resolved service interfaces and exposes its
own observable model. That is directly testable (fakes for every seam, a mock
prompt, a recording notifier) — the acceptance test of P2/P8.

## Applied to Solutions (the pilot)

- `SolutionManagerService` → `ISolutionManager` (engine). Its `canReplace()` stops
  resolving `IDiscardConfirmer` and instead `await this.prompts.Ask(new ConfirmAsk(…))`.
  New/Open/Add-member pickers move from bespoke calls to `IPromptService`.
- `SolutionViewService` → `Solution` (engine model the Manager owns).
- `SolutionTreeVM` / `SettingBagGrid` → presentation band (leave the engine
  package), consumed by the new `ISolutionView`.
- `IDiscardConfirmer` seam → **deleted**, folded into `IPromptService`.
- `IStorageProviderRegistry` / `IProjectFactoryRegistry` / `PackageSource` →
  unchanged capability seams.
- The panel service (`ISolutionView`) resolves `ISolutionManager`, subscribes to
  `PropertyChanged('ActiveSolution')`, projects `SolutionTreeVM`, exposes commands,
  and reaches the user only through `IPromptService` / status only through
  `INotificationService`.

This is the in-place reband chosen for the pilot: engine and presentation split
into clear bands inside todl, with `Ask<R>` + the two service interfaces landing
in the shared runtime floor.

## Open items (for review)

- **Naming** of the notification service (`INotificationService` vs
  `IFeedbackService` vs `IStatusService`). Recommendation: `INotificationService`.
- **Home** of `Ask<R>` + `IPromptService` (recommendation: **todl-runtime**, beside
  `Signal`, dependency-free) and of `INotificationService` (todl, since `Report`
  needs `Diagnostic` — or split the diagnostic-carrying method out).
- **Thin View base?** Whether a small `PresentationView<TManager>` base class bakes
  the resolve→subscribe→`Project()`→dispose loop once (kills per-feature wiring), or
  the `I<X>View` convention is followed by hand. Leaning: a thin base, decided when
  the reband exposes the repeated wiring.
- **Reveal/navigate (A5)** — deferred; model after the pilot.
- **Cancellation** of long ops (C4) — a `CancellationToken`-style parameter on
  long Manager operations; designed when the first cancellable op (Compose) is
  built.

## Acceptance criteria

1. The engine resolves `IPromptService` / `INotificationService` / capability seams
   by `ServiceKey` and imports **no** dialog/renderer type (P2).
2. `IDiscardConfirmer` no longer exists; discard flows through `IPromptService.Ask`.
3. The Manager's tests run with a `FakePrompts` + a recording notifier + fake
   capability seams — no renderer (P8).
4. The View's tests run against a fake Manager and never a real prompt/dialog.
5. A new interaction is added by subclassing `Ask<R>` + one host dispatch arm — no
   interface edit.
