# Milestone C2 — Plexus Project-Explorer Migration — REQUIRES FURTHER RESEARCH

**Status:** NOT spec-ready — research required. Do not plan or implement until the open questions below are resolved and this document is promoted to a full design.
**Part of:** Mural hierarchy/command roadmap, **Milestone C2** of Phase 0 → A → B → C1 → C2.
**Depends on:** Milestone B (breaking mural release) + Milestone C1 (Mural `Hierarchy { }` DSL + default `TreeView`), both published.
**Repo:** Plexus

## Why this is deferred

B dissolves the four hierarchy types and deletes the action stack that Plexus's Solution Explorer consumes, and it removes the "one provider per parent" short-circuit that Plexus's hand-built composite `ProjectBranchesProvider` + `LeadingBranch` protocol exists to work around. Migrating Plexus onto the new model is therefore not a mechanical swap — it hinges on how Plexus's provider-owned subtrees (Connections, References, project files) re-express themselves under the new multi-contribution + one-owner-per-subtree model. That modeling is unsettled, so C2 is parked here as a research stub rather than a design.

## Intended end state (once researched)

- Retire `ProjectBranchesProvider` and the `LeadingBranch` protocol (the composite workaround #4 eliminates).
- Re-express Connections / References / project-file branches as independent contributions composing under the one project node, each provider owning its own sub-branch.
- Adopt the `Hierarchy { }` DSL (C1) for registration and the default `TreeView` integration (C1); drop the hand-written `solution-explorer.resources.mu` templates + singleton context menu, overriding only the item template for Plexus's look if needed.
- Bump Plexus to the breaking mural (from the prior pinned version) in one move with the migration.
- Verify against the `plexus_test_projects` e2e corpus.

## Open research questions (must be answered before a C2 design)

1. **Provider decomposition.** Does each former `LeadingBranch` (Connections, References, files) become its own `IHierarchyProvider` attached under the project `Key` via a separate `Contributor` entry, composing through B's process-all multi-attach — or does some grouping remain? What owns ordering between them (contributor `Order`) vs. today's `LeadingBranch[]` order?
2. **Provider-integration hook fit.** Is B's `Integrate(item, contributions)` hook sufficient for the cases where Plexus injects nodes into a provider-owned subtree, or does the Solution Explorer need something the hook doesn't yet express?
3. **Canonical-name parity.** The Solution Explorer persists + restores canonical names (reveal across reload). Does B's per-contribution segment namespacing reproduce the exact canonical paths Plexus persists today, or do stored paths need migration?
4. **Realize contract fit.** The branches are disk-watched / lazy. Do they map cleanly onto `Realize(item, context): IDisposable` mutating `Children`, including the base-resolution / `solution-services` interplay (`SolutionBaseResolver`, published-base resolution)?
5. **Base resolution interplay.** How does the migration interact with the in-flight solution-services adoption (base resolution / wiki / explorer moving to TODL)? Sequencing with that work.
6. **Version pin / divergence window.** Confirm the plan for Plexus running on the prior mural from B's release until C2 lands, and the one-move bump at C2.

## Deliverable of the research step

A full `2026-..-plexus-project-explorer-migration-design.md` that answers the six questions, maps every current `ProjectBranchesProvider` / `LeadingBranch` responsibility to its new home, and defines the e2e acceptance against `plexus_test_projects`. Only then does C2 enter writing-plans.
