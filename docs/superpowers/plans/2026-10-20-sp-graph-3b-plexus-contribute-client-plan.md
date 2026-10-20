# SP-GRAPH-3b: Plexus Solution→Graph Contribution Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Plexus "Contribute to graph…" solution action that builds the whole solution's projects into compiled packages and uploads them to a named graph on a running dev-env container, authenticated as a maker with a portal-minted service token.

**Architecture:** Mirror the existing tenant-publish stack. The renderer builds the active solution's projects to compiled packages via TODL's `SolutionBuildManager` (system/flavor `npm-package`, which applies to every project type) and captures each `model.json` through an `IBuildStorageProvider` decorator; it then calls a host-agnostic `IGraphContributor` seam. The desktop host (apps/plexus) implements that seam over its preload bridge; the Electron **main** process holds the encrypted maker profile (server URL + token), opens a Node `PragmaticClient` with the Bearer token, calls `GraphProtocol.Contribute`, and returns only a token-free result.

**Tech Stack:** TypeScript. Repo `Plexus` (monorepo: `apps/plexus`, `packages/plexus-core`), consuming `@pragmatic-tech-ai/pragmatic-protocol` (has `ContributeGraph` / `GraphContributeParamsDto` / `ContributedPackageDto`) and `@pragmatic-tech-ai/todl` (`SolutionBuildManager`, `SolutionManagerService`, `parseManifest`, `BuildSystemRegistryKey`, `BuildStorageProviderKey`, `PackageStoreKey`). NO server/protocol/identity changes — SP-GRAPH-3a is complete and consumed as-is.

**Spec:** `docs/superpowers/specs/2026-10-20-sp-graph-3b-plexus-contribute-client-spec.md`

## Global Constraints

- OOP: behavior on classes/methods; no module-level free functions or mutable module state. Allman braces for every block.
- Real `enum`s over string-literal unions. No inline string literals — hoist reused/user-facing strings to `private static readonly` PascalCase constants.
- PascalCase for all interfaces and public methods. New view-models derive from `Observable` (not `MuralBase`) unless the DP system is genuinely needed. Private members / serialized data-shape fields keep their casing.
- Engine-layering holds: lower layers never import upward. plexus-core (framework) must not import from apps/plexus; the host impl lives in apps/plexus and is injected via a `ServiceKey` seam declared in plexus-core (mirror `ITenantPublisher`/`TenantPublisherKey`).
- Secrets: the maker token lives ONLY in the main process, is encrypted at rest, is never logged/echoed, never returned to the renderer, never placed in any result/DTO, and is cleared from the dialog on close. SetProfile accepts it; nothing returns it.
- LF-only line endings. Every test file under a `tests/` folder. Fix ALL review findings including Minors. Nothing is pushed until the user asks.
- Follow the Plexus/TODL repo lexical styles (match the neighbouring files you touch). Do NOT modify `@pragmatic-tech-ai/pragmatic-protocol`, server, or identity.

## Review Focus

- **Secret hygiene end-to-end:** the token stays main-side, encrypted at rest (mirror `TenantProfileStore`), never logged/echoed, never in a result/DTO or crossing IPC back to the renderer, cleared from the dialog on close. Pin in Tasks 2, 3, 4, 7.
- **No partial state on failure:** a build failure (Task 6) aborts before any network call; an auth/connect failure (Task 3) uploads nothing and the connection is closed in `finally`; an immutability conflict surfaces with no retry loop. Pin in Tasks 3 and 6.
- **Whole-solution assembly correctness:** every project's package is captured with the correct `id`/`version`/`modelJson`; because `SolutionBuildManager`'s result omits the documents and `RendererBuildStorageProvider.OpenOutput` deletes-and-recreates the dir, capture must read `model.json` from the output storage handle opened DURING the build, not by re-opening after. A project removed from the solution must be absent from the next contribute. Pin in Task 6.
- **Distinct failure messages:** wrong/expired token (auth), conflict (immutability), non-dev env, missing graph each surface a clear, distinguishable message — not one generic failure. Pin in Task 3.
- **Stable `solutionId`:** `solutionId` = the active solution's name, used consistently so repeat contributes replace the slice. Pin in Tasks 6/7.

## Design rulings (decided for this plan; executors follow verbatim)

- **R1 — Producer = `SolutionBuildManager`, system+flavor `npm-package`, in the RENDERER.** It is the only build system whose `AppliesTo` covers MetaModel/Library/Architecture and whose `EmitPackageLayoutAction` writes the own-only `model.json`; it builds in intra-solution dependency order so unpublished siblings resolve. The renderer already has `BuildSystemRegistryKey` (seeded with `npm-package`), `BuildStorageProviderKey`, `PackageStoreKey`, and `SolutionManagerService.ActiveSolution` wired; main has none of it.
- **R2 — Capture via an `IBuildStorageProvider` decorator.** `SolutionBuildManager.Build(...)` returns only statuses/diagnostics. Wrap the renderer's `BuildStorageProviderKey` provider with a decorator that records each per-project output `IStorage` handed out for `OpenOutput('npm-package', { OutputRootOverride: <id> })` during the build; after a successful build, read `model.json` from each recorded handle (do NOT re-open — the renderer provider deletes+recreates the dir on open). Mirror `SolutionBuildManager.CaptureOutput` (TODL `.../solution/solution-build-manager.ts:153-163`); heed the delete-on-open caveat (`.../renderer-build-storage-provider.ts:31-35`).
- **R3 — Token in main only; renderer passes `packages[]`.** The renderer produces `packages[{id,version,modelJson}]` and calls `IGraphContributor.Contribute(graphName, solutionId, packages)`. Main loads the encrypted profile (server URL + token), connects, calls `ContributeGraph`, returns `{ GraphName, PackageCount }`. The token never leaves main. `packages[]` (with modelJson) crossing renderer→main is fine; only the token is write-only/one-directional.
- **R4 — `solutionId` = `SolutionManagerService.ActiveSolution.Name`.** Durable minted id deferred (backlog Feature).
- **R5 — The action is solution-scoped.** The contributor targets the solution-root node (mirror `SolutionRootContributor`'s node key), not a project row. It obtains the solution from `SolutionManagerService.ActiveSolution`.

---

### Task 1: Main-process graph client factory

**Files:**
- Create: `apps/plexus/src/main/graph-contribute/graph-client.ts`
- Test: `apps/plexus/src/main/graph-contribute/tests/graph-client.test.ts`

**Interfaces (mirror `apps/plexus/src/main/tenant-publish/tenant-client.ts`):**
- `interface IGraphContributeClient { ContributeGraph(params: GraphContributeParamsDto): Promise<GraphDetailDto>; Close(): Promise<void> }`
- `interface IGraphClientFactory { Connect(serverUrl: string, token: string): Promise<IGraphContributeClient> }`
- `class PragmaticGraphClientFactory implements IGraphClientFactory` — `Connect` does `const client = await PragmaticClient.ConnectAsync(serverUrl, { bearerToken: token })` and returns `{ ContributeGraph: p => client.ContributeGraph(p), Close: () => client.DisposeAsync() }`.
- Import `PragmaticClient`, `GraphContributeParamsDto`, `GraphDetailDto` from `@pragmatic-tech-ai/pragmatic-protocol`.

- [ ] **Step 1: Write a failing test** that a fake `PragmaticClient`-like object wired through the factory's returned client forwards `ContributeGraph(params)` to the underlying client and `Close()` to `DisposeAsync()`. (The production `ConnectAsync` opens a socket, so test the returned adapter shape, mirroring how tenant-client is exercised — construct the adapter object directly or via a seam.)
- [ ] **Step 2: Run; confirm it fails.**
- [ ] **Step 3: Implement** `graph-client.ts` exactly mirroring `tenant-client.ts`.
- [ ] **Step 4: Run; green. Commit.**

---

### Task 2: Main-process encrypted graph profile store

**Files:**
- Create: `apps/plexus/src/main/graph-contribute/graph-profile.ts` (`GraphProfile { ServerUrl: string; Token: string }`, `IGraphProfileSource { Load(): Promise<GraphProfile | undefined> }`)
- Create: `apps/plexus/src/main/graph-contribute/graph-profile-store.ts`
- Test: `apps/plexus/src/main/graph-contribute/tests/graph-profile-store.test.ts`

**Interfaces (mirror `tenant-profile.ts` + `tenant-profile-store.ts`):**
- `interface ITokenEncryptor { IsAvailable(): boolean; Encrypt(plain: string): Buffer; Decrypt(blob: Buffer): string }` (local structural twin, same as tenant's).
- `class GraphProfileStore implements IGraphProfileSource` with `constructor(dir: string, encryptor: ITokenEncryptor)`, `Save(serverUrl, token): Promise<void>`, `Load(): Promise<GraphProfile | undefined>`. One OS-keyring-encrypted blob `graph-profile.bin` written temp+rename; both URL and token in one blob; no read path returns the token; distinct errors for unavailable encryption / unreadable blob / empty inputs. Reuse a server-URL validation (if `TenantServerUrl.Validate` is not reusable without coupling, replicate a minimal URL validation with a hoisted error).

- [ ] **Step 1: Write failing tests** with a fake `ITokenEncryptor`: Save then Load round-trips `{ServerUrl, Token}`; Load on no file returns `undefined`; empty URL or empty token throws the empty-profile error; when the encryptor is unavailable Save/Load throw the distinct unavailable error; a corrupt blob throws the distinct unreadable error (never echoing blob contents).
- [ ] **Step 2: Run; confirm failures.**
- [ ] **Step 3: Implement** mirroring `TenantProfileStore` (constants hoisted; temp+rename; `ENOENT`→undefined).
- [ ] **Step 4: Run; green. Commit.**

---

### Task 3: Main-process contribute service

**Files:**
- Create: `apps/plexus/src/main/graph-contribute/graph-contribute-service.ts`
- Test: `apps/plexus/src/main/graph-contribute/tests/graph-contribute-service.test.ts`

**Interfaces:**
- Consumes: `IGraphClientFactory` (Task 1), `IGraphProfileSource` (Task 2), `ContributedPackageDto`/`GraphContributeParamsDto`/`GraphDetailDto` (protocol).
- Produces: `class GraphContributeService { constructor(profiles: IGraphProfileSource, clients: IGraphClientFactory); Contribute(graphName: string, solutionId: string, packages: readonly ContributedPackageDto[]): Promise<GraphContributeResult> }`, where `GraphContributeResult` (from the shared contract, Task 4) is `{ GraphName: string; PackageCount: number }`.
- Behavior (mirror `TenantDeployService.Deploy` + `connect`): load profile first (throw a hoisted `NoProfile` if none) → validate URL → `connect(serverUrl, token)` (wrap connect failures so no token/detail leaks — fixed prefix + URL only) → `client.ContributeGraph({ graphName, solutionId, packages: [...packages] })` → map the returned `GraphDetailDto` to `{ GraphName: detail.name, PackageCount: detail.packages.length }` → `Close()` in `finally`. Let the server's `ContributeGraph` rejection propagate its message (conflict / not-found / non-dev) as the failure reason; wrap only the connect/auth failure with the fixed prefix. Never interpolate the token into any error.

- [ ] **Step 1: Write failing tests** with a fake factory + fake profile source: missing profile throws `NoProfile` and never calls the factory; with a profile, `Contribute` connects once, calls the client's `ContributeGraph` with `{graphName, solutionId, packages}`, returns `{GraphName, PackageCount}` from the detail, and calls `Close()` even when `ContributeGraph` rejects; a connect failure throws the fixed-prefix message containing the URL but NOT the token; a `ContributeGraph` rejection (simulate a conflict error and a not-found error) propagates a message that still distinguishes them and the connection is closed. Assert the token string never appears in any thrown error's message.
- [ ] **Step 2: Run; confirm failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; green. Commit.**

---

### Task 4: Shared IPC contract, main handlers, preload + main wiring

**Files:**
- Create: `apps/plexus/src/shared/graph-contribute-api.ts`
- Create: `packages/plexus-core/src/shared/graph-contribute-api.ts` (shared result/type, like `plexus-core/.../shared/tenant-publish-api.ts`)
- Create: `apps/plexus/src/main/graph-contribute/graph-contribute-ipc.ts`
- Modify: `apps/plexus/src/main/index.ts` (register the IPC, construct the service + store with a `SafeStorageEncryptor` + `PragmaticGraphClientFactory`, mirror the `TenantPublishIpc.Register(...)` wiring block)
- Modify: the apps/plexus preload bridge that defines `window.api` (add `graphContribute`, mirroring `tenantPublish`)
- Test: `apps/plexus/src/main/graph-contribute/tests/graph-contribute-ipc.test.ts`

**Interfaces (mirror `tenant-publish-api.ts` + `tenant-publish-ipc.ts`):**
- plexus-core shared: `interface ContributedPackage { id: string; version: string; modelJson: string }` and `interface GraphContributeResult { GraphName: string; PackageCount: number }` (local structural types; plexus-core does not depend on the protocol package).
- apps/plexus shared: `enum GraphContributeChannel { Contribute = 'graph-contribute:contribute', SetProfile = 'graph-contribute:set-profile', HasProfile = 'graph-contribute:has-profile' }`; `interface IGraphContributeApi { Contribute(graphName: string, solutionId: string, packages: ContributedPackage[]): Promise<GraphContributeResult>; SetProfile(serverUrl: string, token: string): Promise<void>; HasProfile(): Promise<boolean> }` (re-export the plexus-core shared types, as tenant does).
- `class GraphContributeIpc { static Register(ipc: IpcMain, service: GraphContributeService, profiles: GraphProfileStore): void }` — `Contribute` channel → `service.Contribute(graphName, solutionId, packages)`; `SetProfile` → `profiles.Save(...)`; `HasProfile` → `(await profiles.Load()) !== undefined`. Token write-only (nothing returns it).

- [ ] **Step 1: Write a failing test** for `GraphContributeIpc.Register` using a fake `IpcMain` that records handlers: assert the three channels are bound and that invoking the `Contribute` handler delegates to `service.Contribute` with the right args, `SetProfile` to `profiles.Save`, and `HasProfile` returns a boolean without exposing a token.
- [ ] **Step 2: Run; confirm failure.**
- [ ] **Step 3: Implement** the shared contract, the IPC class, the preload bridge addition, and the `main/index.ts` wiring (construct `new GraphProfileStore(userData, new SafeStorageEncryptor())` and `new GraphContributeService(profiles, new PragmaticGraphClientFactory())`, then `GraphContributeIpc.Register(ipcMain, service, profiles)` — mirror the tenant block).
- [ ] **Step 4: Run the test; green. Build the app typecheck (the repo's typecheck/build command) to confirm preload + main compile. Commit.**

---

### Task 5: Renderer host seam + IPC-backed implementation

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/graph-contribute/graph-contributor.ts` (seam + key)
- Create: `apps/plexus/src/renderer/src/services/graph-contribute/ipc-graph-contributor.ts` (host impl over `window.api.graphContribute`)
- Modify: wherever `TenantPublisherKey` is registered in apps/plexus renderer composition — register the `IGraphContributor` impl under its key the same way.
- Test: `apps/plexus/src/renderer/.../tests/ipc-graph-contributor.test.ts` (or the nearest renderer tests dir) with a fake `window.api.graphContribute`.

**Interfaces (mirror `tenant-publisher.ts` / `ipc-tenant-publisher.ts`):**
- `interface IGraphContributor { Contribute(graphName: string, solutionId: string, packages: ContributedPackage[]): Promise<GraphContributeResult>; SetProfile(serverUrl: string, token: string): Promise<void>; HasProfile(): Promise<boolean> }` and `const GraphContributorKey = new ServiceKey<IGraphContributor>('GraphContributor')`. Types from plexus-core shared (Task 4).
- `class IpcGraphContributor implements IGraphContributor` — thin wrapper over `window.api.graphContribute`.

- [ ] **Step 1: Write a failing test** that `IpcGraphContributor` forwards each method to `window.api.graphContribute` and returns its result (fake the bridge).
- [ ] **Step 2: Run; confirm failure.**
- [ ] **Step 3: Implement** the seam + key + impl + registration.
- [ ] **Step 4: Run; green. Commit.**

---

### Task 6: Renderer whole-solution package builder

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/graph-contribute/solution-package-builder.ts`
- Create: `packages/plexus-core/src/renderer/modules/graph-contribute/capturing-build-storage-provider.ts` (the decorator)
- Test: `packages/plexus-core/src/renderer/modules/graph-contribute/tests/solution-package-builder.test.ts`
- Test: `.../tests/capturing-build-storage-provider.test.ts`

**Interfaces:**
- Consumes (from TODL / provider): `SolutionBuildManager`, `SolutionBuildRequest`/`SolutionProject`, `BuildSystemRegistryKey`, `BuildStorageProviderKey` (an `IBuildStorageProvider`), `PackageStoreKey` (an `IPackageSource`), `SolutionManagerService.ActiveSolution` + `.Members`, `parseManifest`, `PROJECT_MANIFEST_FILENAME`, `toPackageJson`.
- Produces:
  - `class CapturingBuildStorageProvider implements IBuildStorageProvider` — wraps a delegate provider; on `OpenOutput(name, options)` it delegates, and when `name === 'npm-package'`, records the returned output `IStorage` keyed by `options.OutputRootOverride` (the project id). Exposes `CapturedOutputs(): ReadonlyMap<string, IStorage>`. Does NOT re-open or mutate.
  - `class SolutionPackageBuilder` with `constructor(registry, delegateStorageProvider, externalSource, solutions)` (resolved from the service provider at the call site) and `Build(progress?): Promise<readonly ContributedPackage[]>`: read `ActiveSolution` (throw a hoisted error if none), build `SolutionProject[]` from `Members.ToArray()` (each resolved member: `{ Id: manifest.id ?? manifest.name, Project: member.Storage, Manifest: manifest }` via `parseManifest(await member.Storage.ReadText(PROJECT_MANIFEST_FILENAME))`; skip members with no `Storage`), wrap the delegate provider in a `CapturingBuildStorageProvider`, run `new SolutionBuildManager(registry, capturing).Build({ Projects, BuildSystemId: 'npm-package', BuildFlavorId: 'npm-package', ExternalSource: externalSource, Progress })`, throw a hoisted build-failed error (with `BuildService.FormatErrors`-style diagnostics) if `!result.Ok`, then for each captured output read `model.json` from the recorded handle and emit `{ id: toPackageJson(manifest).todl.id, version: toPackageJson(manifest).version, modelJson }` — dedupe by `id@version`. Hoist `'npm-package'`, `'model.json'`, and all messages to constants.

- [ ] **Step 1: Write failing tests for `CapturingBuildStorageProvider`** over fakes: an `OpenOutput('npm-package', {OutputRootOverride:'p1'})` call records the returned storage under `'p1'`; a non-`npm-package` output is not recorded; the delegate's return value is passed through unchanged; re-opening is never triggered by the decorator itself.
- [ ] **Step 2: Write failing tests for `SolutionPackageBuilder`** with a fake registry/provider/solution: no active solution throws the hoisted error; a two-project solution produces one `ContributedPackage` per project with `id`/`version` from the manifest and `modelJson` read from the captured output's `model.json`; a build result with `Ok === false` throws the build-failed error and yields no packages; duplicate `id@version` across captures dedupes to one. (Fake `SolutionBuildManager` behavior by injecting a seam or by having the fake provider's captured handles already contain `model.json`; keep the real `npm-package` build out of the unit test.)
- [ ] **Step 3: Run both; confirm failures.**
- [ ] **Step 4: Implement** the decorator and the builder per R1/R2. Read `SolutionBuildManager.CaptureOutput` and `RendererBuildStorageProvider` first so the capture-during-build (not re-open-after) discipline is correct.
- [ ] **Step 5: Run both; green. Commit.**

---

### Task 7: Renderer contribute action + profile dialog

**Files:**
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/graph-profile-dialog.ts` (mirror `tenant-profile-dialog.ts`)
- Create: `packages/plexus-core/src/renderer/modules/solution-explorer/services/contribute-to-graph-contributor.ts`
- Modify: `packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-explorer-service.ts` (register via `RegisterInstance`, mirroring the `publishTenant` block)
- Test: `.../tests/contribute-to-graph-contributor.test.ts`

**Interfaces:**
- Consumes: `IGraphContributor`/`GraphContributorKey` (Task 5), `SolutionPackageBuilder` (Task 6), `BackgroundWorkService`, the `DialogService`-backed prompt pattern, `InfoDialog`, `SolutionManagerService.ActiveSolution`, the solution-root node key (from `SolutionRootContributor`), `IHierarchyContributor`/`CommandDefinition`/`RelayCommand`/`HierarchyContext`.
- Produces:
  - `interface IGraphProfilePrompt { Prompt(): Promise<GraphProfileInput | undefined> }`, `GraphProfileInput { ServerUrl: string; GraphName: string; Token: string }`, and `class GraphProfileDialog implements IGraphProfilePrompt` building a `StackPanel` of captioned `TextBox`es for server URL + graph name + token (token a plain `TextBox`, **cleared on close**, never logged/echoed; carry the same "Mural has no masked field; token is write-only and not retained" comment as `TenantProfileDialog`), a Save `RelayCommand` with validation into an error `TextBlock`, and `dialogs.Close({ ServerUrl, GraphName, Token })`.
  - `class ContributeToGraphContributor implements IHierarchyContributor` — `ParentKeys = [<solution-root node key>]`, `Actions` = a "Contribute to graph…" `CommandDefinition` (and a "Configure graph server…" command that collects + `SetProfile`s URL+token only). `Resolve` returns a `RelayCommand` that: gets `ActiveSolution` (can-execute false if none / builder / contributor missing); prompts for graph name (and server URL + token if `HasProfile()` is false, persisting via `SetProfile`); runs under `BackgroundWorkService.run('Contributing <solution> to graph <graphName>', async ctx => { const packages = await builder.Build(progress); const result = await contributor.Contribute(graphName, solution.Name, packages); return result })`, so a build/auth/conflict/non-dev failure fails the task row with the reason; on a thrown blocking error, surface via `InfoDialog`. The token goes straight to `SetProfile`; it is neither logged nor retained in the contributor.

- [ ] **Step 1: Write a failing test** (mirror how `publish-tenant-contributor` is testable): with a fake `IGraphContributor`, a fake builder, and a fake prompt, invoking the contribute command builds packages, calls `Contribute(graphName, solution.Name, packages)`, and reports the result; when no profile is configured it prompts and `SetProfile`s before contributing; a builder/contributor error becomes a failed task (assert the error reason is surfaced and the token never appears in it); the command is absent / disabled when there is no active solution.
- [ ] **Step 2: Run; confirm failure.**
- [ ] **Step 3: Implement** the dialog + contributor, and register in `SolutionExplorerService` via `registry.RegisterInstance(contributor, contributor.Actions)` (passing the `GraphContributorKey` impl, a new `SolutionPackageBuilder`, `BackgroundWorkService`, and a `GraphProfileDialog` built from the dialog host — mirror the `publishTenant` construction/guards).
- [ ] **Step 4: Run; green. Commit.**

---

## Build & verification notes

- No cross-repo build ordering: this slice is Plexus-only and consumes the already-built `pragmatic-protocol` dist. Run the repo's unit test command for the touched packages and the repo typecheck/build after Tasks 4 and 7 (preload/main and renderer composition must compile).
- Final whole-branch verification (most-capable model): the new main + renderer unit suites green, the repo typecheck/build green, and a grep of the Plexus main + renderer sources/logs confirming the token value is never logged and never crosses IPC back to the renderer. A live end-to-end contribute against a running dev-env container is a gated manual check (needs a built app + a container + a minted maker token), noted but not automated here — mirror the tenant-publish e2e gating posture.
- Deferral to surface at finish (backlog Feature): a durable minted solution id (so slices survive a rename); and a masked token input control in Mural.
