# Engine / Presentation Separation — Architecture Principles

**Status:** Principles ratified 2026-09-18. This spec fixes the *principles*; the
concrete supporting infrastructure (base classes / contracts / declarative
pairing, and its package home) is a separate follow-up spec.

**Goal:** Establish, as durable architecture principles, the separation between
**engine** services (that *do* things — authoritative, headless, testable) and
**presentation** services (that *display* things — derived, shell-bound). TODL's
solution management (`TODL/src/solution/`) is the reference implementation of this
pattern; these principles generalize it so every Plexus feature can be built the
same way.

**Scope:** These principles are normative for new feature work and for
refactors of existing features toward the split. They are the constitution the
follow-up infrastructure will scaffold and (where practical) enforce. This spec
does **not** choose the mechanism (base classes vs. conventions vs. a module
construct) or the package home of the generalized base — both are deferred to the
infrastructure spec (see Deferred).

## Context — the reference pattern

TODL's solution management is layered in three bands, wired only by DI keys and
change-notification:

- **Engine** (headless, authoritative): `SolutionManagerService` (owns the one
  active solution + lifecycle), `SolutionViewService` (state + mutating
  operations), `SolutionSession` (compose into a `Domain`). They announce
  transitions via `PropertyChanged` (`ActiveSolution`, `IsDirty`) and resolve
  host collaborators via `ServiceKey` seams (`StorageRegistryKey`,
  `ProjectFactoryRegistryKey`, `DiscardConfirmerKey`, `PackageSourceKey`).
- **Projection** (derived read-model): `SolutionTreeVM` /
  `SolutionMemberNodeVM` / `SolutionNodeVM` — a bindable view-shaped derivation
  of engine state (lazy).
- **Presentation** (app-side, shell-bound): a panel service that resolves the
  engine, subscribes to its `PropertyChanged`, rebuilds the projection, exposes
  `ICommand`s that call engine operations, and is rendered by
  `DataTemplate[DataType=Service]` via a `Capability`.

Today this layering is pure *convention*: nothing scaffolds or enforces it, and
every feature re-hand-wires the subscribe → project → command loop and the seam
keys. These principles make the convention a first-class, reusable thing.

## The principles

### P1 — One-way dependency
Presentation depends on Engine; **Engine never references Presentation**. The
panel resolves `SolutionManagerService`; the manager has no knowledge a panel
exists. This is what permits N presentations (panel, welcome page, agent tool,
CLI) over one engine.

### P2 — The engine is headless and portable
An engine service carries no UI: no `DataTemplate`, no `DialogService`, no shell,
no renderer type. It must run unchanged in a `node:test` and in a main-process /
CLI host with zero rendering. Its imports stop at runtime primitives
(`Observable`, `ObservableCollection`, `PropertyChanged`, `Signal`) + domain.
(`SolutionSession`'s "node-free … safe to run in the renderer" is this principle
stated locally.)

### P3 — Authority lives in the engine; presentation holds only view state
The single source of truth — active document/model, dirty flag, collection
membership, settings — is the engine's. Presentation owns only derived or
ephemeral state: selection, expansion, status strings, and the projected VMs.
There is never a second, independently-mutated copy of the truth.

### P4 — Transitions are announced, never pushed
On a state transition the engine raises a change notification
(`PropertyChanged`/`Signal`) and calls into nothing. Presentation subscribes and
re-projects. The engine stays ignorant of who — or how many — listen.

### P5 — Cross-boundary collaborators are DI seams, not lambda bags
Everything host-specific an engine needs (a storage backend, a factory registry,
a confirm dialog, a package source) is a **named interface resolved by
`ServiceKey`**, implemented at the composition root — never a bag of closures
passed in. (This is `host-services.ts`, and the standing "no seam bags" rule, as
one principle.)

### P6 — Presentation reaches the shell only through Capability → DataTemplate
A presentation service is surfaced by a `Capability` naming its `ServiceKey` and
rendered by `DataTemplate[DataType=Service]`. It changes authority **only** by
calling engine operations, surfaced as `ICommand`s. It never writes engine state
directly.

### P7 — The projection is a derived read-model, and it is presentation-band
The bindable VM tree is a pure function of engine state — rebuilt or reconciled
on notification, possibly lazy, never a source of truth. **Ruling:** projection
VMs belong to the *presentation* band, not the engine deliverable. (Consequence:
`SolutionTreeVM`, which currently ships inside the engine package `@pragmatic-tech-ai/todl`,
is on the wrong side of this line and is a candidate to relocate to a
presentation/shared-UI layer when the infrastructure lands. The principle holds
regardless of today's placement.)

### P8 — Placement follows reuse; testability is the acceptance test
Engine + seams live in the lowest package every consumer shares (the solution
engine in `@pragmatic-tech-ai/todl`); presentation is app-side / shell-bound; the
*generalized* base for both lives on the common floor of every consumer. The
acceptance test of the whole split: **an engine that cannot be fully tested
without a renderer means the split has leaked**, and a presentation that cannot
be tested against a fake engine means the boundary has leaked.

## What these principles buy

- **Multiple faces per capability** (P1/P4): a welcome page, a rail panel, an
  agent tool, and a CLI can all drive the same engine with no engine change.
- **Headless + testable cores** (P2/P8): engines run in CI and in the main
  process; behavior is proven without a UI harness.
- **Swappable hosts** (P5): the same engine runs over local FS or a remote
  backend, a real dialog or a test stub, by changing only composition-root
  registrations.
- **No authority drift** (P3): exactly one writer of truth removes the whole
  class of "the view and the model disagree" bugs.

## First consumer

The **Solutions** feature is the first application of these principles: reuse
TODL's shipped engine band (`SolutionManagerService` / `SolutionViewService` /
`SolutionSession` / settings) verbatim, and build the presentation band (panel
service + `.mu` views + host-seam implementations + member file-open) on the
infrastructure the follow-up spec designs. The earlier solution-explorer plan is
superseded by this reuse-first framing.

## Non-goals

- Not choosing the infrastructure's **mechanism** (base-class pair vs. contracts
  + conventions vs. a declarative module construct that pairs
  engine+presentation+seams+capability). → infrastructure spec.
- Not choosing the generalized base's **package home** (mural vs. plexus-core). →
  infrastructure spec (P8 gives the rule; the call is a mechanism decision).
- Not relocating `SolutionTreeVM` or otherwise refactoring TODL in this spec (P7
  records the boundary; the move is scheduled with the infrastructure).
- Not a lint/CI enforcement design; enforcement is a later concern once the
  contracts exist.

## Deferred to the infrastructure spec

- **Mechanism & shape** of the support: what an engine service and a presentation
  service formally *are* (base classes with a built-in subscribe→project→dispose
  loop? interfaces + light helpers? a `.mu` pairing construct?), and the
  projection toolkit for incremental read-model rebuilds.
- **Home** of the generalized base (mural is the only common floor of both todl
  and plexus, which argues for mural; to be confirmed).
- **Enforcement** (package boundaries / lint) that keeps engines headless (P2)
  and presentation stateless-of-authority (P3).
- **`SolutionTreeVM` relocation** consistent with P7.

## Acceptance criteria for the principles (how we know a feature complies)

1. The engine package builds and its tests pass with **no** dependency on a
   rendering/UI package (P2).
2. Deleting the presentation package leaves the engine and its tests intact (P1).
3. The presentation's tests construct it against a **fake engine** and never a
   real renderer (P8).
4. Grep of the engine package finds **no** `DataTemplate` / `DialogService` /
   shell imports (P2), and **no** closure-bag seam parameters — only `ServiceKey`
   resolutions (P5).
5. There is exactly one writer of each authoritative field, in the engine (P3).
