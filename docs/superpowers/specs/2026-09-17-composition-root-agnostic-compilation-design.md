# Composition-Root-Agnostic Compilation — Design

**Status:** Draft for review
**Date:** 2026-09-17
**Repo:** Mural (compiler) + todl-runtime (composition kernel)
**Canonical home:** GitHub Project #1, Kind=Spec (working copy for review)
**History:** Supersedes the "Module Dependency Resolution" draft. The demand-driven
`provides` / `registerDeferred` mechanism that draft proposed was evaluated and
**cut** (see "Cut: demand-driven resolution"). What survives is the compiler
decoupling below — and it is *independent of* the Project Explorer move, which
needs only plain DI.

## Goal

Let the compiler lower `.modules:` / `.services:` against **any** `CompositionRoot`,
not just mural's `Application`, so a console app, a service, or any host with its
own composition root can compose modules under it.

## Background — the kernel already exists

todl-runtime already owns the composition kernel, app-agnostic:

- `ServiceProvider` (`services/service-provider.ts`) — the DI container:
  `register(token, factory, lifetime)`, `get`/`getRequired`/`has`. **Eager
  registration, lazy instantiation**: registering only adds a lazy factory; `get`
  builds the instance on first request and caches (singleton).
- `IModule` (`composition/module.ts`) — `{ Targets, RegisterServices(container) }`.
- `CompositionRoot` (`composition/composition-root.ts`) — owns the root provider,
  catalogs modules, and on `AddModule` composes each admitted module **eagerly**
  (`ComposeModule` → `module.RegisterServices(Provider)`), `HostKind`-gated.

mural's `Application` **extends `CompositionRoot`**, overriding `ComposeModule` /
`CreateProvider` to also aggregate the shell's Capabilities + Resources.

The only thing bound to `Application` is the **compiler's emission**: inside an
`Application { }` element the compiler emits `app.AddModule(name)`
([compiler.ts:3697]) and `app.Services.register(…)` ([compiler.ts:1143]). But
`AddModule` / `Services` are `CompositionRoot` members — the coupling is purely
the emission *target*, not the machinery.

## Cut: demand-driven resolution

An earlier draft proposed making composition demand-driven: a `provides` header per
module, a `token → module` index on the provider, and `registerDeferred` so a
`get(token)` miss would find and register the providing module ("the graph builds
itself"). **Cut**, because:

- The container is already eager-register + lazy-instantiate, so nothing is *built*
  until `get`. Deferring the (trivial, map-insert) `RegisterServices` call buys
  essentially nothing.
- Cross-package DI needs only a **shared token** + **eager composition** (next
  section), both of which already work today.
- The provides-index still requires enumerating modules (via `.modules:`), so it
  doesn't even remove the module list — the thing it appeared to save.
- Its one genuine payoff — **runtime-discovered plugins** (modules not listed at
  build time) — is explicitly out of scope for now.

So: no `provides` header, no index, no `registerDeferred`, no `get`-miss path. The
container stays as-is.

## Cross-package DI needs no new mechanism

The motivating case — the Project Explorer in `plexus-core` resolving a capability
(`PublishedBases`, `LiveValidation`, …) implemented in `apps/plexus` — is plain DI:

1. the **token / interface** lives in a shared low place (`plexus-core`);
2. the app's feature module registers its implementation under that token;
3. the app's bootstrap composes both modules eagerly — it already lists them in its
   `.modules:` block.

`Provider.get(token)` resolves it. **The explorer move does not depend on this
spec** — it proceeds on shared tokens + the existing eager container. (See the
Project Explorer spec.)

## The change — retarget compiler emission

Decouple the compiler's composition output from the `Application` *class*:

- `.services:` already lowers against an `IServiceContainer` expression
  (`compileServicesBlock(providerExpr, …)`) — no change to the mechanism, only the
  expression it is handed.
- `.modules:` lowers to `${appVar}.AddModule(name)` — retarget `${appVar}` to a
  `CompositionRoot` expression.
- The `Application { }` element supplies itself as the root (back-compat). A
  non-mural host supplies its own `CompositionRoot`.

Retarget-only for v1: no new standalone-`.mu` composition grammar. A non-mural root
composes by calling `AddModule` in code (the `CompositionRoot` API is already the
seam), or via a host-bound composition element once we decide that surface.

## Non-goals

- Runtime-discovered plugins / demand-driven loading (cut, above).
- The generic contribution model (settings / documents / commands / shell-controls
  / project-factories) — those stay mural-specific; each host defines its own
  module type on the minimal `IModule` kernel.
- New composition grammar beyond retargeting the emission target.

## Open question

- Is retarget-only enough, or do we want a host to author `.modules:` / `.services:`
  against its own root **declaratively** (a standalone composition element, not an
  `Application { }`)? Retarget-only for v1; revisit if a real console/service app
  wants declarative composition.

## Priority note

This is **independent** of and **not a blocker for** the Project Explorer → core
move. It's the enabling change for the "any composition root" / console-and-service
apps direction. Sequence it whenever that direction becomes concrete; the explorer
move can land first on plain DI.

## Phasing (implementation plan to follow via writing-plans)

1. Compiler: retarget `.modules:` emission (and confirm `.services:`) to a
   `CompositionRoot` expression; keep the `Application { }` form composing exactly
   as before. Tests: an `Application { .modules: … .services: … }` still composes
   and resolves; the emitted target is typed as `CompositionRoot`.
