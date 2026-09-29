# Spec — Solution Hierarchy Migration (umbrella)

> Status: **draft for review**. Reconciles the recovered greenfield design
> (`2026-09-19-solution-hierarchy-design.md` + `-spec.md`) against the CURRENT
> codebase and sets the cross-repo migration strategy. On approval, each phase
> below becomes its own sub-project spec → plan → implement.
>
> Companion design of record: `2026-09-19-solution-hierarchy-design.md` (§1–18) and
> `2026-09-19-solution-hierarchy-spec.md` (§1–14). Engine/presentation separation
> principles: `2026-09-18-engine-presentation-separation-principles.md` +
> `-communication-architecture.md`.

## 1. What this is

Build the provider/contributor **Hierarchy** — an `IVsHierarchy`-family analog — as
the universal mechanism for working with solution and project items, and migrate the
current tree onto it. The design is unchanged in intent; this spec records how it maps
onto code that evolved since the design was written, and the two strategic decisions
that shape the work.

**Decisions locked (2026-09-29):**
- **Big-bang, framework-first.** Build the framework primitives and the engine content
  store up front (design P0/P1), then cut the app tree over wholesale — NOT an
  incremental retrofit of the existing projection.
- **Framework lives in mural/framework.** The hierarchy runtime, registry, contracts,
  `NodeKey` pattern, and `.hierarchyContributors:` DSL land in `mural/framework`, beside
  `Capability` / `ShellModule` / the `PopulateFromModules` registries — as the design
  states. This is a Mural release + Plexus/devUI adoption cycle.

## 2. Current-state reconciliation (verified against code)

The design was greenfield and named reconciliation with the existing
`ProjectExplorer`/`Project`/`ProjectNode` world as a deferred non-goal. That
reconciliation is now in scope. Ground truth, from a three-repo exploration:

### Already present (build on)
- **Engine spine (TODL `src/solution-services/`).** `SolutionManagerService` with
  `OpenProject`/`CloseProject`/`OpenSolution` and an observable `ActiveSolution`
  (PropertyChanged/`Signal`-backed); `Solution` model (the design's "SolutionModel")
  with `ObservableCollection<SolutionMember> Members`; `SolutionMember` retaining
  `.Ref`/`.Project`/`.Storage`; pure-lifecycle `IProjectFactory` (create/open/save,
  no `CreateHierarchy`); `ProjectFactoryRegistry` + `ProjectFactoryRegistryKey`.
- **Reactivity primitives (todl-runtime).** `Observable`/`PropertyChanged(name):Signal`,
  `Signal<T>`, `ObservableCollection<T>` with `CollectionChange` deltas, `SessionStore`.
- **Module + registry machinery.** `.mu module { .services: }` → `Module` →
  `RegisterServices`; `ShellModule` typed DSL collections (`.documents`/`.commands`/
  `.settings`) with `PopulateFromModules` (the direct precedent for the contributor
  registry); the `Capability[ServiceKey=…]` mount pattern (for `SolutionExplorer`).
- **Global selection.** Plexus's tree is one `TreeView` with unified selection
  redistributed per project — close to the design's single selection surface.

### Missing (net-new)
- **Reactive, lazy, disk-watched per-project content store** with stable file ids and
  `HierarchyChange` deltas. The design's load-bearing piece. Today project content is an
  eager one-shot `IStorage.List` walk into an in-memory `ProjectNode` tree; live updates
  come from an app-level `FileWatchService` that triggers whole-project rescans; node
  identity is path-based; there are no deltas.
- **All hierarchy vocabulary** — `IHierarchyProvider`, `HierarchyNode`, `HierarchyModel`,
  `HierarchyContributorRegistry`, `NodeKey`, the `.hierarchyContributors:` block — absent
  in mural and TODL.
- **`SolutionMember.Status`/`Error`** — only a boolean `IsResolved` exists.
- **`PackageSourceRegistry` / Connections / References-as-tree-nodes** — absent from the
  mounted tree (References is dialog-only; Connections lives only in devUI's
  `solution-studio`; the app has a single `PackageSourceKey` seam, not a registry).
- **Keyed multi-contributor actions** — only single-slot `INodeCommandContributor` and
  per-project `IProjectMenuSource`; most node actions are hardcoded in `wireNodes`.
- **Key governance** — enums (`DiagramSettingKey`/`DiagramCommandId`) exist, but no
  `KEY-NAMESPACES.md` and no compose-time collision check.

### Conflicts to resolve
- **Two explorers.** Plexus mounts `ProjectExplorerService` (member-projection,
  path-keyed `ProjectNode` VMs). devUI mounts `solution-studio`'s
  `SolutionExplorerService` (over the engine's `SolutionTreeVM`). The design's
  `SolutionExplorer`/`HierarchyModel` must *replace* Plexus's projection, and its name
  collides with the devUI service.
- **`contributor` is overloaded.** TODL's Domain already owns `Contributor` (package
  composition). The tree contributor is named **`HierarchyContributor`**.
- **Layering drift.** `ProjectFactoryRegistry` ended up in TODL, not mural; the design
  assumed all registries were mural-side. The hierarchy *presentation* framework goes in
  mural (locked); the engine content store + `SolutionMember.Status` go in TODL.

## 3. Resolved reconciliation decisions

- **Plexus is the P2 cutover target.** devUI's `solution-studio` explorer keeps working
  and converges in a later, separate effort; the old `SolutionExplorerService` is not
  touched until then.
- **The new mounted capability becomes the solution/project explorer** in Plexus; today's
  `ProjectExplorerService` member-projection + `ProjectNode` VM tree + `wireNodes` are
  retired at P2. Behaviors it owns today MUST be re-homed (see §5).
- **Naming:** tree contributor = `HierarchyContributor`; the design's "SolutionModel" is
  today's `Solution` (no rename); the mounted capability is the design's
  `SolutionExplorer` (the devUI collision is resolved when devUI converges).

## 4. Phasing (reconciled) and decomposition

Each phase is its **own sub-project** (spec → plan → implement), mirroring the theme
migration's waves. Cross-repo release order per phase: **Mural (publish) → TODL (publish)
→ Plexus (adopt)**.

- **P0 — Framework primitives (mural/framework).** All net-new; unit-tested with fakes,
  no consumers. Contracts (`HierarchyNode`, `IHierarchyProvider`, contribution classes,
  `HierarchyItemId`), `HierarchyModel` (realize=subscribe + patch), `HierarchyContributorRegistry`
  + `.hierarchyContributors:` DSL + `PopulateFromModules` + collision check, the `NodeKey`
  owner-class pattern, `KEY-NAMESPACES.md`. **First sub-project.** Ships a Mural release.
- **P1 — Engine (TODL).** The reactive, lazy, disk-watched per-project **content store**
  (stable ids + deltas); `SolutionMember.Status`/`Error`; confirm `ActiveSolution`
  publication semantics. `.Storage` already retained. Ships a TODL release.
- **P2 — SolutionExplorer + basic tree (Plexus).** Capability service owns a
  `HierarchyModel`, observes `ActiveSolution`, seeds the root; projects-listing
  contributor (solution→members) + default file-tree contributor over the content store;
  realize=subscribe. Retires `ProjectExplorerService`'s projection. The rip-and-replace.
- **P3 — Mutation.** New/rename/delete/move via the engine store; `CanAccept` drop
  validation. Authoritative (non-optimistic); editing state UI-only.
- **P4 — Commands & selection.** Owner-base actions + keyed `HierarchyContributor`
  action seam (generalizes `INodeCommandContributor`/`IProjectMenuSource`); global
  selection over the mixed tree.
- **P5 — Cross-hierarchy content.** `PackageSourceRegistry` (engine) + `ConnectionsProvider`
  + `ReferencesProvider` + resolver; Connections/References contributors — the shared
  reactive store, no tree-to-tree wiring.
- **P6 — Persistence & errors.** Canonical-name persistence + reactive restore;
  unresolved-member decoration + "Remove from Solution".

## 5. P2 behavior port (the app rip-and-replace inventory)

Everything `ProjectExplorerService`/`OpenProject`/`ProjectNode`/`wireNodes` does today
must land somewhere in the new model before P2 can retire the old tree. Enumerated so no
behavior is silently dropped:

- Open node / open file in editor; Add-New submenu (`newItemChoices`); New Folder;
  Import File / Import OS Folder; inline Rename (F2, in-place reprefix); Delete
  (close-guard first); Close project; Move project.
- Diagram Export SVG / PPTX (gated by `DiagramTreeExportKey`).
- Publish / Version (producer projects); the agent/skill **Run** menu
  (`SkillProjectMenuSource` via `IProjectMenuSource`).
- LiveValidation `ResyncProject` on rescan; base refresh + producer invalidation
  (`RefreshProjects`).
- Selection redistribution per project; per-project commands surfaced to the shell.
- The `IProjectTreeHost` seam consumers (file-watch reload target, cross-file open →
  reveal, `ProjectTreeHostKey` bindings) must be re-pointed to the new capability.

## 6. Cross-repo release / adoption sequencing

Because the framework is in mural, every phase that touches it is a publish+adopt cycle
(the theme migration is the template): land + test in Mural, publish, bump TODL/Plexus
pins, adopt. P0 and P2 both touch mural; P1 is TODL-only; P3–P6 touch mural (contracts)
+ TODL (engine) + Plexus (consumers) per phase. Keep each phase independently shippable
and green before publishing.

## 7. Testing strategy (per phase; real fixtures where the engine is involved)

Carry the recovered testing strategy (`2026-09-19-solution-engine-testing.md`): REAL
fixtures over pure mocks — checked-in fixture projects per type, real Node-fs storage in
temp dirs, real factories, a real local registry — for engine/integration tiers; fast
in-memory (`FakeStorage`) unit tiers for logic. Framework (P0) is unit-tested with fakes
(no consumers). See each sub-project spec for its own test matrix.

## 8. Open decisions carried from the design (resolve per sub-project)

- Stable id source: native file id where available vs store-assigned fallback (P1).
- `PackageSourceRegistry` scope: per-solution vs global (P5).
- Node↔provider-root mapping implicit (chosen) vs explicit root child node (P0/P2).
- "References" semantics: browsable-available vs declared-dependencies (both may coexist) (P5).
- Rename identity via stable ids (in-place `ChildUpdated`) — assumed in scope; confirm (P1).

## 9. Next step

Write the **P0 sub-project spec** (mural/framework primitives) in full, then hand to
writing-plans. P0 is self-contained, testable with fakes, and unblocks P1–P6.
