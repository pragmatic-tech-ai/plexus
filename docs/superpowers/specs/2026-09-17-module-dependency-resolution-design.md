# Module Dependency Resolution — Design

**Status:** Draft for review
**Date:** 2026-09-17
**Repo:** Plexus / Mural (the container + module system live in `@pragmatic-tech-ai/mural`)
**Canonical home:** GitHub Project #1, Kind=Spec (working copy for review)
**Companion to:** [Move Project Explorer to plexus-core](2026-09-17-project-explorer-to-plexus-core-design.md)
— that move is the forcing function for this design and lands on it.

## Goal

Give modules a first-class **`provides`** declaration, and make the service
provider **demand-driven**: when a service asks for a token that isn't registered
yet, the provider finds the module that *provides* that token, registers that
module, and resolves — transitively. A requirer never imports its providers, so a
module in `plexus-core` can depend on a capability implemented by a module in
`apps/plexus` without an upward import.

**No `requires` declaration.** A service resolves each dependency through `get`
at the moment it needs it, so the dependency graph builds itself naturally from
real `get` calls — there is nothing to declare up front. `provides` is the only
metadata the provider can't derive at a miss (it needs `token → module` *before*
registering that module). See "Why no `requires`" below.

## Motivation

Today a module's `.modules:` / `.services:` block records service registrations
(`AddRegistration`: a `token`, a lazy `ServiceFactory`, a `ServiceLifetime`) into
one global container, and any consumer resolves anything by `Provider.get(token)`.
There is:

- **no declared contract** for what a module provides vs requires,
- **no ordering** guarantee between interdependent modules,
- **no validation** that a required implementation was registered — a missing
  provider surfaces as a silent runtime `undefined` at first use.

This was fine while every module lived in one app and one composition root wired
everything eagerly. It breaks down the moment a requirer (`project-explorer` in
`plexus-core`) and its providers (feature modules in `apps/plexus`) live in
different packages: the wiring becomes cross-package and implicit, and "someone
forgot to register `ProblemsDock`" becomes a production `undefined`.

## Current state (what we build on)

- The container (`IServiceContainer` / the provider) already registers services
  as **token + lazy `ServiceFactory` + `ServiceLifetime`**, and `get(token)`
  builds the service on **first request**. Instantiation is already lazy and
  **synchronous**.
- Modules are declared with a `.modules:` block on the `Application`; the compiler
  lowers each module's `.services:` into `AddRegistration` calls.
- `Provider.get(token)` / `getRequired(token)` are used **synchronously** at
  hundreds of call-sites across all repos.

The gap is only that *all* module registrations run eagerly at composition, and
there is no provides-index — so resolution can't cross into a module that hasn't
been registered, and there's no contract to validate.

## Design: the demand-driven provider

### 1. Module provides header

Each module publishes a lightweight **header** that is readable **without running
the module body or building any service**:

- `provides`: the set of tokens this module can supply. These are the same tokens
  the module's `.services:` block already registers under, so the compiler emits
  them as module metadata — a small extension, no new authoring burden.
- `register()`: a **synchronous** thunk that performs this module's
  `AddRegistration` calls (adding lazy factories) — run on demand, at most once.

The header carries the `provides` metadata + the `register` thunk only. It does
**not** import or construct the module's services; those stay behind the lazy
factories `register` installs.

### Why no `requires`

A `requires` list would restate, up front, the dependencies each service already
expresses by calling `get(token)` at the point of need. That is duplicated
bookkeeping with only one payoff — a static "required capability has no provider"
check *before* first demand — and two costs: it can drift from the real `get`
calls, and it is authoring overhead on every module. We drop it. The dependency
graph is discovered **naturally** as services resolve each other on demand; a
genuinely missing dependency surfaces at the `getRequired` call that needs it,
with a diagnostic naming the token and the requirer (see Validation). The graph
is a consequence of resolution, not a thing anyone maintains.

### 2. Provides-index

At composition, the provider walks every declared module's header and builds:

- `providerOf: Map<token, module>` for **single-provider** tokens,
- `contributorsOf: Map<token, module[]>` for **multi-provider** contribution
  points (see Token kinds).

Building the index runs **no** `register` thunks — it only reads headers.

### 3. Resolution algorithm

```
get(token):
  if token already registered → build via its factory (as today) and return
  else if providerOf has token:
      run that module's register() (once)      # demand-driven module load
      build via the now-registered factory and return
  else:
      return undefined                          # optional dependency, absent

getRequired(token):
  r = get(token)
  if r === undefined → throw a diagnostic naming the missing token AND the
      requirer (so the error points at the unsatisfied contract, not a NPE)
```

Transitive resolution falls out for free: building A's service may `get(Y)`,
which loads module B, whose service may `get(Z)`, and so on. Lazy factories + the
index compose without special handling, as long as there is no construction cycle
(detected — see Validation).

### 4. Synchronous loading (DECIDED — 2026-09-17)

- **Sync (recommended).** Every module's *code* is statically present in the
  bundle; "loading" a module means running its synchronous `register` thunk on
  demand. **`get` stays synchronous** — every existing `getRequired(Key)`
  call-site is untouched. We make *registration* demand-driven, not *code
  loading*. This delivers the provider-finds-the-module behavior and the
  cross-package DI with **zero churn** to resolution call-sites.
- **Async (rejected for now).** A module's `register` is a dynamic `import()`
  (code not bundled until demanded). Saves bundle for never-used modules, but
  forces `get` to become `async` — a breaking ripple across every call-site in
  every repo. Only worth it if per-module bundle-splitting is itself a goal; a
  `warm(tokens): Promise<void>` prefetch step is a lighter middle ground that
  keeps `get` sync while allowing dynamic import where it pays.

**Decided: sync.** `get` stays synchronous; we make registration demand-driven,
not code-loading. The rest of this spec assumes it.

## Token kinds

The index must distinguish two shapes, because they validate and resolve
differently:

- **Single-provider service** — `PublishedBases`, `LiveValidation`,
  `ProblemsDock`, `DiagramTreeExport`, `ProjectMenuSource`. Exactly one module
  may provide it; two providers is an **error at index-build**. `get` returns the
  one instance (or `undefined` if optional and absent).
- **Multi-provider contribution point** — `NodeCommandContributor`,
  `NewFileParticipant`. Many modules may contribute; the consumer collects **all**
  providers. Resolution returns the list (possibly empty). No ambiguity error.

The header declares which kind each provided token is (or the token itself
carries its arity), so the index builds the right map.

## Declaration shape

The `provides` header must be readable without running the module body, so it
belongs on the **`module` block in `.mu`** (the compiler emits it as module
metadata alongside the existing `.services:` lowering), not inside a service
constructor. Illustrative (final syntax TBD in implementation):

```
module MetaModelModule [ Name = "Meta-models" ] {
    .provides: { PublishedBases }          // the public capability surface
    .services: { MetaModelsBackend, ... }  // the register() body
    Capability [ ... ]
}
```

`provides` names the tokens this module exposes for cross-module resolution —
the subset of its `.services:` registrations that are a public capability (a
module may register internal services it does not want other modules resolving
by token). A code-side header (a static on the module type) is an acceptable
alternative if the `.mu` route proves awkward; the only requirement is that the
metadata is available pre-registration.

## Optional vs required

- **Optional dependency:** consumer uses `get(token)` and tolerates `undefined`
  (the graceful-degrade pattern already in use — `HasExport`, `HasProjectMenu`,
  contributor gating). Absence is valid.
- **Required dependency:** consumer uses `getRequired(token)`; absence throws a
  diagnostic that names the missing capability and the requirer.

Missing-dependency detection is **at the demand**, not up front — the natural-
graph consequence of dropping `requires`. `getRequired` is the check.

## Validation

- **Ambiguity:** two modules `provides` the same single-provider token → error at
  index-build, listing both modules. Never last-wins. (This is the one check the
  `provides` index *can* do statically, since it reads all headers.)
- **Missing dependency:** `getRequired` on an unprovided token → thrown diagnostic
  (requirer + token), at the call that needs it.
- **Cycles:** a construction cycle (A's factory → get(B) → B's factory → get(A))
  is detected during resolution with a clear A→B→A trace, rather than a stack
  overflow.

## Backward compatibility & migration

- The existing **eager** path stays valid: a module with no `provides` header
  behaves as today (its `.services:` register eagerly at composition). Demand-
  driven loading is **opt-in** per module via the header.
- Migration is incremental: convert a module to a header + deferred `register`
  when we want it demand-driven (starting with the explorer's providers). No
  big-bang.
- `get` / `getRequired` signatures and semantics are unchanged for callers (sync,
  same return contract) — only the provider's internal miss-handling changes.

## Relationship to the Project Explorer move

The explorer move defines the **tokens**: `PublishedBases`, `LiveValidation`,
`BaseResolver`, `DiagramTreeExport`, `ProjectMenuSource`, `ProblemsDock`, plus the
`NodeCommandContributor` / `NewFileParticipant` contribution points. Under this
design:

- `plexus-core`'s `project-explorer` service simply calls `get(token)` for each;
  no `requires` declaration.
- Each `apps/plexus` feature module declares the matching `provides` and supplies
  the implementation.
- The provider wires them across the package boundary on demand as the explorer
  resolves them; core never imports app.

The move can proceed on the interim `Provider.get(Key)` idiom and adopt this
resolver as its providers migrate — or land directly on it. (Cross-referenced
decision in the companion spec.)

## Open questions

- Final `.mu` syntax for `provides`, and whether arity (single-provider vs
  contribution-point) is on the declaration or carried by the token itself.
- Scope of the index — one app-wide provider, or nested/scoped providers (per
  window / per document)? Start app-wide.

## Success criteria

- A module in `plexus-core` resolves a capability implemented by a module in
  `apps/plexus` with no upward import, via a `get(token)` that stays synchronous.
- A missing single-provider dependency fails with a diagnostic naming the token
  and requirer — never a silent `undefined` at a random later call.
- Duplicate single-providers and construction cycles are caught with clear errors.
- Existing eagerly-registered modules keep working unchanged (opt-in migration).

## Phasing (implementation plan to follow via writing-plans)

1. Provider: add the provides-index + demand-driven miss-handling (sync), keeping
   the eager path intact. Unit-tested in isolation.
2. Module header: `provides` metadata + deferred `register` thunk; compiler
   support for the `.mu` `.provides:` block (or the code-side header).
3. Token arity: single-provider vs contribution-point modelling + ambiguity and
   cycle diagnostics.
4. Migrate the Project Explorer's providers (meta-model, library, problems,
   diagram-export, skills) to headers; the explorer resolves them via `get`.
