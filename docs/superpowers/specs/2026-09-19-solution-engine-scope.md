# Solution Engine — production-readiness scope

> Prerequisite to the Solution Hierarchy work (`c:\tmp\solution-hierarchy-spec.md`).
> Engine lives in TODL `src/solution/engine/` + `src/domain/`. Legend: **Done** /
> **Partial** / **Missing**. Promote to `Kind = Spec`/`Plan` Project items when agreed.

## Scenarios (the production bar)

1. New solution; user adds projects and files sequentially.
2. Opening an existing solution.
3. Reference management.
4. Compilation → create the Domain → load the compiled projects into it.
5. Modification of an already-compiled solution → adjust the Domain to the changes.

---

## Scenario 1 — New solution, sequential build-up

**Narrative.** Create an empty solution at a location; add a project (type + name) →
scaffolded on disk, opened, and shown; repeat; add files/folders inside a project; every
step is durable and reactive.

**Required capabilities → state**
- Create empty solution + **persist `solution.json` on create** — *Missing* (`NewSolution`
  only builds an in-memory `Solution`, writes nothing until Save).
- **Add-new-project-into-solution**: scaffold via `factory.createProject`, add member,
  **open it immediately**, retain storage, persist — *Missing* (engine has manifest-only
  `AddMember`; create-project lives UI-side in `ProjectExplorerService`, not the engine).
- **Add-existing-project** (link a folder) with type detection — *Missing* at engine level.
- Live `AddMember` opens the project (not unresolved until reopen) — *Missing* (bug/gap #4).
- **Per-project content mutation** (new file/folder) via a reactive content store — *Missing*
  (project handle is `unknown`; no content model).
- **Save** persists member projects too (`factory.saveProject`) — *Missing* (never called; #3).

**Verdict: mostly Missing.** The sequential-authoring flow is largely unbuilt in the engine.

## Scenario 2 — Open existing solution

**Narrative.** Read `solution.json`, open all members resiliently, bind settings, publish
`ActiveSolution`.

**Required capabilities → state**
- Parse manifest (kind/version/paths) — **Done** (well tested).
- Open all members, member-rooted storage — **Partial** (happy path Done + tested).
- **Resilient open**: a member whose `openProject` *throws* must not abort the solution;
  record `SolutionMember.Status` (`LoadFailed`/`UnknownType`) — *Missing* (bug #1; only the
  missing-factory case is handled).
- **Graceful bad/missing `solution.json`** (diagnostic, no half-open) — *Missing* (#6).
- **Retain member storage** on the member — *Missing* (resolved then dropped).
- **Bind settings bags on open** (`LoadSettings` + `BindBags(registry)`) — *Missing* end-to-end
  (values Done; bind not driven by the manager, #8).

**Verdict: Partial.** Happy path solid; resilience, storage retention, settings-bind absent.

## Scenario 3 — Reference management

**Narrative.** A member declares references — to other projects in the solution (local) and
to published packages from configured sources — and the engine lists/adds/removes/resolves
them.

**Required capabilities → state**
- **Local inter-project references** (sibling project as a base) — **Partial** (a
  `WorkspaceBaseResolver` exists app-side; not a solution-engine capability).
- **Package/registry references** (`PackageSource`/`PackageRef`, `Domain.load`) — **Partial**
  (the Domain/package world exists; no solution-level reference API).
- **First-class references API** on a member: list/add/remove, persisted, validated —
  *Missing* (nothing owns "this member's references" in the engine).
- **Source registry** the references resolve against (per §cross-hierarchy of the hierarchy
  spec) — *Missing* at engine level.

**Verdict: Partial/scattered.** Pieces exist (Domain, base resolver) but no consolidated,
engine-owned reference model.

## Scenario 4 — Compile → Domain → load compiled projects

**Narrative.** Compile each member (source → compiled package), register it, create a
`Domain`, load the compiled packages deps-first, hold the composed Domain + diagnostics.

**Required capabilities → state**
- **Compile a project** (`compilePackage`, `PackageStore`) — **Done** in todl (exists,
  per publish capability) but **unwired** to the solution engine.
- **Compose loaded packages into one Domain**, deps-first, diagnostics-not-throw —
  **Done** (`SolutionSession.compose`, tested).
- **Bridge: member project → compile → `PackageRef` → compose** — *Missing* (the caller
  must pre-compile today; `compose` takes resolved refs; #11).
- **Tie composition to the active solution** (build-all for `ActiveSolution`) — *Missing*
  (compose is standalone; nothing links it to opened members).

**Verdict: Partial.** Both ends exist (compile; compose); the middle bridge and the
solution-level "build" are missing.

## Scenario 5 — Modify compiled solution → adjust the Domain

**Narrative.** A file/project changes → recompile the affected member(s) → adjust the Domain
incrementally (reload changed packages + dependents, re-resolve, re-emit diagnostics),
reactively.

**Required capabilities → state**
- **Change detection** (which member/file is dirty; watcher-driven) — *Missing*.
- **Incremental recompile** of affected members only — *Missing* (`compilePackage` is whole-
  package).
- **Domain invalidation/reload** of changed packages + dependents (dependency-aware) —
  *Missing* (`compose` is a full, stateless rebuild: clears diagnostics, reloads all).
- **Reactive diagnostics** on adjustment — *Missing*.

**Verdict: Missing.** The incremental/reactive composition layer does not exist.

---

## Consolidated evaluation

| Scenario | State | Biggest missing piece |
|---|---|---|
| 2 Open existing | Partial | resilient open + status + settings-bind + storage retain |
| 1 New + sequential | Mostly missing | create-project-into-solution + live open + content store + member save |
| 4 Compile → Domain | Partial | member→compile→compose bridge + build-all tied to solution |
| 3 References | Partial/scattered | engine-owned references API + source registry |
| 5 Modify → adjust | Missing | change detection + incremental recompile + Domain invalidation |

## Cross-cutting (needed regardless of scenario)

- **SaveAs correctness** (currently reopens without opening members; doesn't relocate/rebase) — bug #2.
- **Member disposal on close/replace** (`IProjectFactory` needs a close/dispose verb) — #5.
- **Concurrency guard** on async open/save/build — #10.
- **`Project` typing** (drop `unknown`; typed/generic handle) — #9.
- **RecentSolutions persistence + cap** — #7.

## Packaging (DECIDED: Option A — todl IS the full headless engine)

`todl` is not "just the compiler" — it is the **complete headless engine**: compiler +
Domain + package management + the solution/project ecosystem + references + build +
the `IProjectFactory` interface/registry. plexus is the UI on top. **No separate ecosystem
package**; the solution engine stays in `TODL/src/solution/`.

`todl` stands alone by depending only on **`todl-runtime`** (its zero-dep base), NOT mural:

```
todl-runtime   zero-dep base: Observable, Signal, Disposable, IStorage, DI (ServiceProvider/Key/Base) [EXISTS], ObservableCollection [relocate here]
   ↑
todl           FULL HEADLESS ENGINE: compiler + Domain + package mgmt + solution/project ecosystem + references + build + factory interface/registry
   ↑
plexus-core    UI on top: ProjectExplorer, hierarchy (mural/framework), factory UI, connections
   ↑
app modules    concrete project-type factories, contributors, SolutionExplorer capability
```

**Only cleanup: sever todl's accidental reach into mural.** Today the solution engine imports
DI and `ObservableCollection` from `@pragmatic-tech-ai/mural/runtime`. Fix:
1. Reroute DI imports `mural/runtime → todl-runtime` — DI already lives there
   (`ServiceProvider`/`ServiceKey`/`ServiceBase`/`IServiceContainer`/`ServiceLifetime`,
   explicitly decoupled from mural).
2. **Relocate `ObservableCollection`** to `todl-runtime` (CONFIRMED: it lives in
   `mural/runtime` today) and have mural re-export it — a natural fit beside `Observable`/`Signal`.

No new package, no engine move. Result: todl depends only on todl-runtime; it is the full
standalone headless engine.

## Proposed sequencing

- **E0 — Headless foundation (Option A).** (a) Reroute the solution engine's DI imports
  `mural/runtime → todl-runtime`; (b) relocate `ObservableCollection` to `todl-runtime` (mural
  re-exports); (c) **[DONE]** headless Node-fs `IStorage` (`NodeFsStorage`) added to
  `todl-runtime` (11 TDD tests green, suite 57/57, exported from index) — todl can now do real
  FS I/O headless. Engine stays in `todl`; result: todl depends only on todl-runtime and runs
  headless. (a)/(b) still pending.

> **Surfaced by the testing plan — headless factories.** The meta-model / library /
> architecture factories live in plexus app modules today. Their **lifecycle + compile**
> halves must live in `todl` (Option A) so a headless build (E3/E5) and the fixture-based
> tests can open/compile real projects; the UI halves (scaffold dialogs, presentation) stay
> in plexus. Land these headless factories with E1 (open) / E3 (build).
- **E1 — Harden open (Scenario 2).** Bugs #1, #6; storage retain; `SolutionMember.Status`;
  settings-bind-on-open. *Also unblocks the hierarchy's `LoadFailed`/storage needs.*
- **E2 — Authoring lifecycle (Scenario 1).** New-solution persist; create/add-project-into-
  solution + live open (#4); reactive per-project content store; member save (#3); dispose
  on close (#5). *Unblocks the hierarchy's live-add + teardown needs.*
- **E3 — Build (Scenario 4).** member→compile→compose bridge; build-all tied to `ActiveSolution`.
- **E4 — References (Scenario 3).** Engine references API (local + package) + source registry.
- **E5 — Incremental (Scenario 5).** Change detection; incremental recompile; Domain
  invalidation of changed + dependents; reactive diagnostics.
- **Cross-cutting** folded in where it fits (SaveAs + concurrency with E1; typing throughout).

Dependency notes: E1 precedes E2's open path; E3 depends on E2 (opened members) + compile;
E5 depends on E3 (a Domain to adjust) + E2's content store (change source); E4 feeds E3/E5.
The hierarchy work (separate spec) can begin after **E1 + E2**.
