# SP-GRAPH-3b: Plexus Solution→Graph Contribution Client — Spec

**Status:** Draft. Sub-project 3b of the Environments/Graphs/Admin program (the Plexus client half of SP-GRAPH-3).
**Date:** 2026-10-20
**Parent design:** `pragmatic-server/docs/superpowers/specs/2026-10-20-environments-graphs-admin-design.md`
**Depends on:** SP-GRAPH-3a (server + protocol) — COMPLETE. The server op `GraphProtocol.Contribute` / `PragmaticClient.ContributeGraph`, the `ContributedPackageDto`/`GraphContributeParamsDto` wire shapes, the maker capability, and the portal maker-token mint all exist and are merged.
**Repo:** `Plexus` (monorepo: app `apps/plexus`, framework `packages/plexus-core`), consuming `@pragmatic-tech-ai/pragmatic-protocol` (already a `file:` dep) and `@pragmatic-tech-ai/todl`. NO server/protocol/identity changes — those are 3a and are consumed as-is.

## Intent

Give a maker, inside Plexus, a **"Contribute to graph…"** action on a solution that builds the solution's projects into compiled packages and uploads them to a named graph on a running development-environment container, authenticated as a non-admin maker with a portal-minted service token. This is the client of SP-GRAPH-3a: it drives the existing `graph/contribute` op. With this slice the loop closes — an operator mints a maker token in the portal (3a-ii), hands it to a maker, and the maker contributes a solution's packages into a graph from Plexus.

## Decisions carried in (brainstormed + chosen 2026-10-20)

- **Whole-solution granularity.** One "Contribute to graph…" action builds every project in the solution and contributes all their compiled packages as a single additive slice. Re-contributing the same solution **replaces** that solution's slice on the server (a dropped project drops its package from the graph's effective union), per the 3a additive-per-solution model.
- **`solutionId` = the solution name** (the `.pksln` file stem / `SolutionManifest.name`). No new persistent id. Trade-off: renaming a solution starts a new slice (the old one lingers until manually removed) — acceptable for the single-maker dev workshop. A durable minted solution id is a deferred follow-up Feature.
- **Maker auth = a portal-minted Bearer service token** (SP-GRAPH-3a-ii), pasted into Plexus. The connection to the dev-env container is opened in the **Electron main process** via `PragmaticClient.ConnectAsync(serverUrl, { bearerToken })`; the token is stored encrypted at rest (OS keyring), is **write-only** (never read back to the renderer), and is never logged or echoed. This mirrors the existing tenant-publish token handling exactly.
- **Mirror the tenant-publish stack.** The existing `apps/plexus/src/main/tenant-publish/*` + `packages/plexus-core/.../publish-tenant-contributor.ts` deploy flow is the near-exact template; SP-GRAPH-3b adds a parallel `graph-contribute` stack that calls `ContributeGraph` instead of `DeployApplication`.

## Model

- A solution's **contributable package set** = the compiled packages of its projects, each `{ id, version, modelJson }`: `id`/`version` come from each project's `ProjectManifest` (`id ?? name`, `packageVersion`); `modelJson` is the built own-only `model.json` document (the same artifact the deploy path reads from `packages/<id>/<version>/model.json`).
- **The build runs in the main process.** The renderer action collects inputs (server URL, graph name, token) and the solution's on-disk location; the main process builds the solution's projects (node-only build engine), assembles `packages[]`, connects with the stored maker token, and calls `ContributeGraph`. Keeping build + connect + upload together in main mirrors tenant-publish (where main reads the build output and uploads) and keeps the maker token out of the renderer entirely.
- **Contribution is additive per-solution on the server** (3a): `ContributeGraph({ graphName, solutionId: <solutionName>, packages })` replaces the solution's slice; the graph's effective list is the union of all solutions' slices deduped by `id@version`; package bytes are immutable (identical = idempotent, differing = Conflict).
- **The maker profile** (server URL + token, and optionally the last graph name) persists as a single OS-keyring-encrypted blob, like `TenantProfileStore`, so repeat contributes don't re-prompt. The token is write-only at rest and cleared from the dialog on close.

## Scope

- **Plexus main (`apps/plexus/src/main/graph-contribute/`):** a graph-contribute client factory (`ConnectAsync(url, { bearerToken })` → an object exposing `ContributeGraph(params)` + `Close()`), a contribute service that (given the solution location + graph name) builds the solution, assembles `packages[{id,version,modelJson}]`, connects with the stored token, calls `ContributeGraph`, closes, and maps failures; an encrypted graph-profile store (server URL + token) mirroring `TenantProfileStore`; an IPC handler module.
- **Plexus shared (`apps/plexus/src/shared/`):** the IPC contract (channels + `window.api.graphContribute` shape) mirroring `tenant-publish-api.ts`.
- **Plexus renderer:** an `IGraphContributor` seam + key (plexus-core) with an IPC-backed impl in apps/plexus (mirroring `ITenantPublisher`/`IpcTenantPublisher`); a `ContributeToGraphContributor` hierarchy contributor (a solution-scoped "Contribute to graph…" action) registered in `SolutionExplorerService` via `RegisterInstance`; a `GraphProfileDialog` collecting server URL + graph name + token (mirroring `TenantProfileDialog`; plain `TextBox` token, cleared on close); progress + pass/fail via `BackgroundWorkService`, blocking errors via `InfoDialog`.

## Out of Scope

- **Server / protocol / identity changes** — all of SP-GRAPH-3a is complete and consumed as-is.
- **Promotion to a runtime** and runtime graph loading (SP-GRAPH-4).
- **A masked/password token field** — Mural has none (documented in tenant-publish); the token is a plain field, cleared on close, never echoed. A masked control is a tracked follow-up.
- **A durable minted solution id** — deferred Feature; `solutionId` is the solution name this slice.
- **A multi-server connection registry** for dev-env graph servers — a single encrypted profile is used; borrowing the richer Connections UX is deferred.
- **Large-payload frame chunking** — noted risk inherited from 3a; assumes package payloads fit the existing deploy-sized frame.
- **Changing the existing tenant-publish/app-deploy flow** beyond sharing its patterns (no regression to it).

## Functional Requirements

1. A maker can invoke **"Contribute to graph…"** from a solution in Plexus. It collects — or reuses a saved — development-environment server URL, a target graph name, and a maker token.
2. Invoking **builds every project in the solution** to compiled packages and assembles `packages[{ id, version, modelJson }]` (id/version from each project manifest; modelJson from the built `model.json`). A build failure aborts before any network call, with a clear error and no upload.
3. The client connects to the dev-env container **in the main process** via `PragmaticClient.ConnectAsync(serverUrl, { bearerToken })` and calls `ContributeGraph({ graphName, solutionId: <solutionName>, packages })`, then closes the connection (success or failure).
4. On success the maker sees the resulting graph (name + effective package count from the returned `GraphDetailDto`). The token is **never** shown back, logged, echoed, or sent to the renderer.
5. Failures surface clearly and distinctly: a wrong/expired/under-privileged token → an authorization failure; an immutability conflict (differing bytes for an existing `id@version`) → a conflict message; a non-Development environment or a missing graph → the server's error. No partial upload persists on failure.
6. The server URL + token persist as an **encrypted, OS-keyring, write-only** profile so repeat contributes don't re-prompt; the token is cleared from the dialog on close and never read back into the renderer or any returned DTO.

## Exit Criteria

- From a Plexus solution, a maker contributes to a named graph on a running dev-env container using a portal-minted maker token; the graph's effective package list (read back from the container) reflects the solution's packages.
- Re-contributing the same solution **replaces** its slice — dropping a project drops its package from the graph's union; adding one adds it.
- Contributing the identical package set again is idempotent; a differing `id@version` surfaces the conflict without a retry loop.
- A wrong/expired token yields an authorization failure with **no** partial upload; a non-Development env or missing graph surfaces the server's error.
- Grepping the Plexus main/renderer logs for the token value yields nothing; the token never crosses IPC back to the renderer and is encrypted at rest.
- No regression in the existing tenant-publish / app-deploy flow or the Plexus build.

## Constraints

Inherit all Global Constraints: OOP (methods on classes, no free functions/module state), Allman braces, real enums over string-literal unions, no inline string literals (hoist to `private static readonly` PascalCase), PascalCase public members + interfaces, new view-models derive from `Observable` (not `MuralBase`) unless the DP system is genuinely needed, engine-layering (lower layers never import upward), LF-only, every test file under a `tests/` folder, secrets/tokens never logged/echoed/persisted in a returned DTO or crossing IPC back to the renderer, nothing pushed until the user asks, fix ALL review findings including Minors. Follow the Plexus/TODL repo lexical styles. Do NOT modify the server/protocol/identity packages (consume 3a as-is). Reuse the tenant-publish seams and the existing build + package-assembly logic rather than forking them, so contribute and deploy stay consistent.

## Review Focus

- **Secret hygiene end-to-end:** the maker token stays in the main process, is encrypted at rest, is never logged/echoed, is never returned to the renderer or placed in any DTO, and is cleared from the dialog on close — exactly the tenant-publish discipline.
- **No partial state on failure:** a build failure or an auth failure uploads nothing; an immutability conflict is surfaced plainly with no automatic retry; a thrown error closes the connection.
- **Whole-solution assembly correctness:** every project's package is collected with the correct `id`/`version`/`modelJson`; a project removed from the solution really disappears from the next contribute (the slice is replaced, not merged client-side).
- **Distinct failure messages:** wrong/expired token (auth), conflict (immutability), non-dev env, and missing graph each surface a clear, distinguishable message — not one generic failure.
- **Stable `solutionId`:** the solution name is used consistently so repeat contributes from the same solution replace the slice rather than accumulate duplicates.
- **Reuse, not fork:** the build + `packages[]` assembly reuses the existing deploy-path logic/shape so the two upload flows cannot drift.
