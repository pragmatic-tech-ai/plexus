# LSP Wave 2 — Plexus Adoption (in-process) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plexus consume the Wave 1 `solution-services/lsp` module in-process — delete the out-of-process stdio TODL language server and all its machinery, drive the language features through the registered `ILanguageService` (analysis in-process on the renderer thread for now), and route **every** renderer `SolutionBaseResolver` consumer through the single registered service so Plexus holds no direct resolver access.

**Architecture:** The lsp module (`LspServicesEngine`) is hosted in the Plexus renderer composition root; `SolutionLanguageService` is the single `ILanguageService` + base-resolution authority (it already owns the session, the one `SolutionBaseResolver`, the warm cache, and incremental lifecycle maintenance from Wave 1). The Plexus `TodlLanguageClient` is rewritten from a JSON-RPC-over-IPC client into a thin renderer **adapter** over that in-process service: it keeps the Plexus-specific glue (synthetic `todl://` URI scheme, diagnostics routing into `DiagnosticsService`, unified `applyWorkspaceEdit`, the `LiveValidationKey` surface) and exposes the `LspRequester`/`LspEditClient` `sendRequest(method, params)` facade the Monaco provider adapters already consume — so the providers are a near drop-in. The analysis Web Worker is explicitly **out of scope** (follow-on 2b); `AnalysisEngine` runs in-process via the default `IAnalysisEngine`.

**Tech Stack:** Electron + electron-vite (main/preload/renderer), TypeScript (strict; `tsconfig.node.json` + `tsconfig.web.json`), Monaco, mural `.mu` composition (`AddModule`), Vitest (unit), Playwright `_electron` (e2e), `@pragmatic-tech-ai/todl` (consumed from the root export; `development` condition dropped → resolves `dist`).

**Spec:** `TODL/docs/superpowers/specs/2026-10-03-lsp-solution-services-module-design.md` (Project item `PVTI_lADOE0Zc984Biu4ozg-e4ks`, Kind=Spec), Wave 2 section. Wave 1 (todl engine) shipped as `@pragmatic-tech-ai/todl@0.41.0`. This plan is Wave 2; the analysis Web Worker + any large-workspace tuning are a separate **Wave 2b** plan.

## Global Constraints

- **House style (both repos):** OOP (no module-level free functions / mutable data); Allman braces (opening brace on its own line, incl. one-line method bodies); no inline reused/user-facing string literals (hoist to `private static readonly`); real `enum`s over string unions; `IDisposable`/`dispose()` teardown (type disposers as `IDisposable`, not bare lambdas); VMs extend `Observable`; PascalCase interfaces + public methods; ESM imports carry `.js`. `.mu` markup labels are exempt from the no-inline-literal rule.
- **Layering:** the engine (todl) never calls up into Plexus. The base-resolution facade added in Phase A lives in todl and is free of Plexus types. Plexus → todl calls are normal; upward communication is signal-only.
- **LF line endings** on every edited file (0 CR bytes) — a Wave 1 task regressed `package.json`/`src/index.ts` to CRLF; do not let an editor rewrite whole files. Verify with `git show HEAD:<path> | tr -cd '\r' | wc -c` → 0.
- **Preserve the `todl://<projectKey>/<relpath>` URI contract** (lowercase-hex projectKey) exactly — Monaco models, diagnostics keying, and cross-file navigation all depend on `URI.parse(x).toString() === x` round-tripping.
- **Preserve the Monaco focus-theft shield** in `code-editor.ts` (`shieldOverlayPointer`/`swallowKey`) untouched — unrelated to transport.
- **Dev/consumption:** Plexus drops the `development` export condition (resolves built `dist`); consume the lsp surface from the **root** `@pragmatic-tech-ai/todl` specifier (Wave 1 re-exported `LspServicesEngine`/`SolutionLanguageService`/etc. from the root barrel). After any `npm install`/bump, the local dev dist is restored via `npm link @pragmatic-tech-ai/todl` (npm install clobbers the link); the renderer dedupes + excludes the framework packages from Vite pre-bundling so a rebuilt linked dist is served live.
- **Latest packages:** bump Plexus to the newest `@pragmatic-tech-ai/todl` (≥ the Phase A release) across both `apps/plexus/package.json` and `packages/plexus-core/package.json`.
- **Tests live next to code** (`src/**/*.test.ts`, run by Vitest). e2e specs live in `apps/plexus/e2e/` and need a prior `npm run build`.
- **Coordination:** plexus#3 / plexus#4 (centralize lifecycle in `SolutionManagerService`, retire `ProjectExplorerService`) and mural#3 / mural#4 (hierarchy consolidation) edit the same `SolutionExplorerService` / `SolutionManagerService` / module-composition code. This plan touches those services ONLY to repoint resolver access; it does not move lifecycle ownership or remove `ProjectExplorerService` (that is the #3/#4 workstream, which builds on this plan's "no direct resolver" outcome).

## Review Focus

- **Cross-file go-to-definition + context-menu actions still work** after the transport swap — the historical failure mode (mural `HtmlTarget.handlePointer` focus-theft dismissing Monaco popups; the synthetic-URI round-trip; `editor.action.revealDefinition` being a `registerAction2` command triggered via `editor.trigger`). The e2e must exercise Ctrl+click def + a context-menu action. Owned by Phase C (Monaco rewire) + Phase E (e2e).
- **Diagnostics for a whole project (not just the open tab)** still publish into `DiagnosticsService` and clear on project close — the old client did `didOpen` for every `.todl` in the project; the in-process feed must analyze the same whole-project set, keyed per project, and `ClearProject` on detach. Owned by Phase C.
- **An unpublished in-solution member's symbols resolve in the live app** (the Wave 1 defect fix, end-to-end) — against `plexus_test_projects`, a consumer binding an unpublished sibling shows no "not published"/"no publishable version" problems and the arch diagram populates. Owned by Phase E (e2e) + Phase D (arch services route through the service).
- **No orphaned resolver access** — after Phase D, no renderer file resolves `SolutionBaseResolver.Key` or binds `BaseResolverKey` to the raw resolver; a grep gate proves it. Owned by Phase D.
- **A reference (re)publish / ReferencesChanged refreshes bases live** — `LiveValidationSync.OnProjectEvent → RefreshBases` and the arch services' diagnostics update after a reference edit, now via the service's warm cache/stale-member signal rather than a manual `ResolveBasesFor`. Owned by Phase C + D.

---

## Phase A — todl: base-resolution facade on the host service (todl 0.42.0)

### Task A1: Expose base-resolution on `SolutionLanguageService` / `ILanguageService`

**Files:**
- Modify: `TODL/src/solution-services/lsp/host/i-language-service.ts`, `TODL/src/solution-services/lsp/host/solution-language-service.ts`
- Modify: `TODL/src/solution-services/lsp/index.ts` (export any new type)
- Test: `TODL/src/solution-services/lsp/host/tests/solution-language-service.test.ts` (extend)

**Interfaces:**
- Produces on `ILanguageService` (delegating to the internally-owned `SolutionBaseResolver`, so Plexus consumers never touch `SolutionBaseResolver.Key`):
  - `ResolveBasesFor(storage: IStorage): Promise<{ bases: readonly TodlDocument[]; originOf: ... ; problems: readonly ... }>` (mirror the resolver's `ResolveBasesFor` return shape exactly).
  - `ReferencedPublishedRefs(storage: IStorage): Promise<readonly PackageRef[]>`.
  - `WorkspaceProducers(kind): readonly ...` and `ProducedIdOf(storage: IStorage): string | undefined` (the `IBaseResolver` structural subset Plexus's `BaseResolverKey` needs).
  - `readonly StaleMembers: <Observable/Signal>` — a signal mirroring the resolver's `StaleMemberIds` PropertyChanged, so consumers subscribe to the service, not the resolver.
- Consumes: the existing owned `SolutionBaseResolver` inside `SolutionLanguageService` (Wave 1).

- [ ] **Step 1: Write failing tests** — over a Solution with an unpublished producer + a consumer: `service.ResolveBasesFor(consumerStorage)` returns the producer's bases (same result as the resolver directly); `ProducedIdOf(producerStorage)` returns its id; editing the producer fires `service.StaleMembers` carrying `{producer, consumer}`.
- [ ] **Step 2: Run to verify fail** (`npx tsx --conditions=development --test --test-force-exit "TODL/src/solution-services/lsp/host/tests/solution-language-service.test.ts"`).
- [ ] **Step 3: Implement** the delegating methods + the `StaleMembers` signal on `SolutionLanguageService`, declared on `ILanguageService`. Allman; no inline literals. Keep delegation thin (the warm-cache optimization is Wave 2b).
- [ ] **Step 4: Run to verify pass** + the wider `lsp` suite.
- [ ] **Step 5: Commit** (`feat(lsp): base-resolution facade on SolutionLanguageService` + attribution).

### Task A2: Release todl 0.42.0

**Files:** Modify `TODL/package.json` (version bump, LF-safe).

- [ ] **Step 1:** Bump `TODL/package.json` 0.41.0 → 0.42.0 (verify 0 CR bytes).
- [ ] **Step 2:** `npm --prefix TODL run build` (exit 0) + `npm --prefix TODL test` (no new failures).
- [ ] **Step 3:** `npm --prefix TODL publish` (GitHub Packages; `prepublishOnly` rebuilds). This is a publish — the executor pauses for human approval before running it (see subagent-driven-development stop conditions).
- [ ] **Step 4:** Commit (`chore(lsp): release todl 0.42.0` + attribution) and push (push-and-stop).

---

## Phase B — Plexus: adopt 0.42.0 and delete the stdio machinery

### Task B1: Bump the todl dependency and relink

**Files:** Modify `Plexus/apps/plexus/package.json:33`, `Plexus/packages/plexus-core/package.json:43,50` (todl `^0.40.2` → `^0.42.0`; LF-safe).

- [ ] **Step 1:** Edit both package.json files to `^0.42.0` for `@pragmatic-tech-ai/todl` (dep + devDep where present). Verify 0 CR bytes.
- [ ] **Step 2:** From `Plexus/`, `npm install` to refresh the lockfile to todl 0.42.0, then `npm link @pragmatic-tech-ai/todl` per the dev-link convention (install clobbers the link). Confirm `node_modules/@pragmatic-tech-ai/todl/dist/solution-services/lsp/` now exists and the root `dist/index.js` re-exports `LspServicesEngine`/`SolutionLanguageService`.
- [ ] **Step 3:** Commit the package.json + lockfile changes (`chore(lsp): consume todl 0.42.0` + attribution). (Build will still fail until B2 removes `build:todl-server` — that's expected; B1 is the dependency bump only.)

### Task B2: Delete the out-of-process stdio server + bundle

**Files:**
- Delete: `Plexus/apps/plexus/src/main/todl/todl-server-host.ts`, `.../register.ts`, `.../tests/todl-server-host.test.ts`, `.../tests/server-bundle.test.ts`; `Plexus/apps/plexus/scripts/build-todl-server.mjs`; `Plexus/apps/plexus/out/main/todl-language-server.cjs` (build artifact).
- Modify: `Plexus/apps/plexus/src/main/index.ts` (drop the `register.ts` import `:13` + `registerTodlServerHandlers()` call `:148`); `Plexus/apps/plexus/package.json` (remove `build:todl-server` script `:12`; de-chain it from `dev` `:14` and `build` `:15`); `Plexus/apps/plexus/electron.vite.config.ts` (remove `main.build.emptyOutDir:false` `:34-37`, restore default; keep the `TODL_DIST` alias).

- [ ] **Step 1:** Grep to confirm no remaining importer of `register.ts`/`todl-server-host.ts`/the bundle outside the deleted set.
- [ ] **Step 2:** Delete the files; apply the main/index.ts + package.json + electron.vite.config.ts edits (LF-safe).
- [ ] **Step 3:** `npm --prefix Plexus/apps/plexus run build` must now get past the (removed) `build:todl-server` step. It may still fail in the renderer until Phase C rewires the client — that's expected; the acceptance for B2 is that the `build:todl-server` failure is gone and `main`/`preload` build. Note remaining renderer errors for Phase C.
- [ ] **Step 4:** Commit (`refactor(lsp): remove out-of-process todl stdio server + bundle` + attribution).

### Task B3: Delete the IPC transport (shared api, preload bridge, connection, relay)

**Files:**
- Delete: `Plexus/apps/plexus/src/shared/todl-lsp-api.ts` (+ `src/shared/tests/todl-lsp-api.test.ts`); `Plexus/apps/plexus/src/renderer/src/services/todl/todl-lsp-connection.ts` (+ its test).
- Modify: `Plexus/apps/plexus/src/preload/index.ts` (drop the `todlLsp` import `:10`, its definition `:80-92`, and its inclusion in the exposed `api` `:148`).

- [ ] **Step 1:** Grep for remaining importers of `todl-lsp-api`, `todl-lsp-connection`, `todlLsp` — the only expected remaining references are in `todl-language-client.ts` + `main.js`, both rewritten in Phase C.
- [ ] **Step 2:** Delete the files + apply the preload edit (LF-safe).
- [ ] **Step 3:** `npm --prefix Plexus/apps/plexus run typecheck:node` clean for main+preload+shared (renderer still pending Phase C).
- [ ] **Step 4:** Commit (`refactor(lsp): remove todl LSP IPC transport (shared api, preload bridge, connection)` + attribution).

---

## Phase C — Plexus: host the lsp module + rewire LSP to the in-process service

### Task C1: Host `LspServicesEngine` in the renderer composition root

**Files:** Modify `Plexus/apps/plexus/src/renderer/src/app.mu` (import the module `~:60` area; add to the `.modules:` block `:467-509` **after** `SolutionSeamsHostModule` `:484` and `SolutionServicesEngine` `:487`, **before** `SolutionExplorerModule`/`MetaModelModule`/`ArchitectureProjectsModule`); run `compile:mu`. Test: `Plexus/apps/plexus/src/renderer/src/tests/*composition*.test.ts` (extend to assert the service resolves).

- [ ] **Step 1:** Write the failing composition test — after `AddModule(LspServicesEngine)`, `root.Provider.getRequired(SolutionLanguageService.Key) instanceof SolutionLanguageService`.
- [ ] **Step 2:** Run to verify fail (`npm --prefix Plexus/apps/plexus test -- <file>`).
- [ ] **Step 3:** Add the import + `.modules:` entry; `npm --prefix Plexus/apps/plexus run compile:mu`. Ensure the module's host seams (storage, package store, `SolutionManagerService`) are already registered upstream (they are, via `SolutionSeamsHostModule` + `SolutionServicesEngine`).
- [ ] **Step 4:** Run to verify pass.
- [ ] **Step 5:** Commit (`feat(lsp): host LspServicesEngine in the Plexus renderer` + attribution).

### Task C2: Rewrite `TodlLanguageClient` as an in-process adapter over `ILanguageService`

**Files:** Rewrite `Plexus/apps/plexus/src/renderer/src/services/todl/todl-language-client.ts`. Keep: the `LiveValidationKey` surface (`AttachProject`/`DetachProject`/`RefreshBases`/`ResyncProject`), the project registry + synthetic `todl://` URI scheme (`projectKeyFor`/`uriFor`/`resolveUri`/`registerProject`, `~:235-273`), diagnostics routing into `DiagnosticsService` (`onPublishDiagnostics`→map, `publishProject`, `ClearProject`, `~:529-570`), unified `applyWorkspaceEdit` (`~:141-156`), document sync maps, and the stale-members behavior. Replace: the `MessageConnection`/`notify`/`sendRequest` transport (`~:89,120,126,167-199`) and the `todl/setBases`/`todl/refreshBases` push (`~:199,300,336`). Tests: rewrite `.../todl/tests/*` to the in-process service (keep the transport-agnostic helpers `todl-sources.ts`, `semantic-scopes.ts`, `position.ts`).

**Interfaces:**
- Consumes: `SolutionLanguageService.Key` (`ILanguageService`) — `DidChange(uri,text)`, `DiagnosticsFor(uri)`, and the feature methods; the Phase A base-resolution facade (`ResolveBasesFor`, `StaleMembers`).
- Produces: the client now exposes the `LspRequester`/`LspEditClient` facade `sendRequest(method: string, params): Promise<unknown>` by dispatching the LSP method string to the matching `ILanguageService` call (so `providers.ts` needs no logic change) + `applyWorkspaceEdit`. Still registered under its own `Key` and aliased to `LiveValidationKey` at `main.js:97`.

- [ ] **Step 1:** Write failing tests — `AttachProject` feeds the project's `.todl` sources to the service and publishes whole-project diagnostics into a fake `DiagnosticsService`; an open-document `didChange` updates diagnostics; `sendRequest('textDocument/hover', …)` returns the service's hover; `sendRequest('textDocument/rename', …)` → `applyWorkspaceEdit` edits open buffer + closed file; `DetachProject` clears diagnostics. (No `setBases` push — the service owns base resolution.)
- [ ] **Step 2:** Run to verify fail.
- [ ] **Step 3:** Implement the rewrite. Map each `textDocument/*` method the providers call (`hover`/`definition`/`references`/`completion`/`foldingRange`/`documentSymbol`/`semanticTokens/full`/`signatureHelp`/`prepareRename`/`rename`/`codeAction`/`formatting`) to the `ILanguageService` method. Diagnostics: after a `DidChange`/attach, pull `DiagnosticsFor(uri)` per project `.todl` and route through the existing `publishProject` path. Drop base pushing. Keep the URI scheme + `setModelFinder`.
- [ ] **Step 4:** Run to verify pass + `typecheck:web`.
- [ ] **Step 5:** Commit (`refactor(lsp): drive Monaco features via in-process ILanguageService` + attribution).

### Task C3: Rewire the Monaco provider registration + renderer boot

**Files:** Modify `Plexus/apps/plexus/src/renderer/src/modules/meta-model/todl-lsp/register-providers.ts` (the `client` param now sourced from the in-process adapter; keep the Monaco registration body + `setModelFinder` + semantic-tokens staleness + `getLegend` now from the service's `SemanticTokensProvider.Legend`); `Plexus/apps/plexus/src/renderer/src/main.js` (rewrite the boot block `:175-195`: drop `createTodlLspConnection`/`Initialize(connection)`/`onServerRestart`; construct/resolve the in-process service + register providers + `setCrossFileOpener` via `resolveUri`; keep `:97` LiveValidationKey, `:249` `SubscribeToStaleMembers`, `:256` `LiveValidationSync.Start()`). `providers.ts` should need no change (verify).

- [ ] **Step 1:** Write/adjust failing tests for `register-providers` wiring against the in-process client; confirm `providers.ts` tests (`providers-edits`/`-nav`/`-structure`) still pass against the facade.
- [ ] **Step 2:** Run to verify fail/baseline.
- [ ] **Step 3:** Apply the rewire; `compile:mu` if needed.
- [ ] **Step 4:** Run to verify pass; `npm --prefix Plexus/apps/plexus run typecheck` (both projects) clean.
- [ ] **Step 5:** Commit (`refactor(lsp): wire Monaco providers + boot to the in-process service` + attribution).

---

## Phase D — Plexus: route all six resolver consumers through the service

### Task D1: Route the architecture services

**Files:** Modify `Plexus/apps/plexus/src/renderer/src/modules/architecture-projects/services/arch-model-gateway.ts:2,50`, `architecture-model-service.ts:2,93-94,104-105`, `arch-diagram-binding-service.ts:3,151-152`. Each stops importing/resolving `SolutionBaseResolver` and instead resolves `SolutionLanguageService.Key` and calls `ResolveBasesFor` / `ReferencedPublishedRefs` (Phase A facade). Tests: update the services' tests to register a fake `ILanguageService` instead of a fake under `SolutionBaseResolver.Key`.

- [ ] Steps: failing test → fail → repoint to the service facade → pass → commit (`refactor(lsp): architecture services resolve bases via ILanguageService` + attribution). Verify `originOf`/`problems` shapes are preserved.

### Task D2: Route the solution-explorer services + the `BaseResolverKey` capability

**Files:** Modify `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-workspace-service.ts:36,164,172-174`, `solution-reference-view.ts:11,154,157,164-166`; `Plexus/packages/plexus-core/src/renderer/projects/capabilities/base-resolver.ts:12-18` (bind `BaseResolverKey` to the service's facade — `WorkspaceProducers`/`ProducedIdOf` — instead of the raw `SolutionBaseResolver`); and `Plexus/apps/plexus/src/renderer/src/main.js:233-237` (stop eagerly resolving `SolutionBaseResolver.Key`; the service owns the subscription now). `solution-reference-view` subscribes to the service's `StaleMembers` signal instead of the resolver's `StaleMemberIds`.

- [ ] Steps: failing tests → fail → repoint → pass → commit (`refactor(lsp): solution-explorer services + BaseResolverKey via ILanguageService` + attribution).

### Task D3: Grep gate — no direct resolver access remains

**Files:** verification task (no production change unless the grep finds a straggler).

- [ ] **Step 1:** Grep the whole Plexus `src` tree (both app + plexus-core) for `SolutionBaseResolver` and `SolutionBaseResolver.Key`. Expected remaining: NONE in production renderer code (only the Phase A facade inside todl owns it). Any test still registering a fake under `SolutionBaseResolver.Key` should be migrated to the `ILanguageService` fake, or justified.
- [ ] **Step 2:** If a straggler exists, repoint it (same pattern as D1/D2) and commit; else record the clean grep.
- [ ] **Step 3:** Commit if changed (`refactor(lsp): remove last direct SolutionBaseResolver access` + attribution).

---

## Phase E — verify end-to-end

### Task E1: Full gate + e2e + live smoke

**Files:** none (verification); fix-forward any failures surfaced, each as its own small commit.

- [ ] **Step 1:** `npm --prefix Plexus run build` (core then app) exit 0; `npm --prefix Plexus run typecheck` clean both projects; `npm --prefix Plexus/apps/plexus test` + `npm --prefix Plexus/packages/plexus-core test` green.
- [ ] **Step 2:** `npm --prefix Plexus/apps/plexus run test:e2e` (Playwright `_electron` against the built `out/`). The e2e MUST cover the Review-Focus items: (a) cross-file go-to-definition via Ctrl+click AND a context-menu action (focus-theft shield intact); (b) whole-project diagnostics appear + clear on close; (c) against `plexus_test_projects`, an unpublished in-solution member resolves (no "not published" problems) and the arch diagram renders its nodes.
- [ ] **Step 3:** Record the smoke result; fix-forward any gaps (small commits). Do not introduce the Web Worker (that is Wave 2b).
- [ ] **Step 4:** Commit any fixes; push (push-and-stop). Register this plan in the Project (Kind=Plan) if not already.

---

## Out of scope (follow-ons)

- **Wave 2b — analysis Web Worker:** move `AnalysisEngine` off the UI thread via a greenfield renderer Web Worker + a structured-clone-safe context protocol (resolve the `TodlDocument`/`SourceFile` serialization story; base-set version token already exists). Separate plan.
- **plexus#3 / plexus#4:** centralize solution/project lifecycle in `SolutionManagerService`, retire `ProjectExplorerService` + `IContentMutations`. This plan leaves lifecycle ownership where it is and only repoints resolver access; #3/#4 build on the "no direct resolver" outcome.
- **mural#3 / mural#4:** hierarchy consolidation + provider-owned contributor nodes.
- **todl#11:** parser-recovery / cascading diagnostics (chosen fast-follow).
- **Wave 3:** remove the IPC published-only composition path + dead wiring; broader e2e corpus verification.
