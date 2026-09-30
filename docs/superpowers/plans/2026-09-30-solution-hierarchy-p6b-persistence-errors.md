# Solution Hierarchy P6b — Persistence & Errors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Solution Hierarchy durable, per-solution expansion/selection state with reactive restore, and one "Remove from Solution" action that works on every member row.

**Architecture:** Mural gains full ancestor-path canonical names + a realize-on-demand `Reveal` (`HierarchyModel`) and an observable `IsExpanded`/`Expand`/`Collapse` on the row VM. Plexus adds a `HierarchyExpansionBehavior` (data→view expansion sync), a `SolutionTreeStateService` that persists/restores via the P6a `GlobalBagPersister` keyed by solution path, a stable per-member canonical segment, and a `RemoveMember` action that also stops auto-dropping unresolved members. Cross-repo: Mural publishes, Plexus adopts.

**Tech Stack:** TypeScript; Mural framework (node:test via `tsx`); Plexus plexus-core + apps (vitest); GitHub npm registry for the Mural publish.

**Spec:** `Plexus/docs/superpowers/specs/2026-09-30-solution-hierarchy-p6b-persistence-errors-design.md`

## Global Constraints

- OOP house style: behavior on classes; **no** module-level free functions or mutable module state (module-level `const`/type/enum is fine). Existing `is<X>` type-guard free functions are the sanctioned exception — do not add new ones.
- Allman braces (opening brace on its own line) for every class/interface/enum/method/control block. Object literals, arrow-function bodies, and genuine one-liners stay inline.
- No inline string literals for labels/keys/property names — hoist to `private static readonly` PascalCase constants. Structural tokens (`'/'`, `typeof x === 'string'`) may stay inline.
- All interfaces and public methods use PascalCase.
- View models extend `Observable`, not `MuralBase`.
- Every test file lives in a `tests/` subfolder next to its source.
- Canonical-name separator is `'/'`; provider-contributed segments are treated as opaque.
- Tree-state is user-local, never written to the solution manifest; an untitled solution (no `Storage`) is session-only (never touches the durable global store).
- Bump adopted package pins to the newest published version.
- End every commit message with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## Review Focus

1. **Canonical-name collision across members** — every member row shares `Key='project'`; without a per-member segment two projects' rows get identical canonical names and restore cross-contaminates. Pinned in Task 1 (composition) + Task 5 (member segment = `Ref.path`).
2. **Provider canonical-name stability governs sub-project restore** — a provider whose `GetCanonicalName` returns empty/unstable names silently loses folder-level expansion restore (project-level still works via the member segment). Pinned in Task 1 (provider-delegation test).
3. **Corrupt / missing tree-state bag** — a solution opened with no saved state, or a malformed bag, must build the tree normally, not throw. Pinned in Task 7 (defensive-read test).
4. **Untitled solution must never write to the durable global store** — a path-less key would pollute `application-bags.json`. Pinned in Task 6 (untitled test).
5. **Removing an expanded/selected member** — its `ChildRemoved` must prune selection and its name must not resurrect on the next save. Pinned in Task 7 (stale-name skip test) + the existing `HierarchyTreeVM` prune behaviour.

---

## File Structure

**Mural (`Mural/src/framework/hierarchy/`):**
- `hierarchy-node.ts` — add optional `CanonicalSegment` to `HierarchyNode` (Task 1).
- `hierarchy-model.ts` — `Entry.parent`, full-path `CanonicalNameOf` + `GetProperty` repoint (Task 1), realize-on-demand `Reveal` (Task 2).
- `hierarchy-item-vm.ts` — observable `IsExpanded`, `Expand()`/`Collapse()`, `CanonicalName` (Task 3).
- `tests/hierarchy-model.test.ts`, `tests/hierarchy-item-vm.test.ts` — append tests.

**Plexus (`Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/`):**
- `services/projects-listing-contributor.ts` — set `CanonicalSegment` (Task 5).
- `services/solution-tree-state-service.ts` — new; persist (Task 6) + restore (Task 7).
- `behaviors/hierarchy-expansion-behavior.ts` — new; data→view expansion sync (Task 8).
- `services/solution-explorer-service.ts` — construct/dispose the state service (Task 8).
- `solution-explorer.resources.mu` — attach the expansion behavior (Task 8).
- `services/tests/`, `behaviors/tests/` — new test files.

**Plexus (`Plexus/packages/plexus-core/src/renderer/modules/project-explorer/`):**
- `services/content-mutations.ts` — add `RemoveMember` to `IContentMutations` (Task 9).
- `services/project-explorer-service.ts` — implement `RemoveMember`, stop auto-drop (Task 9).

**Plexus (solution-explorer actions):**
- `services/project-actions-contributor.ts` — rename action → `RemoveMember` (Task 10).
- `services/tests/project-actions-contributor.test.ts` — update (Task 10).

**Plexus (apps):**
- `apps/plexus/.../project-explorer/tests/project-explorer-service.test.ts` — append Task 9 tests.

---

## Task 1: Canonical names — full ancestor path + provider delegation (Mural)

**Files:**
- Modify: `Mural/src/framework/hierarchy/hierarchy-node.ts` (add `CanonicalSegment`)
- Modify: `Mural/src/framework/hierarchy/hierarchy-model.ts` (`Entry.parent`, `CanonicalNameOf`, `GetProperty`)
- Test: `Mural/src/framework/hierarchy/tests/hierarchy-model.test.ts` (append)

**Interfaces:**
- Consumes: existing `HierarchyModel` (`SeedRoot`, `RealizeChildren`, `ChildrenOf`, `entry`), `IHierarchyProvider.GetCanonicalName`.
- Produces: `HierarchyNode.CanonicalSegment?: string`; `HierarchyModel.CanonicalNameOf(id): string` returns a `/`-joined absolute path; `GetProperty(id, CanonicalName)` returns the same.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hierarchy-model.test.ts` (imports at top of that file already include `node:test`/`assert`; ensure these are imported from `../index.js`: `HierarchyItemId`, `HierarchyPropertyId`, `ChildAdded`, `ProviderContribution`, `NodeContribution`, `NodeSeverity`, `HierarchyContributorRegistry`, `HierarchyContributorDefinition`, `type IHierarchyContributor`, `type IHierarchyProvider`, `type HierarchyChange`; and `ServiceProvider`, `ServiceKey` from `../../../runtime/index.js`):

```ts
class OneChildProvider implements IHierarchyProvider
{
    public readonly ProviderId = 'fake';
    public readonly Child = HierarchyItemId.Mint();
    constructor(private readonly relative: string) {}
    public ObserveChildren(_node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        sink(new ChildAdded(this.Child, { Key: 'file', Caption: 'f', IconKey: '', ExtObject: {}, Severity: NodeSeverity.Ok }));
        return () => {};
    }
    public GetProperty(): unknown { return undefined; }
    public GetCanonicalName(id: HierarchyItemId): string { return id === this.Child ? this.relative : ''; }
    public ParseCanonicalName(name: string): HierarchyItemId { return name === this.relative ? this.Child : HierarchyItemId.Nil; }
    public CanAccept(): boolean { return false; }
}

// A registry with a solution->project keyed listing and a project->provider boundary.
function canonicalModel(provider: OneChildProvider): { model: HierarchyModel; root: HierarchyItemId }
{
    const sp = new ServiceProvider();
    const listing = new ServiceKey<IHierarchyContributor>('listing');
    sp.registerInstance(listing, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([{ Key: 'project', Caption: 'P', IconKey: '', ExtObject: {}, Severity: NodeSeverity.Ok, CanonicalSegment: './p1' }]) } as IHierarchyContributor);
    const files = new ServiceKey<IHierarchyContributor>('files');
    sp.registerInstance(files, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(provider) } as IHierarchyContributor);
    const registry = new HierarchyContributorRegistry(sp);
    for (const [key, pk] of [[listing, 'solution'], [files, 'project']] as const)
    {
        const d = new HierarchyContributorDefinition(); d.ParentKeys = [pk]; d.Contributor = key; d.Order = 0; registry.Register(d);
    }
    const model = new HierarchyModel(registry);
    const root = model.SeedRoot({ Key: 'solution', Caption: 'S', IconKey: '', ExtObject: {}, Severity: NodeSeverity.Ok });
    return { model, root };
}

test('CanonicalNameOf composes the keyed ancestor path using CanonicalSegment', () =>
{
    const { model, root } = canonicalModel(new OneChildProvider('src/app.ts'));
    model.RealizeChildren(root);
    const projectId = model.ChildrenOf(root)[0]!;
    assert.equal(model.CanonicalNameOf(projectId), 'solution/./p1');
});

test('CanonicalNameOf delegates the provider-owned suffix to the owner', () =>
{
    const provider = new OneChildProvider('src/app.ts');
    const { model, root } = canonicalModel(provider);
    model.RealizeChildren(root);
    const projectId = model.ChildrenOf(root)[0]!;
    model.RealizeChildren(projectId);                  // attaches provider; emits the file child synchronously
    const fileId = model.ChildrenOf(projectId)[0]!;
    assert.equal(model.CanonicalNameOf(fileId), 'solution/./p1/src/app.ts');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Mural && npm run test:file -- "src/framework/hierarchy/tests/hierarchy-model.test.ts"`
Expected: FAIL — `CanonicalNameOf` returns the single Key `'project'` (not `'solution/./p1'`), and TypeScript rejects `CanonicalSegment` on the node literal (property does not exist).

- [ ] **Step 3: Add `CanonicalSegment` to `HierarchyNode`**

In `hierarchy-node.ts`, inside `interface HierarchyNode`, after `IsExpandable?`:

```ts
    // Optional stable, per-instance path segment for canonical names. A keyed contributor
    // whose siblings share a Key (e.g. every member row is Key='project') sets a unique
    // segment here (the member's folder path); absent, CanonicalNameOf falls back to Key.
    readonly CanonicalSegment?: string;
```

- [ ] **Step 4: Add `parent` to `Entry` and set it**

In `hierarchy-model.ts`, add to `interface Entry`:

```ts
    // The node's parent id (undefined for the seeded root). Drives CanonicalNameOf's
    // ancestor walk; set wherever a child entry is created.
    parent?: HierarchyItemId;
```

Set it at the three entry-creation sites:
- `SeedRoot`: `this.entries.set(id, { node, children: [], parent: undefined });`
- `internKeyed` (the `childId === undefined` branch): `this.entries.set(childId, { node: childNode, children: [], parent: parentId });`
- `patch`'s `ChildAdded` branch: `this.entries.set(change.Id, { node: change.Node, children: [], owner: entry.provider, parent: parentId });`

- [ ] **Step 5: Implement `CanonicalNameOf` + repoint `GetProperty`**

Add a separator constant to `HierarchyModel`:

```ts
    private static readonly PathSeparator = '/';
```

Replace the P0 `CanonicalNameOf` body with:

```ts
    // Full ancestor-path canonical name, '/'-joined, absolute from the seeded root. A keyed
    // node contributes CanonicalSegment ?? Key; a provider-owned node contributes its keyed
    // boundary prefix plus the provider's own (possibly multi-segment) relative name.
    public CanonicalNameOf(id: HierarchyItemId): string
    {
        const entry = this.entry(id);
        if (entry.owner !== undefined)
        {
            const boundary = this.boundaryOf(entry);
            const prefix = boundary === undefined ? '' : this.CanonicalNameOf(boundary);
            const relative = entry.owner.GetCanonicalName(id);
            if (prefix === '') return relative;
            if (relative === '') return prefix;
            return `${prefix}${HierarchyModel.PathSeparator}${relative}`;
        }
        const segments: string[] = [];
        let cur: HierarchyItemId | undefined = id;
        while (cur !== undefined)
        {
            const e = this.entry(cur);
            if (e.owner !== undefined) break;
            segments.unshift(e.node.CanonicalSegment ?? e.node.Key);
            cur = e.parent;
        }
        return segments.join(HierarchyModel.PathSeparator);
    }

    // The keyed node a provider subtree hangs from: walk up from a provider-owned node to
    // the first non-owned ancestor (the boundary the provider is attached to).
    private boundaryOf(entry: Entry): HierarchyItemId | undefined
    {
        let cur: HierarchyItemId | undefined = entry.parent;
        while (cur !== undefined)
        {
            const e = this.entry(cur);
            if (e.owner === undefined) return cur;
            cur = e.parent;
        }
        return undefined;
    }
```

In `GetProperty`, change the `CanonicalName` case:

```ts
            case HierarchyPropertyId.CanonicalName: return this.CanonicalNameOf(id);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Mural && npm run test:file -- "src/framework/hierarchy/tests/hierarchy-model.test.ts"`
Expected: PASS — both new tests green, existing model tests still green.

- [ ] **Step 7: Typecheck**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Mural && npm run typecheck`
Expected: no new errors (pre-existing baseline unchanged).

- [ ] **Step 8: Commit**

```bash
cd C:/Users/Eugene/Projects/architecture-agent/Mural
git checkout -b p6b-hierarchy-persistence
git add src/framework/hierarchy/hierarchy-node.ts src/framework/hierarchy/hierarchy-model.ts src/framework/hierarchy/tests/hierarchy-model.test.ts
git commit -m "feat(hierarchy): full ancestor-path CanonicalNameOf with provider delegation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `Reveal` — realize-on-demand lookup (Mural)

**Files:**
- Modify: `Mural/src/framework/hierarchy/hierarchy-model.ts` (`Reveal`)
- Test: `Mural/src/framework/hierarchy/tests/hierarchy-model.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `CanonicalNameOf` infra (`parent`, `PathSeparator`), `IHierarchyProvider.ParseCanonicalName`.
- Produces: `HierarchyModel.Reveal(canonicalName): HierarchyItemId` — descends + realizes; `Nil` if unresolved.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hierarchy-model.test.ts`:

```ts
test('Reveal descends and realizes a collapsed keyed target', () =>
{
    const { model, root } = canonicalModel(new OneChildProvider('src/app.ts'));   // nothing realized yet
    const projectId = model.Reveal('solution/./p1');
    assert.notEqual(projectId, HierarchyItemId.Nil);
    assert.equal(model.CanonicalNameOf(projectId), 'solution/./p1');
});

test('Reveal returns Nil for an unknown name and an unrealized provider target', () =>
{
    const { model } = canonicalModel(new OneChildProvider('src/app.ts'));
    assert.equal(model.Reveal('solution/nope'), HierarchyItemId.Nil);
    assert.equal(model.Reveal('solution/./p1/does/not/exist'), HierarchyItemId.Nil);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Mural && npm run test:file -- "src/framework/hierarchy/tests/hierarchy-model.test.ts"`
Expected: FAIL — the P0 `Reveal` only scans already-realized entries by bare `Key`, so `'solution/./p1'` is not found (nothing realized; name is a path).

- [ ] **Step 3: Implement realize-on-demand `Reveal`**

Replace the P0 `Reveal` body with:

```ts
    // Resolve a canonical name to a live node id, realizing keyed levels on the way down.
    // At a provider boundary the remaining suffix is handed to the provider's
    // ParseCanonicalName (Nil if that subtree is not realized). Nil if any segment misses.
    public Reveal(canonicalName: string): HierarchyItemId
    {
        const rootId = this.rootId();
        if (rootId === undefined) return HierarchyItemId.Nil;
        const segments = canonicalName.split(HierarchyModel.PathSeparator);
        const rootEntry = this.entry(rootId);
        if ((rootEntry.node.CanonicalSegment ?? rootEntry.node.Key) !== segments[0]) return HierarchyItemId.Nil;
        let cur = rootId;
        for (let i = 1; i < segments.length; i++)
        {
            const entry = this.entry(cur);
            if (entry.provider === undefined) this.RealizeChildren(cur);
            const afterRealize = this.entry(cur);
            if (afterRealize.provider !== undefined)
            {
                const rest = segments.slice(i).join(HierarchyModel.PathSeparator);
                return afterRealize.provider.ParseCanonicalName(rest);
            }
            const next = this.childBySegment(cur, segments[i]!);
            if (next === undefined) return HierarchyItemId.Nil;
            cur = next;
        }
        return cur;
    }

    // The seeded root — the single entry with no parent.
    private rootId(): HierarchyItemId | undefined
    {
        for (const [id, e] of this.entries) if (e.parent === undefined) return id;
        return undefined;
    }

    // A realized keyed child of `id` whose own segment matches, or undefined.
    private childBySegment(id: HierarchyItemId, segment: string): HierarchyItemId | undefined
    {
        for (const child of this.entry(id).children)
        {
            const e = this.entry(child);
            if ((e.node.CanonicalSegment ?? e.node.Key) === segment) return child;
        }
        return undefined;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Mural && npm run test:file -- "src/framework/hierarchy/tests/hierarchy-model.test.ts"`
Expected: PASS — all model tests green.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Eugene/Projects/architecture-agent/Mural
git add src/framework/hierarchy/hierarchy-model.ts src/framework/hierarchy/tests/hierarchy-model.test.ts
git commit -m "feat(hierarchy): realize-on-demand Reveal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Row VM — observable `IsExpanded`, `Expand`/`Collapse`, `CanonicalName` (Mural)

**Files:**
- Modify: `Mural/src/framework/hierarchy/hierarchy-item-vm.ts`
- Test: `Mural/src/framework/hierarchy/tests/hierarchy-item-vm.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `model.CanonicalNameOf`.
- Produces: `HierarchyItemVM.get IsExpanded(): boolean`, `Expand(): void`, `Collapse(): void`, `get CanonicalName(): string`. `OnExpand`/`OnCollapse` keep `IsExpanded` truthful and raise `PropertyChanged('IsExpanded')`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hierarchy-item-vm.test.ts` (reuse that file's existing helpers for building a model + an expandable node; if it lacks one, mirror `canonicalModel` from the model test, seeding a root whose child is expandable):

```ts
test('Expand realizes children, flips IsExpanded, and raises PropertyChanged', () =>
{
    const { model, root } = canonicalModel(new OneChildProvider('src/app.ts'));
    model.RealizeChildren(root);
    const projectId = model.ChildrenOf(root)[0]!;
    const vm = new HierarchyItemVM(model, projectId, undefined, fakeHost());
    let raised = 0;
    vm.PropertyChanged('IsExpanded').subscribe(() => { raised++; });

    assert.equal(vm.IsExpanded, false);
    vm.Expand();
    assert.equal(vm.IsExpanded, true);
    assert.ok(vm.Children.Count >= 1);
    assert.equal(raised, 1);

    vm.Collapse();
    assert.equal(vm.IsExpanded, false);
    assert.equal(raised, 2);
});

test('CanonicalName returns the model full path', () =>
{
    const { model, root } = canonicalModel(new OneChildProvider('src/app.ts'));
    model.RealizeChildren(root);
    const projectId = model.ChildrenOf(root)[0]!;
    const vm = new HierarchyItemVM(model, projectId, undefined, fakeHost());
    assert.equal(vm.CanonicalName, 'solution/./p1');
});
```

(If `hierarchy-item-vm.test.ts` has no `fakeHost`/model helper, copy the small `fakeHost` from `hierarchy-tree-vm.test.ts` and the `canonicalModel`/`OneChildProvider` from the model test into this file's top.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Mural && npm run test:file -- "src/framework/hierarchy/tests/hierarchy-item-vm.test.ts"`
Expected: FAIL — `IsExpanded`, `Expand`, `Collapse`, `CanonicalName` do not exist on `HierarchyItemVM`.

- [ ] **Step 3: Add the members**

In `hierarchy-item-vm.ts`, add a constant beside the others:

```ts
    private static readonly IsExpandedProp = 'IsExpanded';
```

Add a public getter + programmatic methods + canonical name, and route `OnExpand`/`OnCollapse` through shared cores that raise the change:

```ts
    public get IsExpanded(): boolean { return this.expanded; }

    // The stable, full-path canonical name of this row (empty for a placeholder).
    public get CanonicalName(): string
    {
        if (this.placeholderText !== undefined) return '';
        return this.model.CanonicalNameOf(this.Id);
    }

    // Programmatic expand/collapse (restore drives these); identical to the framework's
    // view->data OnExpand/OnCollapse hooks — all four share one core.
    public Expand(): void { this.expandCore(); }
    public Collapse(): void { this.collapseCore(); }
```

Replace the bodies of `OnExpand`/`OnCollapse` to delegate, and add the cores:

```ts
    public OnExpand(): void { this.expandCore(); }

    public OnCollapse(): void { this.collapseCore(); }

    private expandCore(): void
    {
        if (this.placeholderText !== undefined || this.expanded) return;
        this.expanded = true;
        this.clearPlaceholder();
        this.off = this.model.ObserveChildren(this.Id, (c) => this.patch(c));
        this.model.RealizeChildren(this.Id);
        this.RaisePropertyChanged(HierarchyItemVM.IsExpandedProp, false, true);
    }

    private collapseCore(): void
    {
        if (this.placeholderText !== undefined || !this.expanded) return;
        this.expanded = false;
        this.off?.();
        this.off = undefined;
        this.model.Collapse(this.Id);
        for (const child of this.Children.ToArray()) child.dispose();
        this.Children.Clear();
        this.childById.clear();
        if (this.IsExpandable) this.seedPlaceholder();
        this.RaisePropertyChanged(HierarchyItemVM.IsExpandedProp, true, false);
    }
```

(The original `OnExpand`/`OnCollapse` bodies move verbatim into the cores; only the `RaisePropertyChanged` line is new.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Mural && npm run test:file -- "src/framework/hierarchy/tests/hierarchy-item-vm.test.ts"`
Expected: PASS.

- [ ] **Step 5: Full Mural suite + typecheck**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Mural && npm test` then `npm run typecheck`
Expected: green suite (pre-existing baseline unchanged), no new type errors.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/Eugene/Projects/architecture-agent/Mural
git add src/framework/hierarchy/hierarchy-item-vm.ts src/framework/hierarchy/tests/hierarchy-item-vm.test.ts
git commit -m "feat(hierarchy): observable IsExpanded + Expand/Collapse + CanonicalName on row VM

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Publish Mural + adopt in Plexus (cross-repo)

**Files:**
- Modify: `Mural/package.json` (version)
- Modify: `Plexus/packages/plexus-core/package.json`, `Plexus/apps/plexus/package.json`, `Plexus/apps/devUI/package.json` (mural pin)

**Interfaces:**
- Consumes: Tasks 1–3 (the new Mural API).
- Produces: a published Mural version whose dist carries `CanonicalSegment`, full-path `CanonicalNameOf`/`Reveal`, and the VM members — resolvable from Plexus.

> **Side effect:** Step 3 publishes to the GitHub npm registry. Under superpowers:executing-plans this is a stop-and-ask; the user has authorized the P6a-style cascade before — confirm, then proceed.

- [ ] **Step 1: Bump the Mural version**

Edit `Mural/package.json`: `"version": "0.57.0"` → `"version": "0.57.1"`.

- [ ] **Step 2: Build Mural**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Mural && npm run build`
Expected: builds templates + `tsc -p tsconfig.build.json` + demos with no errors.

- [ ] **Step 3: Publish Mural**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Mural && npm publish`
Expected: `+ @pragmatic-tech-ai/mural@0.57.1` published to `npm.pkg.github.com`.

- [ ] **Step 4: Bump the mural pin in Plexus**

In `Plexus/packages/plexus-core/package.json`, `Plexus/apps/plexus/package.json`, and `Plexus/apps/devUI/package.json`, set the `@pragmatic-tech-ai/mural` dependency to `^0.57.1` (only where it currently reads `^0.57.0`).

- [ ] **Step 5: Install + rebuild plexus-core dist**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus && npm install && cd packages/plexus-core && npm run build`
Expected: install resolves mural 0.57.1; `compile:mu` + `tsc -p tsconfig.json` succeed.

- [ ] **Step 6: Verify the adopt is green**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npm run typecheck && npm test`
Expected: typecheck clean; `vitest run` shows only the 2 known pre-existing MAIN-suite failures (runner alias split) — no new failures.

- [ ] **Step 7: Commit (both repos)**

```bash
cd C:/Users/Eugene/Projects/architecture-agent/Mural
git add package.json && git commit -m "chore: release mural 0.57.1 (hierarchy canonical names + expansion)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
cd C:/Users/Eugene/Projects/architecture-agent/Plexus
git add packages/plexus-core/package.json apps/plexus/package.json apps/devUI/package.json package-lock.json
git commit -m "chore: adopt mural 0.57.1

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Stable per-member canonical segment (Plexus)

**Files:**
- Modify: `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/services/projects-listing-contributor.ts`
- Test: `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/projects-listing-contributor.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's `HierarchyNode.CanonicalSegment`; `SolutionMember.Ref.path`.
- Produces: each member row's `HierarchyNode` carries `CanonicalSegment = member.Ref.path`, so member canonical names are unique across siblings.

- [ ] **Step 1: Write the failing test**

Create `services/tests/projects-listing-contributor.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { NodeKey, type HierarchyContributorRegistry } from '@pragmatic-tech-ai/mural/framework/hierarchy'
import { Solution } from '@pragmatic-tech-ai/todl'
import { ProjectsListingContributor } from '../projects-listing-contributor.js'

describe('ProjectsListingContributor', () =>
{
    it('stamps each member row with a CanonicalSegment = the member Ref.path', () =>
    {
        const solution = new Solution('S')
        const member = solution.AddMember('./projA', 'architecture')
        const registry = { NotifyContributionsChanged: () => {} } as unknown as HierarchyContributorRegistry
        const contributor = new ProjectsListingContributor(solution, registry)

        const nodes = contributor.Contribute({ Key: NodeKey.Solution, Caption: 'S', IconKey: '', ExtObject: solution, Severity: 0 }).Nodes
        expect(nodes).toHaveLength(1)
        expect(nodes[0]!.CanonicalSegment).toBe(member.Ref.path)
    })
})
```

(If `HierarchyContributorRegistry` is not re-exported through the `@pragmatic-tech-ai/todl` shim, import it from `@pragmatic-tech-ai/mural/framework/hierarchy` instead and add it to `vitest.config.ts`'s alias set only if a runtime value is needed — here a structural fake suffices, so the `mural/framework/hierarchy` type import is enough.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npx vitest run src/renderer/modules/solution-explorer/services/tests/projects-listing-contributor.test.ts`
Expected: FAIL — `CanonicalSegment` is `undefined` on the contributed node.

- [ ] **Step 3: Set `CanonicalSegment`**

In `projects-listing-contributor.ts`, inside the `Contribute` loop's pushed node literal, add:

```ts
                CanonicalSegment: m.Ref.path,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npx vitest run src/renderer/modules/solution-explorer/services/tests/projects-listing-contributor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Eugene/Projects/architecture-agent/Plexus
git checkout -b p6b-persistence-errors 2>/dev/null; git checkout p6b-persistence-errors
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/projects-listing-contributor.ts packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/projects-listing-contributor.test.ts
git commit -m "feat(solution-explorer): stamp member rows with a stable CanonicalSegment

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(The spec was committed on `p6b-persistence-errors`; continue that branch for all Plexus tasks.)

---

## Task 6: `SolutionTreeStateService` — persist (Plexus)

**Files:**
- Create: `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-tree-state-service.ts`
- Test: `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/solution-tree-state-service.test.ts` (new)

**Interfaces:**
- Consumes: `HierarchyTreeVM` (`Roots`, `Selection`, `Anchor`), `HierarchyItemVM` (`IsExpanded`, `CanonicalName`, `Children`, `PropertyChanged`), `IBagPersister` (`Bag(kind,id)` → `IPropertyBag` with `GetValue`/`SetValue`), `Solution` (`HasLocation`, `Storage.Root`).
- Produces: `class SolutionTreeStateService` with `constructor(tree, solution, bags)`, `Start(): void`, `dispose(): void`. Writes `{ expanded, selection, anchor }` to a `'solution-tree-state'` bag keyed by the solution path (in-memory when untitled).

- [ ] **Step 1: Write the failing tests**

Create `services/tests/solution-tree-state-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ServiceProvider, ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import {
    HierarchyModel, HierarchyContributorRegistry, HierarchyContributorDefinition,
    NodeContribution, NodeSeverity, HierarchyTreeVM,
    type IHierarchyContributor, type HierarchyNode, type HierarchyHost,
} from '@pragmatic-tech-ai/mural/framework/hierarchy'
import type { IStorage, IPropertyBag } from '@pragmatic-tech-ai/todl-runtime'
import { Solution, RecordPropertyBag, BagScope, type IBagPersister } from '@pragmatic-tech-ai/todl'
import { SolutionTreeStateService } from '../solution-tree-state-service.js'

function fakeHost(): HierarchyHost
{
    return { Activate: () => {}, CommitRename: () => {}, Delete: () => {}, ActionsFor: () => [], CanDrop: () => false, Drop: () => {}, OnItemRemoved: () => {} }
}

// Minimal Global-scope persister: kind -> id -> live values map, create-on-write.
class FakeBags implements IBagPersister
{
    public readonly Scope = BagScope.Global
    private readonly live = new Map<string, Map<string, Map<string, unknown>>>()
    public Ids(kind: string): readonly string[] { return [...(this.live.get(kind)?.keys() ?? [])] }
    public Bag(kind: string, id: string): IPropertyBag { return new RecordPropertyBag(this.ensure(kind, id)) }
    public Create(kind: string, id: string): IPropertyBag { return this.Bag(kind, id) }
    public Delete(kind: string, id: string): void { this.live.get(kind)?.delete(id) }
    public Flush(): Promise<void> { return Promise.resolve() }
    private ensure(kind: string, id: string): Map<string, unknown>
    {
        let byId = this.live.get(kind); if (byId === undefined) { byId = new Map(); this.live.set(kind, byId) }
        let v = byId.get(id); if (v === undefined) { v = new Map(); byId.set(id, v) }
        return v
    }
}

// A solution tree with two keyed member roots (segments p1/p2), each expandable with one keyed child.
function makeTree(): { tree: HierarchyTreeVM }
{
    const sp = new ServiceProvider()
    const listing = new ServiceKey<IHierarchyContributor>('listing')
    sp.registerInstance(listing, { ParentKeys: ['solution'], Order: 0, Contribute: (): NodeContribution =>
        new NodeContribution([
            { Key: 'project', Caption: 'P1', IconKey: '', ExtObject: { a: 1 }, Severity: NodeSeverity.Ok, CanonicalSegment: 'p1', IsExpandable: true },
            { Key: 'project', Caption: 'P2', IconKey: '', ExtObject: { a: 2 }, Severity: NodeSeverity.Ok, CanonicalSegment: 'p2', IsExpandable: true },
        ]) } as IHierarchyContributor)
    const child = new ServiceKey<IHierarchyContributor>('child')
    sp.registerInstance(child, { ParentKeys: ['project'], Order: 0, Contribute: (p: HierarchyNode): NodeContribution =>
        new NodeContribution([{ Key: 'doc', Caption: 'c', IconKey: '', ExtObject: { of: (p.ExtObject as { a: number }).a }, Severity: NodeSeverity.Ok, CanonicalSegment: 'core.todl' }]) } as IHierarchyContributor)
    const registry = new HierarchyContributorRegistry(sp)
    for (const [k, pk] of [[listing, 'solution'], [child, 'project']] as const)
    {
        const d = new HierarchyContributorDefinition(); d.ParentKeys = [pk]; d.Contributor = k; d.Order = 0; registry.Register(d)
    }
    const model = new HierarchyModel(registry)
    const root = model.SeedRoot({ Key: 'solution', Caption: 'S', IconKey: '', ExtObject: {}, Severity: NodeSeverity.Ok })
    return { tree: new HierarchyTreeVM(model, root, fakeHost()) }
}

function titledSolution(): Solution { return new Solution('S', { Root: 'C:/sol' } as unknown as IStorage) }

describe('SolutionTreeStateService — persist', () =>
{
    it('writes the expanded + selection + anchor canonical names to the path-keyed bag', () =>
    {
        const { tree } = makeTree()
        const bags = new FakeBags()
        const solution = titledSolution()
        new SolutionTreeStateService(tree, solution, bags).Start()

        const p1 = tree.Roots.Get(0)!
        p1.Expand()                         // realizes p1's child; expansion change persists
        tree.SelectSingle(p1)               // selection change persists

        const bag = bags.Bag('solution-tree-state', 'C:/sol')
        expect(bag.GetValue('expanded')).toEqual(['solution/p1'])
        expect(bag.GetValue('selection')).toEqual(['solution/p1'])
        expect(bag.GetValue('anchor')).toBe('solution/p1')
    })

    it('an untitled solution never writes to the durable store', () =>
    {
        const { tree } = makeTree()
        const bags = new FakeBags()
        const untitled = new Solution('S')          // HasLocation === false
        new SolutionTreeStateService(tree, untitled, bags).Start()

        tree.Roots.Get(0)!.Expand()
        expect(bags.Ids('solution-tree-state')).toEqual([])   // nothing persisted
    })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npx vitest run src/renderer/modules/solution-explorer/services/tests/solution-tree-state-service.test.ts`
Expected: FAIL — module `solution-tree-state-service.js` does not exist.

- [ ] **Step 3: Implement the service (persist only)**

Create `services/solution-tree-state-service.ts`:

```ts
import type { Disposable, IPropertyBag } from '@pragmatic-tech-ai/todl-runtime'
import type { IBagPersister, Solution } from '@pragmatic-tech-ai/todl'
import type { HierarchyItemVM, HierarchyTreeVM } from '@pragmatic-tech-ai/mural/framework/hierarchy'

// The persisted per-solution tree view state. All three fields are canonical names.
interface TreeState
{
    expanded: string[]
    selection: string[]
    anchor: string
}

// Persists (and — Task 7 — reactively restores) the Solution Explorer tree's expansion and
// selection, per solution, via the global durable bag store keyed by the solution's on-disk
// path. User-local view state: never committed. An untitled solution (no Storage) is held in
// memory for the session only. Writes go to the in-memory bag synchronously; the durable
// store debounces the actual disk write.
export class SolutionTreeStateService
{
    private static readonly Kind = 'solution-tree-state'
    private static readonly ExpandedProp = 'expanded'
    private static readonly SelectionProp = 'selection'
    private static readonly AnchorProp = 'anchor'

    private readonly subs: Disposable[] = []
    private readonly vmSubs = new Map<HierarchyItemVM, Disposable>()
    private restoring = false
    private disposed = false
    private sessionState: TreeState | undefined   // untitled fallback

    constructor(
        private readonly tree: HierarchyTreeVM,
        private readonly solution: Solution,
        private readonly bags: IBagPersister,
    )
    {
    }

    public Start(): void
    {
        this.watch()
    }

    public dispose(): void
    {
        this.disposed = true
        for (const s of this.subs) s.dispose()
        for (const s of this.vmSubs.values()) s.dispose()
        this.subs.length = 0
        this.vmSubs.clear()
    }

    private watch(): void
    {
        this.subs.push(this.tree.Selection.Subscribe(() => this.save()))
        this.subs.push(this.tree.Roots.Subscribe(() => this.syncRoots()))
        this.syncRoots()
    }

    // Track every current root (and its descendants) for expansion changes; drop trackers
    // for VMs that left the tree.
    private syncRoots(): void
    {
        for (const vm of this.tree.Roots.ToArray()) this.track(vm)
    }

    private track(vm: HierarchyItemVM): void
    {
        if (this.vmSubs.has(vm)) return
        const expansionSub = vm.PropertyChanged('IsExpanded').subscribe(() => this.save())
        const childrenSub = vm.Children.Subscribe(() => { for (const c of vm.Children.ToArray()) this.track(c) })
        this.vmSubs.set(vm, { dispose: () => { expansionSub.dispose(); childrenSub.dispose() } })
        for (const c of vm.Children.ToArray()) this.track(c)
    }

    private save(): void
    {
        if (this.restoring || this.disposed) return
        const expanded: string[] = []
        this.collectExpanded(this.tree.Roots.ToArray(), expanded)
        const selection = this.tree.Selection.ToArray().map((vm) => vm.CanonicalName).filter((n) => n !== '')
        const anchor = this.tree.Anchor?.CanonicalName ?? ''
        this.writeState({ expanded, selection, anchor })
    }

    private collectExpanded(vms: readonly HierarchyItemVM[], out: string[]): void
    {
        for (const vm of vms)
        {
            if (!vm.IsExpanded) continue
            const name = vm.CanonicalName
            if (name !== '') out.push(name)
            this.collectExpanded(vm.Children.ToArray(), out)
        }
    }

    private writeState(state: TreeState): void
    {
        if (!this.solution.HasLocation) { this.sessionState = state; return }
        const bag = this.bag()
        bag.SetValue(SolutionTreeStateService.ExpandedProp, state.expanded)
        bag.SetValue(SolutionTreeStateService.SelectionProp, state.selection)
        bag.SetValue(SolutionTreeStateService.AnchorProp, state.anchor)
    }

    private bag(): IPropertyBag
    {
        return this.bags.Bag(SolutionTreeStateService.Kind, this.key())
    }

    private key(): string
    {
        return this.solution.Storage?.Root ?? ''
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npx vitest run src/renderer/modules/solution-explorer/services/tests/solution-tree-state-service.test.ts`
Expected: PASS — both persist tests green.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Eugene/Projects/architecture-agent/Plexus
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-tree-state-service.ts packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/solution-tree-state-service.test.ts
git commit -m "feat(solution-explorer): persist tree expansion/selection per solution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `SolutionTreeStateService` — reactive restore (Plexus)

**Files:**
- Modify: `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-tree-state-service.ts`
- Test: `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/solution-tree-state-service.test.ts` (append)

**Interfaces:**
- Consumes: Task 6's service; `HierarchyTreeVM.SyncSelection`, `HierarchyItemVM.Expand`.
- Produces: `Start()` now restores first, then watches; expansion + selection apply reactively as VMs appear; missing/corrupt state and stale names are tolerated.

- [ ] **Step 1: Write the failing tests**

Append to `services/tests/solution-tree-state-service.test.ts`:

```ts
describe('SolutionTreeStateService — restore', () =>
{
    it('reactively restores expansion and selection, skipping stale names', () =>
    {
        const bags = new FakeBags()
        const seed = bags.Bag('solution-tree-state', 'C:/sol')
        seed.SetValue('expanded', ['solution/p1'])
        seed.SetValue('selection', ['solution/p2', 'solution/ghost'])   // ghost no longer exists
        seed.SetValue('anchor', 'solution/p2')

        const { tree } = makeTree()
        new SolutionTreeStateService(tree, titledSolution(), bags).Start()

        const [p1, p2] = [tree.Roots.Get(0)!, tree.Roots.Get(1)!]
        expect(p1.IsExpanded).toBe(true)                 // restored expansion
        expect(p2.IsExpanded).toBe(false)
        expect(tree.Selection.ToArray()).toEqual([p2])   // ghost skipped
        expect(tree.Anchor).toBe(p2)
    })

    it('builds cleanly when the bag is empty', () =>
    {
        const { tree } = makeTree()
        expect(() => new SolutionTreeStateService(tree, titledSolution(), new FakeBags()).Start()).not.toThrow()
        expect(tree.Roots.Get(0)!.IsExpanded).toBe(false)
    })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npx vitest run src/renderer/modules/solution-explorer/services/tests/solution-tree-state-service.test.ts`
Expected: FAIL — the empty-bag test passes, but the restore test fails: `p1.IsExpanded` is `false` (no restore yet) and selection is empty.

- [ ] **Step 3: Add restore to the service**

Add fields beside the others:

```ts
    private restoreState: TreeState | undefined
    private readonly selectedVms: HierarchyItemVM[] = []
    private anchorVm: HierarchyItemVM | undefined
```

Change `Start()` to restore first:

```ts
    public Start(): void
    {
        this.restoreState = this.readState()
        this.watch()
    }
```

Add `readState` + `asStrings` beside `writeState`:

```ts
    private readState(): TreeState
    {
        if (!this.solution.HasLocation) return this.sessionState ?? { expanded: [], selection: [], anchor: '' }
        const bag = this.bag()
        const anchor = bag.GetValue(SolutionTreeStateService.AnchorProp)
        return {
            expanded: SolutionTreeStateService.asStrings(bag.GetValue(SolutionTreeStateService.ExpandedProp)),
            selection: SolutionTreeStateService.asStrings(bag.GetValue(SolutionTreeStateService.SelectionProp)),
            anchor: typeof anchor === 'string' ? anchor : '',
        }
    }

    private static asStrings(raw: unknown): string[]
    {
        return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
    }
```

Apply restore when each VM is first tracked — extend `track` to call `applyRestore`:

```ts
    private track(vm: HierarchyItemVM): void
    {
        if (this.vmSubs.has(vm)) return
        const expansionSub = vm.PropertyChanged('IsExpanded').subscribe(() => this.save())
        const childrenSub = vm.Children.Subscribe(() => { for (const c of vm.Children.ToArray()) this.track(c) })
        this.vmSubs.set(vm, { dispose: () => { expansionSub.dispose(); childrenSub.dispose() } })
        this.applyRestore(vm)
        for (const c of vm.Children.ToArray()) this.track(c)
    }

    private applyRestore(vm: HierarchyItemVM): void
    {
        const state = this.restoreState
        if (state === undefined) return
        const name = vm.CanonicalName
        if (name === '') return
        if (state.selection.includes(name))
        {
            this.selectedVms.push(vm)
            if (name === state.anchor) this.anchorVm = vm
            this.withRestoring(() => this.tree.SyncSelection(this.selectedVms, this.anchorVm ?? this.selectedVms[this.selectedVms.length - 1]))
        }
        if (state.expanded.includes(name)) this.withRestoring(() => vm.Expand())   // cascades: realized children are tracked + restored
    }

    private withRestoring(action: () => void): void
    {
        this.restoring = true
        try { action() }
        finally { this.restoring = false }
    }
```

(Order matters: apply selection before expand so a node that is both selected and expanded is selected before its `Expand` triggers child tracking.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npx vitest run src/renderer/modules/solution-explorer/services/tests/solution-tree-state-service.test.ts`
Expected: PASS — all four tests green.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/Eugene/Projects/architecture-agent/Plexus
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-tree-state-service.ts packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/solution-tree-state-service.test.ts
git commit -m "feat(solution-explorer): reactive restore of tree expansion/selection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Expansion behavior + wire the service live (Plexus)

**Files:**
- Create: `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/behaviors/hierarchy-expansion-behavior.ts`
- Test: `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/behaviors/tests/hierarchy-expansion-behavior.test.ts` (new)
- Modify: `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-explorer-service.ts`
- Modify: `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/solution-explorer.resources.mu`

**Interfaces:**
- Consumes: Task 3's `HierarchyItemVM.IsExpanded`; Task 6/7's `SolutionTreeStateService`; `ItemsControl.Add/RemoveContainerPreparedListener`/`...ClearedListener`; `GlobalBagPersisterKey`.
- Produces: `class HierarchyExpansionBehavior` (with testable `Wire(container, item)` / `Unwire(container)`); `SolutionExplorerService.rebuild` constructs + `Start`s the state service, `teardownCurrent` disposes it.

- [ ] **Step 1: Write the failing behavior test**

Create `behaviors/tests/hierarchy-expansion-behavior.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Observable } from '@pragmatic-tech-ai/mural/runtime'
import { HierarchyExpansionBehavior } from '../hierarchy-expansion-behavior.js'

class FakeVm extends Observable
{
    private _expanded: boolean
    constructor(expanded: boolean) { super(); this._expanded = expanded }
    public get IsExpanded(): boolean { return this._expanded }
    public Set(v: boolean): void { const old = this._expanded; this._expanded = v; this.RaisePropertyChanged('IsExpanded', old, v) }
}

describe('HierarchyExpansionBehavior', () =>
{
    it('sets a container IsExpanded from its VM on wire, then follows VM changes', () =>
    {
        const b = new HierarchyExpansionBehavior()
        const vm = new FakeVm(true)
        const container = { IsExpanded: false }
        b.Wire(container, vm)
        expect(container.IsExpanded).toBe(true)     // data->view on realize
        vm.Set(false)
        expect(container.IsExpanded).toBe(false)     // follows later change
    })

    it('stops following after Unwire', () =>
    {
        const b = new HierarchyExpansionBehavior()
        const vm = new FakeVm(false)
        const container = { IsExpanded: false }
        b.Wire(container, vm)
        b.Unwire(container)
        vm.Set(true)
        expect(container.IsExpanded).toBe(false)     // no longer synced
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npx vitest run src/renderer/modules/solution-explorer/behaviors/tests/hierarchy-expansion-behavior.test.ts`
Expected: FAIL — module `hierarchy-expansion-behavior.js` does not exist.

- [ ] **Step 3: Implement the behavior**

Create `behaviors/hierarchy-expansion-behavior.ts`:

```ts
import { Behavior, type Visual } from '@pragmatic-tech-ai/mural/runtime'
import { ItemsControl } from '@pragmatic-tech-ai/mural/framework'
import type { Disposable } from '@pragmatic-tech-ai/todl-runtime'

// A row container whose expansion this behavior drives (TreeViewItem at runtime).
interface ExpandableContainer { IsExpanded: boolean }

// A row VM whose expansion this behavior reads (HierarchyItemVM at runtime).
interface ExpandableVm { IsExpanded: boolean; PropertyChanged(name: string): { subscribe(handler: () => void): Disposable } }

// Syncs each realized TreeViewItem's IsExpanded FROM its bound HierarchyItemVM — the
// data->view direction the framework's own view->data relay lacks. Together with the VM's
// programmatic Expand()/Collapse() this lets the tree-state service restore expansion. Attached
// to the Solution Explorer's TreeView alongside HierarchySelectionBehavior; uses the ItemsControl
// container-realization hooks so it works under virtualization.
export class HierarchyExpansionBehavior extends Behavior
{
    private static readonly IsExpandedProp = 'IsExpanded'

    private items: ItemsControl | undefined
    private readonly wired = new Map<object, Disposable>()
    private readonly prepared = (container: Visual, item: unknown): void => this.Wire(container, item)
    private readonly cleared = (container: Visual): void => this.Unwire(container)

    public override OnAttached(visual: Visual): void
    {
        if (!(visual instanceof ItemsControl)) return
        this.items = visual
        visual.AddContainerPreparedListener(this.prepared)
        visual.AddContainerClearedListener(this.cleared)
    }

    public override OnDetached(_visual: Visual): void
    {
        this.items?.RemoveContainerPreparedListener(this.prepared)
        this.items?.RemoveContainerClearedListener(this.cleared)
        for (const d of this.wired.values()) d.dispose()
        this.wired.clear()
        this.items = undefined
    }

    // Realize-time + ongoing sync for one container/VM pair. Public for unit testing.
    public Wire(container: unknown, item: unknown): void
    {
        const c = container as ExpandableContainer
        const vm = item as ExpandableVm | undefined
        if (vm === undefined || typeof vm.IsExpanded !== 'boolean') return
        if (c.IsExpanded !== vm.IsExpanded) c.IsExpanded = vm.IsExpanded
        const sub = vm.PropertyChanged(HierarchyExpansionBehavior.IsExpandedProp).subscribe(() =>
        {
            if (c.IsExpanded !== vm.IsExpanded) c.IsExpanded = vm.IsExpanded
        })
        this.wired.set(container as object, sub)
    }

    public Unwire(container: unknown): void
    {
        const key = container as object
        const sub = this.wired.get(key)
        if (sub !== undefined) { sub.dispose(); this.wired.delete(key) }
    }
}

export default HierarchyExpansionBehavior
```

- [ ] **Step 4: Run the behavior test to verify it passes**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npx vitest run src/renderer/modules/solution-explorer/behaviors/tests/hierarchy-expansion-behavior.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the state service into `SolutionExplorerService`**

In `solution-explorer-service.ts`:

Add the import:

```ts
import { GlobalBagPersisterKey } from '../../bags/global-bag-persister.js'
import { SolutionTreeStateService } from './solution-tree-state-service.js'
```

Add a field beside the others:

```ts
    private treeState: SolutionTreeStateService | undefined
```

In `rebuild`, replace the final `this.setTree(new HierarchyTreeVM(this.model, root, this))` with:

```ts
        const tree = new HierarchyTreeVM(this.model, root, this)
        this.setTree(tree)
        // The global bag persister is registered by the app (P6a DurableStoreRegistration). It
        // is absent in headless/unit contexts, so resolve it optionally — tree-state is a
        // nice-to-have layered on top, never a hard dependency of the tree itself.
        const bags = this.provider.get(GlobalBagPersisterKey)
        if (bags !== undefined)
        {
            this.treeState = new SolutionTreeStateService(tree, solution, bags)
            this.treeState.Start()
        }
```

(`IServiceProvider.get` returns `undefined` when unregistered — the optional peer of `getRequired`, already used elsewhere via `this.Provider.get(...)`.)

In `teardownCurrent`, at the very top (before `this._tree?.dispose()`), add:

```ts
        this.treeState?.dispose()
        this.treeState = undefined
```

- [ ] **Step 6: Attach the behavior in the `.mu`**

In `solution-explorer.resources.mu`, add the import beside the other behavior imports:

```
import HierarchyExpansionBehavior from "./behaviors/hierarchy-expansion-behavior.js"
```

And add it to the TreeView's `.Behaviors` list:

```
                .Behaviors: { HierarchySelectionBehavior HierarchyKeyBehavior HierarchyExpansionBehavior }
```

- [ ] **Step 7: Build plexus-core (compiles the .mu + typechecks the wiring)**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npm run build`
Expected: `compile:mu` emits the updated `.mu.js` and `tsc` passes — the behavior attach resolves and the service wiring typechecks.

- [ ] **Step 8: Run the solution-explorer unit suites**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npx vitest run src/renderer/modules/solution-explorer`
Expected: PASS — behavior + state-service + listing tests green; no regressions in the module.

- [ ] **Step 9: Commit**

```bash
cd C:/Users/Eugene/Projects/architecture-agent/Plexus
git add packages/plexus-core/src/renderer/modules/solution-explorer/behaviors/ packages/plexus-core/src/renderer/modules/solution-explorer/services/solution-explorer-service.ts packages/plexus-core/src/renderer/modules/solution-explorer/solution-explorer.resources.mu packages/plexus-core/src/renderer/modules/solution-explorer/solution-explorer.resources.mu.js
git commit -m "feat(solution-explorer): wire live tree-state restore + expansion behavior

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(Include the generated `.mu.js` if `compile:mu` writes it into the source tree; omit if it lands only in `dist`.)

---

## Task 9: `RemoveMember` + stop auto-dropping unresolved members (Plexus)

**Files:**
- Modify: `Plexus/packages/plexus-core/src/renderer/modules/project-explorer/services/content-mutations.ts` (interface)
- Modify: `Plexus/packages/plexus-core/src/renderer/modules/project-explorer/services/project-explorer-service.ts`
- Test: append to `Plexus/apps/plexus/src/renderer/src/modules/project-explorer/tests/project-explorer-service.test.ts`

**Interfaces:**
- Consumes: existing `closeProject(op)`, `projected`, `manager.ActiveSolution.Members`, `SolutionMember`.
- Produces: `IContentMutations.RemoveMember(member: SolutionMember): Promise<void>`; `ProjectExplorerService.RemoveMember`; `onMemberAdded` no longer calls `dropUnresolvedMember`.

- [ ] **Step 1: Write the failing tests**

Append to the apps/plexus `project-explorer-service.test.ts` (reuses `makeExplorer`, `projectWith`, `fakeProjectFactory`, `FakeStorage`, `SolutionMember`, `SolutionMemberStatus`, `memberSyncTaskFor` already imported in that file):

```ts
test('an unresolved member is NOT auto-dropped; it stays in Members', async () => {
    const { service, manager } = makeExplorer()
    const member = new SolutionMember({ path: './x', type: 'no-such-type' })
    manager.Members.Add(member)                  // triggers the member-sync loop
    member.Status = SolutionMemberStatus.UnknownType
    member.Project = undefined                   // settles waitForResolution (unresolved)
    await memberSyncTaskFor(service, member)
    expect(manager.Members.ToArray()).toContain(member)
})

test('RemoveMember removes an unresolved member directly', async () => {
    const { service, manager } = makeExplorer()
    const member = new SolutionMember({ path: './x', type: 'no-such-type' })
    manager.Members.Add(member)
    member.Project = undefined
    await memberSyncTaskFor(service, member)
    await service.RemoveMember(member)
    expect(manager.Members.ToArray()).not.toContain(member)
})

test('RemoveMember on a projected member routes through the guarded close', async () => {
    const { service, priv, manager } = makeExplorer()
    const op = await priv.addOpenProject(projectWith('A', 'C:/a'), fakeProjectFactory(), new FakeStorage('C:/a'))
    const member = priv.memberFor(op)!
    await service.RemoveMember(member)
    expect(manager.CloseCalls).toContain(member)
})
```

- [ ] **Step 2: Build plexus-core dist + run to verify failure**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npm run build && cd ../../apps/plexus && npx vitest run src/renderer/src/modules/project-explorer/tests/project-explorer-service.test.ts`
Expected: FAIL — `service.RemoveMember` is not a function; and the auto-drop test fails because `onMemberAdded` currently removes the unresolved member.

- [ ] **Step 3: Add `RemoveMember` to the interface**

In `content-mutations.ts`, add to `interface IContentMutations`, next to `CloseMember`:

```ts
    // Remove a member from the solution: a projected member goes through the dirty-tab-guarded
    // close; an unresolved/never-projected member is dropped from Members directly.
    RemoveMember(member: SolutionMember): Promise<void>
```

- [ ] **Step 4: Implement `RemoveMember` and stop the auto-drop**

In `project-explorer-service.ts`, add the method beside `CloseMember`:

```ts
    public async RemoveMember(member: SolutionMember): Promise<void>
    {
        const op = this.projected.get(member)
        if (op !== undefined) { await this.closeProject(op); return }
        this.manager.ActiveSolution?.Members.Remove(member)
    }
```

In `onMemberAdded`, remove the auto-drop. Change:

```ts
        if (member.IsResolved) { await this.projectMember(member); return }
        this.dropUnresolvedMember(member)
```

to:

```ts
        if (member.IsResolved) await this.projectMember(member)
        // Unresolved (unknown type / load failure): leave it in Members so it renders as an
        // error/warning row the user can remove via RemoveMember. (Was: dropUnresolvedMember.)
```

Delete the now-unused `dropUnresolvedMember` method (and its doc comment). If `tsc` reports it is still referenced elsewhere, keep it and have `RemoveMember`'s unresolved branch call it instead of inlining `Members.Remove`.

- [ ] **Step 5: Rebuild dist + run the tests to verify they pass**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npm run build && cd ../../apps/plexus && npx vitest run src/renderer/src/modules/project-explorer/tests/project-explorer-service.test.ts`
Expected: PASS — the three new tests plus the existing project-explorer suite green.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/Eugene/Projects/architecture-agent/Plexus
git add packages/plexus-core/src/renderer/modules/project-explorer/services/content-mutations.ts packages/plexus-core/src/renderer/modules/project-explorer/services/project-explorer-service.ts apps/plexus/src/renderer/src/modules/project-explorer/tests/project-explorer-service.test.ts
git commit -m "feat(project-explorer): RemoveMember + keep unresolved members visible

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Rename the action → "Remove from Solution" (Plexus)

**Files:**
- Modify: `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/services/project-actions-contributor.ts`
- Test: `Plexus/packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/project-actions-contributor.test.ts`

**Interfaces:**
- Consumes: Task 9's `IContentMutations.RemoveMember`.
- Produces: the member-row action labelled `'Remove from Solution'` invoking `m.RemoveMember(member)`.

- [ ] **Step 1: Update the failing test**

In `tests/project-actions-contributor.test.ts`, extend `fakeMutations` to record removals and add `RemoveMember`, and replace the close test:

In `fakeMutations`, add to `rec`:

```ts
        removed: [] as SolutionMember[],
        RemoveMember: async (m: SolutionMember) => { rec.removed.push(m) },
```

and widen the return type annotation to `IContentMutations & { closed: SolutionMember[]; removed: SolutionMember[] }`.

Replace the `'Close routes to mutations.CloseMember'` test with:

```ts
    it('Remove from Solution routes to mutations.RemoveMember with the row member', () =>
    {
        const member = someMember()
        const m = fakeMutations()
        new ProjectActionsContributor(m).ActionsFor(ctxFor(memberRowVm(member))).find((a) => a.Label === 'Remove from Solution')!.Invoke.Execute()
        expect(m.removed.at(-1)).toBe(member)
    })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npx vitest run src/renderer/modules/solution-explorer/services/tests/project-actions-contributor.test.ts`
Expected: FAIL — no action labelled `'Remove from Solution'` (it is still `'Close Project'` → `CloseMember`).

- [ ] **Step 3: Rename the action + reroute**

In `project-actions-contributor.ts`:

Change the constant:

```ts
    private static readonly RemoveLabel = 'Remove from Solution'
```

(remove `CloseLabel`), and change the first returned action:

```ts
            HierarchyAction.Command(ProjectActionsContributor.RemoveLabel, () => void m.RemoveMember(member)),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npx vitest run src/renderer/modules/solution-explorer/services/tests/project-actions-contributor.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + solution-explorer suite**

Run: `cd C:/Users/Eugene/Projects/architecture-agent/Plexus/packages/plexus-core && npm run typecheck && npx vitest run src/renderer/modules/solution-explorer`
Expected: typecheck clean; module suite green.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/Eugene/Projects/architecture-agent/Plexus
git add packages/plexus-core/src/renderer/modules/solution-explorer/services/project-actions-contributor.ts packages/plexus-core/src/renderer/modules/solution-explorer/services/tests/project-actions-contributor.test.ts
git commit -m "feat(solution-explorer): rename Close Project to Remove from Solution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the executor

- **Branches:** Mural work lands on `Mural:p6b-hierarchy-persistence`; Plexus work continues on `Plexus:p6b-persistence-errors` (already holds the spec commits). The final `finishing-a-development-branch` is per-repo.
- **Cross-repo ordering is hard:** Tasks 5–10 will not typecheck until Task 4 has published Mural 0.57.1 and Plexus has installed it. Do Task 4 in order.
- **apps/plexus tests (Task 9) read plexus-core dist** — always `npm run build` in plexus-core before running them.
- **Pre-existing baselines:** plexus-core MAIN suite has 2 known failures (runner alias split); devUI `tsc -p tsconfig.web.json` has 4 known errors (real gate is `electron-vite build`). Neither is a regression.
