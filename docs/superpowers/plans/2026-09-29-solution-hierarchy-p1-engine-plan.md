# Solution Hierarchy P1: Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reactive, lazy, disk-watched per-project content store in TODL that exposes a project's files/folders as change deltas with stable ids through the first real `IHierarchyProvider`, and make a broken member project no longer abort a solution open.

**Architecture:** Three repos, in release order. **Mural** amends the P0 delta contract so a provider supplies identity (`ChildAdded(Id, Node)`, `ChildUpdated(Id, Node)`, `HierarchyItemId.Mint()`). **todl-runtime** gains two feature-tested storage capabilities (`IStatStorage`, `IWatchableStorage`) implemented by `NodeFsStorage` (real `fs.stat` + chokidar) and `FakeStorage` (synthetic inode + injected events). **TODL** adds a decoupled `ProjectContentStore` (its own `ContentChange` feed), a thin `ProjectContentProvider` adapter mapping `ContentChange` → mural `HierarchyChange`, and `SolutionMember.Status`/`Error`.

**Tech Stack:** TypeScript, `node:test` + `tsx --conditions=development`, `node:fs/promises`, chokidar (new todl-runtime dep), `@pragmatic-tech-ai/todl-runtime`, `@pragmatic-tech-ai/mural`.

**Spec:** `Plexus/docs/superpowers/specs/2026-09-29-solution-hierarchy-p1-engine-spec.md` (read it; the umbrella is `2026-09-29-solution-hierarchy-migration-spec.md`, the P0 framework is `2026-09-29-solution-hierarchy-p0-framework-spec.md`).

## Global Constraints

- **Three repos, absolute roots:** Mural `C:\Users\Eugene\Projects\architecture-agent\Mural`; todl-runtime `C:\Users\Eugene\Projects\architecture-agent\todl-runtime`; TODL `C:\Users\Eugene\Projects\architecture-agent\TODL`. Do all git ops (commit) in the repo a task's files live in.
- **Test commands:** Mural — `npx tsx --conditions=development --test --test-force-exit "<glob-or-file>"`; todl-runtime and TODL — `npx tsx --conditions=development --test "<glob-or-file>"`. Per-file: pass the file path in place of the glob.
- **Cross-repo dev resolution:** TODL imports mural + todl-runtime from `node_modules`, which the workspace links to the sibling repos (see [[project_workspace_symlinks_and_prettier]]). After editing a **dependency** repo's `src` (Mural or todl-runtime), run that repo's `npm run build` so its `dist` refreshes and dependents resolve the change (todl-runtime resolves via `dist`, no `development` condition — memory [[project_solution_hierarchy_design]]). A dependency change not visible in TODL means its dist is stale — rebuild it.
- **PUBLISHING IS DEFERRED and norms-gated.** Do NOT `npm publish` any package during this plan. Build + test each repo against local linked sources; the actual Mural→todl-runtime→TODL publishes are a separate step the user runs later (as with P0).
- **House style:** Allman braces (opening brace on its own line) for every class/method/control block; classes over free functions for stateful logic — but *type-guard* functions follow the existing `isLocalFileAccess` precedent in `storage.ts` (a module-level `is<X>` function is the established idiom for these; match it). View-model/definition classes extend `Observable` (INPC) unless they need the DP system.
- **No inline string literals:** hoist reused/user-facing strings to `private static readonly` PascalCase constants (e.g. property-change names, provider ids).
- **Enums, not string-literal unions;** PascalCase for interfaces and public methods.
- **Delta identity:** `ChildAdded`/`ChildUpdated` carry the `HierarchyItemId`; a provider mints ids via `HierarchyItemId.Mint()` and reuses the same instance per store node.
- **Stable id:** store-assigned opaque `ContentNodeId`, reconciled by inode+dev where nonzero, else by path.
- **Disposer convention:** `IHierarchyProvider.ObserveChildren`, the store's `ObserveChildren`, and `IWatchableStorage.Watch` return `() => void`. todl-runtime's `Signal.subscribe` returns a `Disposable` (`{ dispose(): void }`) — wrap it to a `() => void` at these boundaries.
- **Tests live in a `tests/` subfolder** next to the source ([[feedback_tests_in_tests_subfolder]]).
- **Attribution:** end each commit message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus

- **A rename observed as unlink+add within the settle window** coalesces to one `ContentUpdated` with a stable id, not `ContentRemoved`+`ContentAdded` — Task 6 same-ino-rename test.
- **`ino=''` / unsupported-FS rename**: with no inode, a rename must degrade to `ContentRemoved`+`ContentAdded` (new id) — never drop the node silently or hang the buffered removal — Task 6 test.
- **Inode reuse after delete+recreate inside the window**: a new file reusing a just-deleted inode must NOT be mis-merged when the kind differs (dir vs file) — Task 6 test.
- **Deleting a folder that has realized (subscribed) children**: removing an expanded folder disposes its watcher and drops its folder state — no leaked watcher, no post-removal delta reaches its old subscriber — Task 6 folder-removal test.
- **One member's `openProject` throws**: sibling members still open and reach `Resolved`; the thrower is `LoadFailed` with its `Error` captured — Task 8 test.

---

## MURAL — contract amendment

### Task 1: Provider-supplied identity in the delta contract

**Files:**
- Modify: `Mural/src/framework/hierarchy/hierarchy-node.ts` (`ChildAdded`, `ChildUpdated`, `HierarchyItemId`)
- Modify: `Mural/src/framework/hierarchy/hierarchy-model.ts` (`patch`)
- Modify (tests, update to new signatures): `Mural/src/framework/hierarchy/tests/hierarchy-node.test.ts`, `Mural/src/framework/hierarchy/tests/hierarchy-model.test.ts`, `Mural/src/framework/hierarchy/tests/hierarchy-model-live.test.ts`
- Modify: `Mural/package.json` (add a `./framework/hierarchy` export so TODL imports only the hierarchy contracts, not the whole framework barrel)
- Modify (doc): `Mural/docs/KEY-NAMESPACES.md`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `class ChildAdded extends HierarchyChange { constructor(readonly Id: HierarchyItemId, readonly Node: HierarchyNode) }`; `class ChildUpdated extends HierarchyChange { constructor(readonly Id: HierarchyItemId, readonly Node: HierarchyNode) }`; `HierarchyItemId.Mint(): HierarchyItemId` (fresh unique instance; identity is object identity). `ChildRemoved(Id)` unchanged. `HierarchyModel.patch` stores the supplied id on `ChildAdded` and swaps node data in place on `ChildUpdated`.

- [ ] **Step 1: Write the failing test** — add to `hierarchy-model.test.ts` (it already imports `HierarchyItemId`, `ChildAdded`, `ChildUpdated`, `ChildRemoved`, `ProviderContribution`, `NodeContribution`, `NodeSeverity`, and defines `node(key, ext, caption)` + `FakeProvider` + `registryWith`):

```ts
test('provider-supplied id: ChildAdded carries the id; ChildUpdated(id, node) refreshes in place', () =>
{
    const provider = new ServiceProvider();
    const fake = new FakeProvider();
    const tok = new ServiceKey<IHierarchyContributor>('files');
    provider.registerInstance(tok, { ParentKeys: ['project'], Order: 0,
        Contribute: () => new ProviderContribution(fake) } as IHierarchyContributor);
    const model = new HierarchyModel(registryWith(provider, [{ token: tok, parents: ['project'] }]));
    const root = model.SeedRoot(node('project', {}));
    model.RealizeChildren(root);

    const id = HierarchyItemId.Mint();
    fake.Sink!(new ChildAdded(id, node('file', { id: 'f1' }, 'old')));
    assert.equal(model.ChildrenOf(root)[0], id);                       // the SAME id instance is stored
    assert.equal(model.NodeAt(id).Caption, 'old');

    fake.Sink!(new ChildUpdated(id, node('file', { id: 'f1' }, 'new')));
    assert.equal(model.ChildrenOf(root)[0], id);                       // identity preserved
    assert.equal(model.NodeAt(id).Caption, 'new');                     // caption refreshed in place

    fake.Sink!(new ChildRemoved(id));
    assert.equal(model.ChildrenOf(root).length, 0);                    // same id instance removes
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test --test-force-exit "src/framework/hierarchy/tests/hierarchy-model.test.ts"` (from the Mural repo)
Expected: FAIL — `new ChildAdded(id, ...)` is a type/arity error (ChildAdded currently takes only `Node`), and/or `NodeAt(id).Caption` is `'old'` after the update because `ChildUpdated` is a no-op.

- [ ] **Step 3: Amend the contract** — in `hierarchy-node.ts`:

```ts
export abstract class HierarchyItemId
{
    protected constructor() {}
    public static readonly Root: HierarchyItemId = new (class extends HierarchyItemId {})();
    public static readonly Nil:  HierarchyItemId = new (class extends HierarchyItemId {})();
    // A fresh, unique handle a provider mints for one of its opaque-branch nodes.
    // Identity is object identity — the provider caches and reuses the instance.
    public static Mint(): HierarchyItemId { return new (class extends HierarchyItemId {})(); }
}
```

```ts
export class ChildAdded extends HierarchyChange
{
    constructor(public readonly Id: HierarchyItemId, public readonly Node: HierarchyNode) { super(); }
}

export class ChildUpdated extends HierarchyChange
{
    // Carries fresh node data so a caption/icon refresh is an in-place swap (id unchanged).
    constructor(public readonly Id: HierarchyItemId, public readonly Node: HierarchyNode) { super(); }
}
```

(`ChildRemoved` stays `constructor(public readonly Id: HierarchyItemId)`.)

- [ ] **Step 4: Update `HierarchyModel.patch`** — in `hierarchy-model.ts`, replace the `patch` body's branches:

```ts
    private patch(entry: Entry, change: HierarchyChange): void
    {
        if (entry.dispose === undefined) return;   // collapsed — ignore late deltas
        if (change instanceof ChildAdded)
        {
            this.entries.set(change.Id, { node: change.Node, children: [] });
            entry.children.push(change.Id);
        }
        else if (change instanceof ChildUpdated)
        {
            const e = this.entries.get(change.Id);
            if (e !== undefined) e.node = change.Node;   // refresh in place; id preserved
        }
        else if (change instanceof ChildRemoved)
        {
            const i = entry.children.indexOf(change.Id);
            if (i >= 0) entry.children.splice(i, 1);
            this.entries.delete(change.Id);
        }
    }
```

(The keyed regime — `internKeyed`, `MintedItemId`, `reRealizeKeyed`, `pruneKeyed` — is untouched; `MintedItemId` stays in use there.)

- [ ] **Step 5: Update the existing P0 tests to the new signatures**

In `hierarchy-node.test.ts`, the change-class construction test now needs a node for `ChildUpdated`/`ChildAdded`. Replace the assertions that build `new ChildAdded(...)` / `new ChildUpdated(HierarchyItemId.Nil)` with:

```ts
    const n = { Key: 'k', Caption: 'c', IconKey: '', ExtObject: {}, Severity: NodeSeverity.Ok };
    assert.equal(new ChildAdded(HierarchyItemId.Nil, n).Node, n);
    assert.equal(new ChildAdded(HierarchyItemId.Nil, n).Id, HierarchyItemId.Nil);
    assert.equal(new ChildRemoved(HierarchyItemId.Nil).Id, HierarchyItemId.Nil);
    assert.equal(new ChildUpdated(HierarchyItemId.Nil, n).Id, HierarchyItemId.Nil);
    assert.equal(new ChildUpdated(HierarchyItemId.Nil, n).Node, n);
```

In `hierarchy-model.test.ts`, every `new ChildAdded(node(...))` becomes `new ChildAdded(HierarchyItemId.Mint(), node(...))`, capturing the id where the test later references it. The existing test `'ChildUpdated keeps the same id (selection survives); ChildRemoved drops it'` builds its child via `ChildAdded`, captures `const id = model.ChildrenOf(root)[0]`, then must pass a node to `ChildUpdated`: change `fake.Sink!(new ChildUpdated(id))` to `fake.Sink!(new ChildUpdated(id, node('file', { id: 'f1' }, 'renamed')))` and add `assert.equal(model.NodeAt(id).Caption, 'renamed')`. For the `ChildAdded` calls where the test asserts child count only (e.g. the realize=subscribe test), mint an id inline: `fake.Sink!(new ChildAdded(HierarchyItemId.Mint(), node('file', { id: 'f1' })))`.

In `hierarchy-model-live.test.ts` there are no provider `ChildAdded` calls (it drives the keyed regime), so no signature change is needed — but run it to confirm.

- [ ] **Step 6: Run the full hierarchy suite to verify green**

Run: `npx tsx --conditions=development --test --test-force-exit "src/framework/hierarchy/tests/*.test.ts"`
Expected: PASS — all hierarchy tests green (the new test + the updated P0 tests). Then run `npx tsc --noEmit -p tsconfig.json` and confirm 0 errors in `src/framework/hierarchy/**`.

- [ ] **Step 7: Add the `./framework/hierarchy` package export**

TODL needs only the hierarchy contracts, not Mural's full `./framework` barrel (which drags in every control + the visual engine). In `Mural/package.json` `exports`, add a subpath mirroring the existing `./framework` entry but pointing at the hierarchy barrel:

```json
    "./framework/hierarchy": {
      "types": "./dist/framework/hierarchy/index.d.ts",
      "import": {
        "development": "./src/framework/hierarchy/index.ts",
        "default": "./dist/framework/hierarchy/index.js"
      }
    },
```

Verify it resolves under the dev condition: `node --conditions=development -e "import('@pragmatic-tech-ai/mural/framework/hierarchy').then(m => console.log(typeof m.HierarchyItemId, typeof m.ChildAdded))"` run from the Mural repo — expect `function function`. (This is what TODL Tasks 7 and 9 import from.)

- [ ] **Step 8: Record the content-node key families in the governance doc**

In `Mural/docs/KEY-NAMESPACES.md`, add a row to the allocation table noting the P1 content-node presentation keys are **TODL-owned** (a `ContentNodeKey` class in TODL's content module — see Task 4), provider-scoped, not contributor-matched: values `folder`, `file`, `diagram`, `todl`. (Doc-only; no code in Mural for these.)

- [ ] **Step 9: Commit**

```bash
git add src/framework/hierarchy/hierarchy-node.ts src/framework/hierarchy/hierarchy-model.ts src/framework/hierarchy/tests package.json docs/KEY-NAMESPACES.md
git commit -m "feat(hierarchy): provider-supplied delta identity (ChildAdded/ChildUpdated carry Id) + HierarchyItemId.Mint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Then rebuild Mural's dist so TODL resolves the new contract later: `npm run build` (Mural). Expected: build succeeds.

---

## TODL-RUNTIME — storage capabilities

### Task 2: `IStatStorage` capability (file metadata + inode)

**Files:**
- Modify: `todl-runtime/src/storage/storage.ts` (add `FileStat`, `IStatStorage`, `isStatStorage`)
- Modify: `todl-runtime/src/storage/node-fs-storage.ts` (implement `Stat`)
- Modify: `todl-runtime/src/storage/fake-storage.ts` (implement `Stat` + inode bookkeeping + `SetInoUnavailable`)
- Test: `todl-runtime/src/storage/tests/stat-storage.test.ts`

**Interfaces:**
- Consumes: nothing new (independent of Task 1).
- Produces: `interface FileStat { readonly IsDirectory: boolean; readonly Ino: string; readonly Dev: string; readonly Size: number; readonly MtimeMs: number }`; `interface IStatStorage { Stat(path: string): Promise<FileStat> }`; `function isStatStorage(s: IStorage): s is IStorage & IStatStorage`. `NodeFsStorage` and `FakeStorage` implement `IStatStorage`. `FakeStorage.SetInoUnavailable(path: string): void` (test helper) forces `Ino: ''` for a path.

- [ ] **Step 1: Write the failing test** — `stat-storage.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeStorage, isStatStorage } from '../fake-storage.js';
import { NodeFsStorage } from '../node-fs-storage.js';

test('FakeStorage stats a written file with a stable nonzero ino; guard passes', async () =>
{
    const s = new FakeStorage();
    assert.equal(isStatStorage(s), true);
    await s.WriteText('a.txt', 'hi');
    const st1 = await s.Stat('a.txt');
    assert.equal(st1.IsDirectory, false);
    assert.notEqual(st1.Ino, '');
    const st2 = await s.Stat('a.txt');
    assert.equal(st2.Ino, st1.Ino);                        // stable across calls
});

test('FakeStorage.SetInoUnavailable forces an empty ino (unsupported-FS simulation)', async () =>
{
    const s = new FakeStorage();
    await s.WriteText('a.txt', 'hi');
    s.SetInoUnavailable('a.txt');
    assert.equal((await s.Stat('a.txt')).Ino, '');
});

test('NodeFsStorage stats a real file with a nonzero ino', async () =>
{
    const dir = await mkdtemp(join(tmpdir(), 'statfs-'));
    try
    {
        await writeFile(join(dir, 'a.txt'), 'hi');
        const s = new NodeFsStorage(dir);
        const st = await s.Stat('a.txt');
        assert.equal(st.IsDirectory, false);
        assert.equal(st.Size, 2);
        assert.notEqual(st.Ino, '');                       // NTFS/dev box gives a file id
    }
    finally { await rm(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/storage/tests/stat-storage.test.ts"` (from the todl-runtime repo)
Expected: FAIL — `isStatStorage` / `Stat` / `SetInoUnavailable` are not defined.

- [ ] **Step 3: Add the capability to `storage.ts`** (after `ILocalFileAccess`/`isLocalFileAccess`):

```ts
// File metadata a stat-capable backend surfaces. Ino/Dev are stringified so a
// consumer can key on 'dev:ino' without number precision worries; both are ''
// when the platform gives no stable id (0 / unsupported filesystem).
export interface FileStat
{
    readonly IsDirectory: boolean;
    readonly Ino: string;
    readonly Dev: string;
    readonly Size: number;
    readonly MtimeMs: number;
}

// Optional capability: per-path metadata including a (best-effort) stable file id.
export interface IStatStorage
{
    Stat(path: string): Promise<FileStat>;
}

export function isStatStorage(storage: IStorage): storage is IStorage & IStatStorage
{
    return typeof (storage as Partial<IStatStorage>).Stat === 'function';
}
```

- [ ] **Step 4: Implement `Stat` on `NodeFsStorage`** — import `stat` is already imported; add:

```ts
    public async Stat(path: string): Promise<FileStat>
    {
        const s = await stat(this.resolve(path));
        return {
            IsDirectory: s.isDirectory(),
            Ino: s.ino === 0 ? '' : String(s.ino),
            Dev: s.dev === 0 ? '' : String(s.dev),
            Size: s.size,
            MtimeMs: s.mtimeMs,
        };
    }
```

(Add `FileStat`, `IStatStorage` to the `import type { IStorage, StorageEntry } from './storage.js'` line; declare `implements IStorage, IStatStorage`.)

- [ ] **Step 5: Implement `Stat` + inode bookkeeping on `FakeStorage`** — add a private counter and map, assign an ino on first write/create, carry it across `Rename`, drop it on `Delete`, and a test helper:

```ts
    private nextIno = 1;
    private readonly inos = new Map<string, string>();     // normalized path -> ino ('' = unavailable)

    private inoFor(key: string): string
    {
        let v = this.inos.get(key);
        if (v === undefined) { v = String(this.nextIno++); this.inos.set(key, v); }
        return v;
    }

    public SetInoUnavailable(path: string): void
    {
        this.inos.set(normalize(path), '');
    }

    public Stat(path: string): Promise<FileStat>
    {
        const key = normalize(path);
        const isDir = this.dirs.has(key) || [...this.files.keys(), ...this.dirs].some((k) => k.startsWith(key + '/'));
        const content = this.files.get(key);
        return Promise.resolve({
            IsDirectory: isDir && content === undefined,
            Ino: this.inoFor(key),
            Dev: 'fake-dev',
            Size: content?.length ?? 0,
            MtimeMs: 0,
        });
    }
```

In `WriteText`/`WriteBytes`/`CreateDirectory`, call `this.inoFor(normalize(path))` so a fresh path gets an ino at creation. In `Delete`, also `this.inos.delete(key)` for the key and each `prefix`-matched descendant. In `Rename`, move the ino entry with the key (mirror the existing `rewrite` loop for `this.inos`, so a rename preserves the ino — the reconciliation tests depend on this). Update the class header to `implements IStorage, IStatStorage` and import `FileStat`, `IStatStorage`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/storage/tests/stat-storage.test.ts"`
Expected: PASS (3/3). Then `npx tsx --conditions=development --test "src/**/*.test.ts"` — the todl-runtime suite stays green.

- [ ] **Step 7: Commit**

```bash
git add src/storage/storage.ts src/storage/node-fs-storage.ts src/storage/fake-storage.ts src/storage/tests/stat-storage.test.ts
git commit -m "feat(storage): IStatStorage capability (file metadata + inode) on NodeFsStorage and FakeStorage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 3: `IWatchableStorage` capability (directory watching)

**Files:**
- Modify: `todl-runtime/src/storage/storage.ts` (`FileChange`, `FileChangeKind`, `IWatchableStorage`, `isWatchableStorage`)
- Modify: `todl-runtime/src/storage/node-fs-storage.ts` (implement `Watch` via chokidar)
- Modify: `todl-runtime/src/storage/fake-storage.ts` (implement `Watch` + `EmitFileChange`)
- Modify: `todl-runtime/package.json` (add `chokidar`)
- Test: `todl-runtime/src/storage/tests/watchable-storage.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `enum FileChangeKind { Added, Removed, Changed }`; `interface FileChange { readonly Kind: FileChangeKind; readonly Path: string; readonly IsDirectory: boolean }`; `interface IWatchableStorage { Watch(path: string, sink: (c: FileChange) => void): () => void }`; `function isWatchableStorage(s): s is IStorage & IWatchableStorage`. `FakeStorage.EmitFileChange(path: string, kind: FileChangeKind, isDirectory: boolean): void` fires the change to that path's parent's watchers.

- [ ] **Step 1: Write the failing test** — `watchable-storage.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeStorage, isWatchableStorage } from '../fake-storage.js';
import { FileChangeKind, type FileChange } from '../storage.js';
import { NodeFsStorage } from '../node-fs-storage.js';

test('FakeStorage.Watch delivers injected FileChanges to a folder subscriber; dispose stops them', () =>
{
    const s = new FakeStorage();
    assert.equal(isWatchableStorage(s), true);
    const seen: FileChange[] = [];
    const off = s.Watch('', (c) => seen.push(c));
    s.EmitFileChange('a.txt', FileChangeKind.Added, false);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].Path, 'a.txt');
    assert.equal(seen[0].Kind, FileChangeKind.Added);
    off();
    s.EmitFileChange('b.txt', FileChangeKind.Added, false);
    assert.equal(seen.length, 1);                          // no delivery after dispose
});

test('NodeFsStorage.Watch reports a real file creation', async () =>
{
    const dir = await mkdtemp(join(tmpdir(), 'watchfs-'));
    const s = new NodeFsStorage(dir);
    const seen: FileChange[] = [];
    const off = s.Watch('', (c) => seen.push(c));
    try
    {
        await writeFile(join(dir, 'a.txt'), 'hi');
        await waitFor(() => seen.some((c) => c.Path === 'a.txt' && c.Kind === FileChangeKind.Added));
    }
    finally { off(); await rm(dir, { recursive: true, force: true }); }
});

// Poll a condition instead of sleeping a fixed time (fs events are timing-sensitive).
async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void>
{
    const start = Date.now();
    while (!cond())
    {
        if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
        await new Promise((r) => setTimeout(r, 25));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/storage/tests/watchable-storage.test.ts"`
Expected: FAIL — `isWatchableStorage`, `FileChangeKind`, `Watch`, `EmitFileChange` are not defined.

- [ ] **Step 3: Add chokidar** — in `todl-runtime/package.json` add `"chokidar": "^4.0.3"` to `dependencies`, then `npm install` in the todl-runtime repo. (Use the newest published version per [[feedback_always_latest_packages]]; `^4` is the current major.)

- [ ] **Step 4: Add the contract to `storage.ts`:**

```ts
export enum FileChangeKind { Added, Removed, Changed }

export interface FileChange
{
    readonly Kind: FileChangeKind;
    readonly Path: string;          // project-relative POSIX path
    readonly IsDirectory: boolean;
}

// Optional capability: watch ONE directory level (non-recursive — a consumer
// watches folders on demand). `sink` fires per raw fs event; correlating a
// rename's Removed+Added pair is the consumer's job. Returns a disposer.
export interface IWatchableStorage
{
    Watch(path: string, sink: (change: FileChange) => void): () => void;
}

export function isWatchableStorage(storage: IStorage): storage is IStorage & IWatchableStorage
{
    return typeof (storage as Partial<IWatchableStorage>).Watch === 'function';
}
```

- [ ] **Step 5: Implement `Watch` on `NodeFsStorage`** — chokidar over the resolved dir, `depth: 0`, `ignoreInitial: true`; map events to `FileChange` with the project-relative POSIX path (relative to `Root`, `/`-separated):

```ts
    public Watch(path: string, sink: (change: FileChange) => void): () => void
    {
        const base = this.resolve(path);
        const watcher = watch(base, { depth: 0, ignoreInitial: true });
        const rel = (abs: string): string =>
            relative(this.Root, abs).split(sep).filter((s) => s !== '').join('/');
        const emit = (kind: FileChangeKind, isDir: boolean) => (abs: string) =>
            sink({ Kind: kind, Path: rel(abs), IsDirectory: isDir });
        watcher.on('add', emit(FileChangeKind.Added, false));
        watcher.on('addDir', emit(FileChangeKind.Added, true));
        watcher.on('unlink', emit(FileChangeKind.Removed, false));
        watcher.on('unlinkDir', emit(FileChangeKind.Removed, true));
        watcher.on('change', emit(FileChangeKind.Changed, false));
        return () => { void watcher.close(); };
    }
```

Add imports: `import { watch } from 'chokidar'`, `relative` to the `node:path` import, and `FileChange`, `FileChangeKind`, `IWatchableStorage` to the type import; declare `implements IStorage, IStatStorage, IWatchableStorage`.

- [ ] **Step 6: Implement `Watch` + `EmitFileChange` on `FakeStorage`** — watchers keyed by the watched folder; `EmitFileChange` routes a change to the watchers of the changed path's parent folder:

```ts
    private readonly watchers = new Map<string, Set<(c: FileChange) => void>>();  // folder key -> sinks

    public Watch(path: string, sink: (c: FileChange) => void): () => void
    {
        const key = normalize(path);
        const set = this.watchers.get(key) ?? new Set();
        set.add(sink);
        this.watchers.set(key, set);
        return () => { set.delete(sink); };
    }

    // Test-only: fire a change for `path` to the watchers of its PARENT folder
    // (a folder watches its direct children).
    public EmitFileChange(path: string, kind: FileChangeKind, isDirectory: boolean): void
    {
        const key = normalize(path);
        const parent = parentOf(key);
        const set = this.watchers.get(parent);
        if (set === undefined) return;
        for (const sink of [...set]) sink({ Kind: kind, Path: key, IsDirectory: isDirectory });
    }
```

Add `FileChange`, `FileChangeKind`, `IWatchableStorage` to imports; declare `implements IStorage, IStatStorage, IWatchableStorage`.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/storage/tests/watchable-storage.test.ts"`
Expected: PASS (2/2). Then run the full todl-runtime suite: `npx tsx --conditions=development --test "src/**/*.test.ts"` — green.

- [ ] **Step 8: Commit + rebuild dist**

```bash
git add src/storage/storage.ts src/storage/node-fs-storage.ts src/storage/fake-storage.ts src/storage/tests/watchable-storage.test.ts package.json package-lock.json
git commit -m "feat(storage): IWatchableStorage capability (chokidar-backed) on NodeFsStorage; FakeStorage event injection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Then `npm run build` (todl-runtime) so TODL resolves the new capabilities. Expected: build succeeds.

---

## TODL — content store, provider, member status

### Task 4: Content-node model, `ContentChange`, `ContentNodeKey`

**Files:**
- Create: `TODL/src/solution-services/project-services/content/content-node.ts`
- Create: `TODL/src/solution-services/project-services/content/content-change.ts`
- Create: `TODL/src/solution-services/project-services/content/content-node-key.ts`
- Test: `TODL/src/solution-services/project-services/content/tests/content-model.test.ts`

**Interfaces:**
- Consumes: `ProjectNodeKind` from `../core/project.js` (`Folder`/`Diagram`/`Todl`/`File`).
- Produces: `type ContentNodeId = string & { readonly __brand: 'ContentNodeId' }`; `class ProjectContentNode extends Observable { readonly Id: ContentNodeId; Path: string; Name: string; readonly Kind: ProjectNodeKind }` (Path/Name settable, raise INPC); `abstract class ContentChange` + `ContentAdded(Node)` / `ContentUpdated(Node)` / `ContentRemoved(Id)`; `class ContentNodeKey { static readonly Folder='folder'; static readonly File='file'; static readonly Diagram='diagram'; static readonly Todl='todl'; static For(kind: ProjectNodeKind): string }`.

- [ ] **Step 1: Write the failing test** — `content-model.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectNodeKind } from '../../core/project.js';
import { ProjectContentNode, type ContentNodeId } from '../content-node.js';
import { ContentAdded, ContentUpdated, ContentRemoved } from '../content-change.js';
import { ContentNodeKey } from '../content-node-key.js';

test('ProjectContentNode carries id/path/name/kind; rename raises Name/Path', () =>
{
    const n = new ProjectContentNode('n1' as ContentNodeId, 'src/a.todl', 'a.todl', ProjectNodeKind.Todl);
    let raised = 0;
    n.PropertyChanged('Name').subscribe(() => raised++);
    n.Name = 'b.todl';
    assert.equal(n.Name, 'b.todl');
    assert.equal(raised, 1);
});

test('ContentChange variants carry their payloads', () =>
{
    const n = new ProjectContentNode('n1' as ContentNodeId, 'a', 'a', ProjectNodeKind.File);
    assert.equal(new ContentAdded(n).Node, n);
    assert.equal(new ContentUpdated(n).Node, n);
    assert.equal(new ContentRemoved('n1' as ContentNodeId).Id, 'n1');
});

test('ContentNodeKey maps kinds to presentation families', () =>
{
    assert.equal(ContentNodeKey.For(ProjectNodeKind.Folder), ContentNodeKey.Folder);
    assert.equal(ContentNodeKey.For(ProjectNodeKind.Diagram), ContentNodeKey.Diagram);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/solution-services/project-services/content/tests/content-model.test.ts"` (from the TODL repo)
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three files.** `content-node.ts`:

```ts
import { Observable } from '@pragmatic-tech-ai/todl-runtime';
import { type ProjectNodeKind } from '../core/project.js';

export type ContentNodeId = string & { readonly __brand: 'ContentNodeId' };

// One file/folder in a project's content tree. Store-owned identity (Id is stable
// across renames); Path/Name are settable so a rename updates in place (INPC), the
// node instance preserved so a bound row keeps selection/expansion.
export class ProjectContentNode extends Observable
{
    private static readonly NameChanged = 'Name';
    private static readonly PathChanged = 'Path';
    public readonly Id: ContentNodeId;
    public readonly Kind: ProjectNodeKind;
    private _path: string;
    private _name: string;

    constructor(id: ContentNodeId, path: string, name: string, kind: ProjectNodeKind)
    {
        super();
        this.Id = id;
        this._path = path;
        this._name = name;
        this.Kind = kind;
    }

    public get Name(): string { return this._name; }
    public set Name(v: string)
    {
        const old = this._name;
        if (old === v) return;
        this._name = v;
        this.RaisePropertyChanged(ProjectContentNode.NameChanged, old, v);
    }

    public get Path(): string { return this._path; }
    public set Path(v: string)
    {
        const old = this._path;
        if (old === v) return;
        this._path = v;
        this.RaisePropertyChanged(ProjectContentNode.PathChanged, old, v);
    }
}
```

`content-change.ts`:

```ts
import { type ProjectContentNode, type ContentNodeId } from './content-node.js';

// The store's native, mural-independent change delta. A P2 provider maps these
// onto mural's ChildAdded/ChildUpdated/ChildRemoved.
export abstract class ContentChange {}

export class ContentAdded extends ContentChange
{
    constructor(public readonly Node: ProjectContentNode) { super(); }
}

export class ContentUpdated extends ContentChange   // rename/refresh: new Path/Name, SAME Id
{
    constructor(public readonly Node: ProjectContentNode) { super(); }
}

export class ContentRemoved extends ContentChange
{
    constructor(public readonly Id: ContentNodeId) { super(); }
}
```

`content-node-key.ts`:

```ts
import { ProjectNodeKind } from '../core/project.js';

// Provider-scoped presentation families for content nodes (below the provider
// boundary — never contributor-matched). Recorded in Mural's KEY-NAMESPACES.md.
export class ContentNodeKey
{
    public static readonly Folder = 'folder';
    public static readonly File = 'file';
    public static readonly Diagram = 'diagram';
    public static readonly Todl = 'todl';

    public static For(kind: ProjectNodeKind): string
    {
        switch (kind)
        {
            case ProjectNodeKind.Folder:  return ContentNodeKey.Folder;
            case ProjectNodeKind.Diagram: return ContentNodeKey.Diagram;
            case ProjectNodeKind.Todl:    return ContentNodeKey.Todl;
            default:                      return ContentNodeKey.File;
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/solution-services/project-services/content/tests/content-model.test.ts"`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/solution-services/project-services/content/content-node.ts src/solution-services/project-services/content/content-change.ts src/solution-services/project-services/content/content-node-key.ts src/solution-services/project-services/content/tests/content-model.test.ts
git commit -m "feat(content): ProjectContentNode + ContentChange + ContentNodeKey model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 5: `ProjectContentStore` — lazy realize-on-subscribe (no watching yet)

**Files:**
- Create: `TODL/src/solution-services/project-services/content/project-content-store.ts`
- Test: `TODL/src/solution-services/project-services/content/tests/content-store-lazy.test.ts`

**Interfaces:**
- Consumes: `ProjectContentNode`/`ContentNodeId` (Task 4), `ContentAdded`/`ContentRemoved`/`ContentUpdated` (Task 4), `ContentNodeKey`? (no — Kind mapping stays in the provider), `IStorage` + `isStatStorage` + `isWatchableStorage` + `compareStorageEntries` (todl-runtime), `ProjectNodeKind`.
- Produces: `class ProjectContentStore { constructor(storage: IStorage); readonly Root: ProjectContentNode; ObserveChildren(folder: ContentNodeId, sink: (c: ContentChange) => void): () => void; dispose(): void }`. Internal helpers used by Task 6: `private folderStateFor(id)`, `private mintNode(parentKey, entry, stat?)`.

Kind derivation from a listing entry (no factory dependency in P1): a directory → `Folder`; a file ending `.archdiagram`/`.diagram` → `Diagram`; `.todl` → `Todl`; else `File`. Hoist the suffix→kind rule into a private static method `kindOf(name, isDirectory)`.

- [ ] **Step 1: Write the failing test** — `content-store-lazy.test.ts` (memory tier, `FakeStorage`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { ProjectContentStore } from '../project-content-store.js';
import { ContentAdded, type ContentChange } from '../content-change.js';
import { type ContentNodeId } from '../content-node.js';

async function seeded(): Promise<FakeStorage>
{
    const s = new FakeStorage();
    await s.WriteText('a.todl', '');
    await s.WriteText('sub/b.todl', '');
    return s;
}

test('subscribing to the root lazily lists one level and replays ContentAdded per child', async () =>
{
    const store = new ProjectContentStore(await seeded());
    const seen: ContentChange[] = [];
    store.ObserveChildren(store.Root.Id, (c) => seen.push(c));
    await store.WhenIdle();                                       // let the async load settle
    const names = seen.filter((c): c is ContentAdded => c instanceof ContentAdded).map((c) => c.Node.Name).sort();
    assert.deepEqual(names, ['a.todl', 'sub']);                  // one level only (not b.todl)
});

test('re-subscribing after dispose reuses the same ContentNodeIds', async () =>
{
    const store = new ProjectContentStore(await seeded());
    const first: ContentNodeId[] = [];
    const off = store.ObserveChildren(store.Root.Id, (c) => { if (c instanceof ContentAdded) first.push(c.Node.Id); });
    await store.WhenIdle();
    off();
    const second: ContentNodeId[] = [];
    store.ObserveChildren(store.Root.Id, (c) => { if (c instanceof ContentAdded) second.push(c.Node.Id); });
    await store.WhenIdle();
    assert.deepEqual([...second].sort(), [...first].sort());     // identity survives collapse/re-expand
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/solution-services/project-services/content/tests/content-store-lazy.test.ts"`
Expected: FAIL — `ProjectContentStore` / `WhenIdle` not defined.

- [ ] **Step 3: Implement the store's lazy core.** Per watched folder keep a state record; `ObserveChildren` ensures the folder is loaded (first subscriber lists one level and mints/reuses nodes), replays a `ContentAdded` snapshot to the new sink, and registers the sink for future deltas (Task 6 fills the watch feed). `WhenIdle()` awaits the in-flight load promise (test seam so tests need no sleeps).

```ts
import { type IStorage, compareStorageEntries } from '@pragmatic-tech-ai/todl-runtime';
import { ProjectNodeKind } from '../core/project.js';
import { ProjectContentNode, type ContentNodeId } from './content-node.js';
import { ContentAdded, type ContentChange } from './content-change.js';

interface FolderState
{
    loaded: boolean;
    loading?: Promise<void>;
    readonly children: Map<ContentNodeId, ProjectContentNode>;   // insertion = child set
    readonly byPath: Map<string, ContentNodeId>;
    readonly byIno: Map<string, ContentNodeId>;                  // 'dev:ino' -> id (nonzero ino only)
    readonly sinks: Set<(c: ContentChange) => void>;
    watchOff?: () => void;
}

export class ProjectContentStore
{
    private static readonly RootPath = '';
    private static readonly DiagramExts = ['.archdiagram', '.diagram'];
    private nextId = 1;
    private readonly folders = new Map<ContentNodeId, FolderState>();   // folder id -> its state
    private readonly nodeById = new Map<ContentNodeId, ProjectContentNode>();
    private readonly pathById = new Map<ContentNodeId, string>();       // folder id -> its project path
    public readonly Root: ProjectContentNode;

    constructor(private readonly storage: IStorage)
    {
        this.Root = new ProjectContentNode(this.mintId(), ProjectContentStore.RootPath, '', ProjectNodeKind.Folder);
        this.pathById.set(this.Root.Id, ProjectContentStore.RootPath);
    }

    public ObserveChildren(folder: ContentNodeId, sink: (c: ContentChange) => void): () => void
    {
        const state = this.stateFor(folder);
        state.sinks.add(sink);
        if (!state.loaded) { state.loading = this.load(folder, state); }
        else { for (const node of state.children.values()) sink(new ContentAdded(node)); }
        return () =>
        {
            state.sinks.delete(sink);
            if (state.sinks.size === 0 && state.watchOff !== undefined) { state.watchOff(); state.watchOff = undefined; }
        };
    }

    public dispose(): void
    {
        for (const s of this.folders.values()) { s.watchOff?.(); s.watchOff = undefined; }
    }

    // Test seam: await any in-flight folder load so assertions need no sleeps.
    public async WhenIdle(): Promise<void>
    {
        for (const s of this.folders.values()) await s.loading;
    }

    private stateFor(folder: ContentNodeId): FolderState
    {
        let s = this.folders.get(folder);
        if (s === undefined)
        {
            s = { loaded: false, children: new Map(), byPath: new Map(), byIno: new Map(), sinks: new Set() };
            this.folders.set(folder, s);
        }
        return s;
    }

    private async load(folder: ContentNodeId, state: FolderState): Promise<void>
    {
        const dirPath = this.pathById.get(folder) ?? ProjectContentStore.RootPath;
        const entries = [...await this.storage.List(dirPath)].sort(compareStorageEntries);
        for (const entry of entries)
        {
            const childPath = dirPath === '' ? entry.Name : `${dirPath}/${entry.Name}`;
            const node = this.internChild(state, childPath, entry.Name, ProjectContentStore.kindOf(entry.Name, entry.IsDirectory));
            for (const sink of [...state.sinks]) sink(new ContentAdded(node));
        }
        state.loaded = true;
        // Task 6 starts the watcher here.
    }

    // Mint-or-reuse a child node by path (Task 6 adds ino reconciliation).
    private internChild(state: FolderState, path: string, name: string, kind: ProjectNodeKind): ProjectContentNode
    {
        const existing = state.byPath.get(path);
        if (existing !== undefined) return state.children.get(existing)!;
        const id = this.mintId();
        const node = new ProjectContentNode(id, path, name, kind);
        state.children.set(id, node);
        state.byPath.set(path, id);
        this.nodeById.set(id, node);
        if (kind === ProjectNodeKind.Folder) this.pathById.set(id, path);
        return node;
    }

    private mintId(): ContentNodeId { return String(this.nextId++) as ContentNodeId; }

    private static kindOf(name: string, isDirectory: boolean): ProjectNodeKind
    {
        if (isDirectory) return ProjectNodeKind.Folder;
        const lower = name.toLowerCase();
        if (ProjectContentStore.DiagramExts.some((e) => lower.endsWith(e))) return ProjectNodeKind.Diagram;
        if (lower.endsWith('.todl')) return ProjectNodeKind.Todl;
        return ProjectNodeKind.File;
    }
}
```

> Implementer note: reuse-by-path in `internChild` is what makes the re-subscribe test pass — the `byPath`/`children` maps persist across an `off()` because they live on the `FolderState` in `this.folders`, which is never cleared on unsubscribe (only the watcher stops).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/solution-services/project-services/content/tests/content-store-lazy.test.ts"`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/solution-services/project-services/content/project-content-store.ts src/solution-services/project-services/content/tests/content-store-lazy.test.ts
git commit -m "feat(content): ProjectContentStore lazy realize-on-subscribe with stable ids

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 6: Watch feed + rename reconciliation in the store

**Files:**
- Modify: `TODL/src/solution-services/project-services/content/project-content-store.ts` (start watcher on load; reconcile events → deltas)
- Test: `TODL/src/solution-services/project-services/content/tests/content-store-watch.test.ts`

**Interfaces:**
- Consumes: `IWatchableStorage`/`isWatchableStorage`, `IStatStorage`/`isStatStorage`, `FileChange`/`FileChangeKind` (todl-runtime); `ContentAdded`/`ContentRemoved`/`ContentUpdated`.
- Produces: no new public API — `load` now starts a watcher (if `isWatchableStorage`) and routes `FileChange`s through a per-folder settle-window reconciler that emits `ContentAdded`/`ContentRemoved`/`ContentUpdated`. Add a constructor option `settleMs` (default 75; tests pass 0).

- [ ] **Step 1: Write the failing test** — `content-store-watch.test.ts` (deterministic, `FakeStorage` + `EmitFileChange`, `settleMs: 0`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage, FileChangeKind } from '@pragmatic-tech-ai/todl-runtime';
import { ProjectContentStore } from '../project-content-store.js';
import { ContentAdded, ContentRemoved, ContentUpdated, type ContentChange } from '../content-change.js';

async function watchedRoot(seed: (s: FakeStorage) => Promise<void>)
{
    const s = new FakeStorage();
    await seed(s);
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const seen: ContentChange[] = [];
    store.ObserveChildren(store.Root.Id, (c) => seen.push(c));
    await store.WhenIdle();
    return { s, store, seen };
}

test('external create emits ContentAdded', async () =>
{
    const { s, seen } = await watchedRoot(async () => {});
    await s.WriteText('a.todl', '');
    s.EmitFileChange('a.todl', FileChangeKind.Added, false);
    await Promise.resolve();
    assert.equal(seen.filter((c) => c instanceof ContentAdded).length, 1);
});

test('same-ino rename emits ContentUpdated with a stable id (not remove+add)', async () =>
{
    const { s, seen } = await watchedRoot(async (st) => { await st.WriteText('a.todl', ''); });
    const addedId = (seen.find((c) => c instanceof ContentAdded) as ContentAdded).Node.Id;
    await s.Rename('a.todl', 'b.todl');                          // FakeStorage carries the ino across
    s.EmitFileChange('a.todl', FileChangeKind.Removed, false);
    s.EmitFileChange('b.todl', FileChangeKind.Added, false);
    await tick();
    const updated = seen.filter((c): c is ContentUpdated => c instanceof ContentUpdated);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].Node.Id, addedId);                  // SAME id
    assert.equal(updated[0].Node.Name, 'b.todl');
    assert.equal(seen.filter((c) => c instanceof ContentRemoved).length, 0);
});

test('ino-unavailable rename degrades to remove+add', async () =>
{
    const { s, seen } = await watchedRoot(async (st) => { await st.WriteText('a.todl', ''); });
    s.SetInoUnavailable('a.todl'); s.SetInoUnavailable('b.todl');
    await s.Rename('a.todl', 'b.todl');
    s.EmitFileChange('a.todl', FileChangeKind.Removed, false);
    s.EmitFileChange('b.todl', FileChangeKind.Added, false);
    await tick();
    assert.equal(seen.filter((c) => c instanceof ContentRemoved).length, 1);
    assert.equal(seen.filter((c) => c instanceof ContentAdded).length, 2);   // initial + the new one
});

test('inode reuse with a different kind is not merged', async () =>
{
    const { s, seen } = await watchedRoot(async (st) => { await st.WriteText('a.todl', ''); });
    await s.Delete('a.todl');
    await s.CreateDirectory('a.todl');                          // a dir reusing the freed name/ino slot
    s.EmitFileChange('a.todl', FileChangeKind.Removed, false);
    s.EmitFileChange('a.todl', FileChangeKind.Added, true);     // IsDirectory = true
    await tick();
    assert.equal(seen.filter((c) => c instanceof ContentRemoved).length, 1);
    assert.equal(seen.filter((c) => c instanceof ContentUpdated).length, 0);  // kind differs → not a rename
});

test('deleting an expanded folder disposes its watcher and drops its state', async () =>
{
    const { s, store, seen } = await watchedRoot(async (st) => { await st.WriteText('sub/a.todl', ''); });
    const subId = (seen.find((c): c is ContentAdded => c instanceof ContentAdded && c.Node.Name === 'sub') as ContentAdded).Node.Id;
    const subSeen: ContentChange[] = [];
    store.ObserveChildren(subId, (c) => subSeen.push(c));       // expand 'sub' → starts its watcher
    await store.WhenIdle();
    assert.ok(subSeen.some((c) => c instanceof ContentAdded));  // saw a.todl
    const before = subSeen.length;

    await s.Delete('sub');
    s.EmitFileChange('sub', FileChangeKind.Removed, true);      // removed at the root level
    await tick();
    assert.equal(seen.filter((c) => c instanceof ContentRemoved && (c as ContentRemoved).Id === subId).length, 1);

    s.EmitFileChange('sub/c.todl', FileChangeKind.Added, false); // a late change into the gone folder
    await tick();
    assert.equal(subSeen.length, before);                       // watcher disposed → no post-removal delta
});

const tick = () => new Promise((r) => setTimeout(r, 5));       // settleMs is 0; one macrotask flush
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/solution-services/project-services/content/tests/content-store-watch.test.ts"`
Expected: FAIL — the constructor takes no options, no watcher fires, no reconciliation.

- [ ] **Step 3: Implement the watch/reconciliation loop.** Add to the store: the constructor options, an `isWatchableStorage`/`isStatStorage` check, a per-folder settle buffer of pending removals keyed by id, and the event handler. Extend `FolderState` with `pendingRemovals: Map<string, { id: ContentNodeId; inoKey: string; isDir: boolean }>` (keyed by path) and a `timer`.

```ts
// constructor signature
constructor(private readonly storage: IStorage, options?: { settleMs?: number })
{
    this.settleMs = options?.settleMs ?? ProjectContentStore.DefaultSettleMs;
    // ... existing Root setup ...
}
// fields
private static readonly DefaultSettleMs = 75;
private readonly settleMs: number;
```

At the end of `load`, start the watcher:

```ts
    if (isWatchableStorage(this.storage))
    {
        const dir = this.pathById.get(folder) ?? ProjectContentStore.RootPath;
        state.watchOff = this.storage.Watch(dir, (c) => { void this.onFileChange(folder, state, c); });
    }
```

The reconciler:

```ts
    private async onFileChange(folder: ContentNodeId, state: FolderState, c: FileChange): Promise<void>
    {
        if (c.Kind === FileChangeKind.Removed)
        {
            const id = state.byPath.get(c.Path);
            if (id === undefined) return;
            const node = state.children.get(id)!;
            state.pendingRemovals.set(c.Path, { id, inoKey: this.inoKeyForNode(state, id), isDir: node.Kind === ProjectNodeKind.Folder });
            this.scheduleFlush(state);
            return;
        }
        if (c.Kind === FileChangeKind.Added)
        {
            const inoKey = await this.inoKeyFor(c.Path);
            const match = this.matchPendingRename(state, inoKey, c.IsDirectory);
            if (match !== undefined)                       // rename: reuse id, update in place
            {
                state.pendingRemovals.delete(match.path);
                const node = state.children.get(match.id)!;
                state.byPath.delete(node.Path);
                node.Name = baseName(c.Path);
                node.Path = c.Path;
                state.byPath.set(c.Path, match.id);
                if (inoKey !== '') state.byIno.set(inoKey, match.id);
                for (const sink of [...state.sinks]) sink(new ContentUpdated(node));
                return;
            }
            const node = this.internChild(state, c.Path, baseName(c.Path), ProjectContentStore.kindOf(baseName(c.Path), c.IsDirectory));
            if (inoKey !== '') state.byIno.set(inoKey, node.Id);
            for (const sink of [...state.sinks]) sink(new ContentAdded(node));
            return;
        }
        // Changed: content-only; the P1 tree surfaces Name/Kind only → no delta.
    }

    private matchPendingRename(state: FolderState, inoKey: string, isDir: boolean): { path: string; id: ContentNodeId } | undefined
    {
        if (inoKey === '') return undefined;               // no inode → cannot correlate; treat as add
        for (const [path, p] of state.pendingRemovals)
        {
            if (p.inoKey === inoKey && p.isDir === isDir) return { path, id: p.id };
        }
        return undefined;
    }

    private scheduleFlush(state: FolderState): void
    {
        if (state.timer !== undefined) return;
        const flush = () =>
        {
            state.timer = undefined;
            for (const [path, p] of [...state.pendingRemovals])
            {
                state.pendingRemovals.delete(path);
                state.children.delete(p.id);
                state.byPath.delete(path);
                this.nodeById.delete(p.id);
                if (p.inoKey !== '') state.byIno.delete(p.inoKey);
                // If the removed node was an expanded folder, dispose its watcher and
                // drop its state so no watcher leaks and no late delta reaches its subscribers.
                const childState = this.folders.get(p.id);
                if (childState !== undefined) { childState.watchOff?.(); this.folders.delete(p.id); }
                this.pathById.delete(p.id);
                for (const sink of [...state.sinks]) sink(new ContentRemoved(p.id));
            }
        };
        state.timer = this.settleMs === 0 ? (setTimeout(flush, 0) as unknown as ReturnType<typeof setTimeout>) : setTimeout(flush, this.settleMs);
    }

    private async inoKeyFor(path: string): Promise<string>
    {
        if (!isStatStorage(this.storage)) return '';
        const st = await this.storage.Stat(path);
        return st.Ino === '' ? '' : `${st.Dev}:${st.Ino}`;
    }

    private inoKeyForNode(state: FolderState, id: ContentNodeId): string
    {
        for (const [k, v] of state.byIno) if (v === id) return k;
        return '';
    }
```

Add `pendingRemovals: Map<string, { id: ContentNodeId; inoKey: string; isDir: boolean }>` and `timer?: ReturnType<typeof setTimeout>` to `FolderState` (initialize `pendingRemovals: new Map()`). Add module-level `baseName(path)` helper (last `/` segment) next to the existing style, or a `private static baseName`. Populate `byIno` during `load` too: after minting a child, `if (isStatStorage(this.storage)) { const k = await this.inoKeyFor(childPath); if (k !== '') state.byIno.set(k, node.Id); }`. Imports: add `isWatchableStorage`, `isStatStorage`, `FileChangeKind`, `type FileChange` from todl-runtime, and `ContentRemoved`, `ContentUpdated` from `./content-change.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/solution-services/project-services/content/tests/content-store-watch.test.ts"`
Expected: PASS (5/5). Then re-run the lazy test from Task 5 to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add src/solution-services/project-services/content/project-content-store.ts src/solution-services/project-services/content/tests/content-store-watch.test.ts
git commit -m "feat(content): watch feed + settle-window rename reconciliation (ino primary, path fallback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 7: `ProjectContentProvider` — adapter to the mural hierarchy contract

**Files:**
- Create: `TODL/src/solution-services/project-services/content/project-content-provider.ts`
- Test: `TODL/src/solution-services/project-services/content/tests/content-provider.test.ts`

**Interfaces:**
- Consumes: `ProjectContentStore` (Tasks 5–6), `ContentAdded`/`ContentUpdated`/`ContentRemoved` + `ProjectContentNode`/`ContentNodeId`, `ContentNodeKey` (Task 4); from `@pragmatic-tech-ai/mural`: `IHierarchyProvider`, `HierarchyItemId`, `HierarchyChange`, `ChildAdded`, `ChildUpdated`, `ChildRemoved`, `HierarchyNode`, `HierarchyPropertyId`, `NodeSeverity`, `DropData`.
- Produces: `class ProjectContentProvider implements IHierarchyProvider` with `constructor(store: ProjectContentStore)`, `ProviderId`, `ObserveChildren`, `GetProperty`, `GetCanonicalName`, `ParseCanonicalName`, `CanAccept`.

- [ ] **Step 1: Write the failing test** — `content-provider.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { ChildAdded, HierarchyItemId, type HierarchyChange } from '@pragmatic-tech-ai/mural/framework/hierarchy';
import { ProjectContentStore } from '../project-content-store.js';
import { ProjectContentProvider } from '../project-content-provider.js';

test('maps ContentAdded → ChildAdded carrying a minted, reused HierarchyItemId', async () =>
{
    const s = new FakeStorage();
    await s.WriteText('a.todl', '');
    const store = new ProjectContentStore(s, { settleMs: 0 });
    const provider = new ProjectContentProvider(store);
    const rootId = provider.ParseCanonicalName('');            // the provider's root handle (path '')
    const seen: HierarchyChange[] = [];
    provider.ObserveChildren(rootId, (c) => seen.push(c));
    await store.WhenIdle();
    const added = seen.filter((c): c is ChildAdded => c instanceof ChildAdded);
    assert.equal(added.length, 1);
    assert.equal(added[0].Node.Caption, 'a.todl');
    assert.equal(added[0].Node.Key, 'todl');
    assert.ok(added[0].Id instanceof HierarchyItemId);
    // GetCanonicalName round-trips to the SAME id instance
    const name = provider.GetCanonicalName(added[0].Id);
    assert.equal(provider.ParseCanonicalName(name), added[0].Id);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/solution-services/project-services/content/tests/content-provider.test.ts"`
Expected: FAIL — `ProjectContentProvider` not defined.

- [ ] **Step 3: Implement the adapter.**

```ts
import {
    type IHierarchyProvider, HierarchyItemId, type HierarchyChange,
    ChildAdded, ChildUpdated, ChildRemoved,
    type HierarchyNode, HierarchyPropertyId, NodeSeverity, type DropData,
} from '@pragmatic-tech-ai/mural/framework/hierarchy';
import { type ProjectContentStore } from './project-content-store.js';
import { type ProjectContentNode, type ContentNodeId } from './content-node.js';
import { ContentAdded, ContentUpdated, ContentRemoved, type ContentChange } from './content-change.js';
import { ContentNodeKey } from './content-node-key.js';
import { ProjectNodeKind } from '../core/project.js';

export class ProjectContentProvider implements IHierarchyProvider
{
    private static readonly Id = 'todl.project-content';
    public readonly ProviderId = ProjectContentProvider.Id;
    private readonly idByContent = new Map<ContentNodeId, HierarchyItemId>();
    private readonly contentById = new Map<HierarchyItemId, ContentNodeId>();
    private readonly pathByItem = new Map<HierarchyItemId, string>();
    private readonly itemByPath = new Map<string, HierarchyItemId>();

    constructor(private readonly store: ProjectContentStore)
    {
        this.bind(store.Root);   // seed the root correspondence so ParseCanonicalName('') works
    }

    public ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
    {
        const contentId = this.contentById.get(node) ?? this.store.Root.Id;
        return this.store.ObserveChildren(contentId, (c: ContentChange) =>
        {
            if (c instanceof ContentAdded)        sink(new ChildAdded(this.idFor(c.Node), this.hierarchyNode(c.Node)));
            else if (c instanceof ContentUpdated) sink(new ChildUpdated(this.idFor(c.Node), this.hierarchyNode(c.Node)));
            else if (c instanceof ContentRemoved) sink(new ChildRemoved(this.idForContentId(c.Id)));
        });
    }

    public GetProperty(id: HierarchyItemId, prop: HierarchyPropertyId): unknown
    {
        const node = this.nodeFor(id);
        if (node === undefined) return undefined;
        switch (prop)
        {
            case HierarchyPropertyId.Caption:       return node.Name;
            case HierarchyPropertyId.IconKey:       return ContentNodeKey.For(node.Kind);
            case HierarchyPropertyId.IsExpandable:  return node.Kind === ProjectNodeKind.Folder;
            case HierarchyPropertyId.CanonicalName: return node.Path;
            case HierarchyPropertyId.ExtObject:     return node;
            case HierarchyPropertyId.Severity:      return NodeSeverity.Ok;
            default:                                return undefined;
        }
    }

    public GetCanonicalName(id: HierarchyItemId): string
    {
        return this.pathByItem.get(id) ?? '';
    }

    public ParseCanonicalName(name: string): HierarchyItemId
    {
        return this.itemByPath.get(name) ?? HierarchyItemId.Nil;
    }

    public CanAccept(_target: HierarchyItemId, _drop: DropData): boolean
    {
        return false;   // real drop rules are P3
    }

    private hierarchyNode(node: ProjectContentNode): HierarchyNode
    {
        return { Key: ContentNodeKey.For(node.Kind), Caption: node.Name, IconKey: ContentNodeKey.For(node.Kind), ExtObject: node, Severity: NodeSeverity.Ok };
    }

    private idFor(node: ProjectContentNode): HierarchyItemId
    {
        const hit = this.idByContent.get(node.Id);
        if (hit !== undefined) { this.pathByItem.set(hit, node.Path); this.itemByPath.set(node.Path, hit); return hit; }
        return this.bind(node);
    }

    private idForContentId(cid: ContentNodeId): HierarchyItemId
    {
        return this.idByContent.get(cid) ?? HierarchyItemId.Nil;
    }

    private bind(node: ProjectContentNode): HierarchyItemId
    {
        const id = HierarchyItemId.Mint();
        this.idByContent.set(node.Id, id);
        this.contentById.set(id, node.Id);
        this.pathByItem.set(id, node.Path);
        this.itemByPath.set(node.Path, id);
        return id;
    }

    private nodeFor(id: HierarchyItemId): ProjectContentNode | undefined
    {
        const cid = this.contentById.get(id);
        return cid === undefined ? undefined : (this.store as unknown as { nodeById: Map<ContentNodeId, ProjectContentNode> }).nodeById.get(cid);
    }
}
```

> Implementer note: `nodeFor` needs read access to the store's node map. Rather than the cast shown, add a public `NodeById(id: ContentNodeId): ProjectContentNode | undefined` accessor to `ProjectContentStore` (returns `this.nodeById.get(id)`) and call that — cleaner, and it keeps `nodeById` private. Update Task 5's produced interface note accordingly when you touch it.

- [ ] **Step 4: Add the store accessor** — in `project-content-store.ts` add:

```ts
    public NodeById(id: ContentNodeId): ProjectContentNode | undefined
    {
        return this.nodeById.get(id);
    }
```

and change `nodeFor` in the provider to `this.store.NodeById(cid)`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/solution-services/project-services/content/tests/content-provider.test.ts"`
Expected: PASS. Then `npx tsc --noEmit -p tsconfig.json` (TODL) — 0 errors in the content module.

- [ ] **Step 6: Commit**

```bash
git add src/solution-services/project-services/content/project-content-provider.ts src/solution-services/project-services/content/project-content-store.ts src/solution-services/project-services/content/tests/content-provider.test.ts
git commit -m "feat(content): ProjectContentProvider adapts ContentChange to mural HierarchyChange (mints ids)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 8: `SolutionMember.Status`/`Error` + open hardening + ActiveSolution test

**Files:**
- Modify: `TODL/src/solution-services/solution-manager/engine/solution-member.ts` (Status/Error)
- Create: `TODL/src/solution-services/solution-manager/engine/solution-member-status.ts` (enum)
- Modify: `TODL/src/solution-services/solution-manager/engine/solution.ts` (`OpenOne` hardening)
- Test: `TODL/src/solution-services/solution-manager/engine/tests/member-status.test.ts`
- Test: `TODL/src/solution-services/solution-manager/engine/tests/active-solution-semantics.test.ts`

**Interfaces:**
- Consumes: existing `Solution`/`SolutionMember`/`ProjectFactoryResolver`/`MemberStorageResolver`.
- Produces: `enum SolutionMemberStatus { Unopened, Resolved, UnknownType, LoadFailed }`; `SolutionMember.Status` (get/set, raises `'Status'`, default `Unopened`) + `SolutionMember.Error: string | undefined`; `IsResolved === (Status === Resolved)`. `Solution.OpenOne` sets each status and catches an `openProject` throw.

- [ ] **Step 1: Write the failing tests** — `member-status.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage } from '@pragmatic-tech-ai/todl-runtime';
import { Solution } from '../solution.js';
import { SolutionMemberStatus } from '../solution-member-status.js';

const storageFor = () => new FakeStorage();

test('unknown type → UnknownType; sibling still opens → Resolved', async () =>
{
    const sol = new Solution('s');
    sol.AddMember('bad', 'no-such-type');
    sol.AddMember('good', 'ok');
    const okFactory = { openProject: async () => ({}) };
    await sol.OpenMembers(storageFor, (type) => (type === 'ok' ? okFactory : undefined) as never);
    assert.equal(sol.Members.Get(0).Status, SolutionMemberStatus.UnknownType);
    assert.equal(sol.Members.Get(1).Status, SolutionMemberStatus.Resolved);
});

test('a factory that throws → LoadFailed + Error, and the sibling still opens', async () =>
{
    const sol = new Solution('s');
    sol.AddMember('boom', 'x');
    sol.AddMember('good', 'x');
    let first = true;
    const factory = { openProject: async () => { if (first) { first = false; throw new Error('bad manifest'); } return {}; } };
    await sol.OpenMembers(storageFor, () => factory as never);
    assert.equal(sol.Members.Get(0).Status, SolutionMemberStatus.LoadFailed);
    assert.equal(sol.Members.Get(0).Error, 'bad manifest');
    assert.equal(sol.Members.Get(1).Status, SolutionMemberStatus.Resolved);   // NOT aborted
});
```

`active-solution-semantics.test.ts`: a focused test on `SolutionManagerService` that opening then closing a solution raises `PropertyChanged('ActiveSolution')` old→new. (Model it on the existing `solution-manager-service.test.ts` setup — reuse `SolutionsTestCompositionRoot` from `../../tests/solutions-test-composition-root.js` to build the service with its host seams, subscribe to `Manager.PropertyChanged('ActiveSolution')`, assert the handler sees the new solution on open and `undefined` on close.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --conditions=development --test "src/solution-services/solution-manager/engine/tests/member-status.test.ts"`
Expected: FAIL — `SolutionMemberStatus` / `member.Status` not defined.

- [ ] **Step 3: Add the enum** — `solution-member-status.ts`:

```ts
// A member's load outcome. Unopened before the solution opens it; Resolved when its
// project handle is live; UnknownType when its type has no registered factory;
// LoadFailed when the factory threw opening it (Error carries the message).
export enum SolutionMemberStatus { Unopened, Resolved, UnknownType, LoadFailed }
```

- [ ] **Step 4: Add Status/Error to `SolutionMember`** — add fields + accessors (raise `'Status'`), default `Unopened`, and redefine `IsResolved`:

```ts
    private static readonly StatusChanged = 'Status';
    private _status: SolutionMemberStatus = SolutionMemberStatus.Unopened;
    private _error: string | undefined;

    public get Status(): SolutionMemberStatus { return this._status; }
    public set Status(v: SolutionMemberStatus)
    {
        const old = this._status;
        this._status = v;
        this.RaisePropertyChanged(SolutionMember.StatusChanged, old, v);
    }

    public get Error(): string | undefined { return this._error; }
    public set Error(v: string | undefined) { this._error = v; }

    public get IsResolved(): boolean { return this._status === SolutionMemberStatus.Resolved; }
```

Import `SolutionMemberStatus`. Remove the old `IsResolved` getter that reads `_project`.

- [ ] **Step 5: Harden `Solution.OpenOne`** — set statuses and catch:

```ts
    public async OpenOne(
        member: SolutionMember,
        storageFor: MemberStorageResolver,
        factoryFor: ProjectFactoryResolver,
    ): Promise<void>
    {
        const factory = factoryFor(member.Ref.type);
        if (factory === undefined)
        {
            member.Project = undefined;
            member.Storage = undefined;
            member.Status = SolutionMemberStatus.UnknownType;
            return;
        }
        const storage = storageFor(member.Ref.path);
        member.Storage = storage;
        try
        {
            member.Project = await factory.openProject(storage);
            member.Error = undefined;
            member.Status = SolutionMemberStatus.Resolved;
        }
        catch (e)
        {
            member.Project = undefined;
            member.Error = e instanceof Error ? e.message : String(e);
            member.Status = SolutionMemberStatus.LoadFailed;
            // swallow — one broken member must not abort the whole solution open
        }
    }
```

Import `SolutionMemberStatus` in `solution.ts`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsx --conditions=development --test "src/solution-services/solution-manager/engine/tests/member-status.test.ts" "src/solution-services/solution-manager/engine/tests/active-solution-semantics.test.ts"`
Expected: PASS. Then run the whole solution-manager engine test folder to confirm the `IsResolved` redefinition broke nothing: `npx tsx --conditions=development --test "src/solution-services/solution-manager/engine/tests/*.test.ts"`.

- [ ] **Step 7: Commit**

```bash
git add src/solution-services/solution-manager/engine/solution-member.ts src/solution-services/solution-manager/engine/solution-member-status.ts src/solution-services/solution-manager/engine/solution.ts src/solution-services/solution-manager/engine/tests/member-status.test.ts src/solution-services/solution-manager/engine/tests/active-solution-semantics.test.ts
git commit -m "feat(solution): SolutionMember.Status/Error; OpenOne isolates a failing member from siblings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 9: Real-fs integration tier + `ContentStoreTestHarness`

**Files:**
- Create: `TODL/src/solution-services/project-services/content/tests/content-store-harness.ts`
- Test: `TODL/src/solution-services/project-services/content/tests/content-store-realfs.test.ts`

**Interfaces:**
- Consumes: `ProjectContentStore`/`ProjectContentProvider` (Tasks 5–7), `NodeFsStorage` (`@pragmatic-tech-ai/todl-runtime/node`), `mkdtemp`/`rm` (`node:fs/promises`).
- Produces: `class ContentStoreTestHarness` with `static async realFs(t): Promise<ContentStoreTestHarness>` (temp-dir `NodeFsStorage` + `t.after` cleanup + store dispose), `Store`, `Provider`, `Dir`, and a `WaitFor(cond)` poller.

- [ ] **Step 1: Write the failing test** — `content-store-realfs.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rename, rm as rmFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChildAdded, ChildUpdated, ChildRemoved, type HierarchyChange } from '@pragmatic-tech-ai/mural/framework/hierarchy';
import { ContentStoreTestHarness } from './content-store-harness.js';

test('a file created on disk surfaces as ChildAdded; rename → ChildUpdated (stable id); delete → ChildRemoved', async (t) =>
{
    const h = await ContentStoreTestHarness.realFs(t);
    const seen: HierarchyChange[] = [];
    const rootId = h.Provider.ParseCanonicalName('');
    h.Provider.ObserveChildren(rootId, (c) => seen.push(c));
    await h.Store.WhenIdle();

    await writeFile(join(h.Dir, 'a.todl'), '');
    await h.WaitFor(() => seen.some((c) => c instanceof ChildAdded));
    const id = (seen.find((c) => c instanceof ChildAdded) as ChildAdded).Id;

    await rename(join(h.Dir, 'a.todl'), join(h.Dir, 'b.todl'));
    await h.WaitFor(() => seen.some((c) => c instanceof ChildUpdated));
    assert.equal((seen.find((c) => c instanceof ChildUpdated) as ChildUpdated).Id, id);   // same id across a real rename

    await rmFile(join(h.Dir, 'b.todl'));
    await h.WaitFor(() => seen.some((c) => c instanceof ChildRemoved));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --conditions=development --test "src/solution-services/project-services/content/tests/content-store-realfs.test.ts"`
Expected: FAIL — `ContentStoreTestHarness` not defined.

- [ ] **Step 3: Implement the harness** — `content-store-harness.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { NodeFsStorage } from '@pragmatic-tech-ai/todl-runtime/node';
import { ProjectContentStore } from '../project-content-store.js';
import { ProjectContentProvider } from '../project-content-provider.js';

export class ContentStoreTestHarness
{
    private constructor(
        public readonly Dir: string,
        public readonly Store: ProjectContentStore,
        public readonly Provider: ProjectContentProvider,
    ) {}

    public static async realFs(t: TestContext): Promise<ContentStoreTestHarness>
    {
        const dir = await mkdtemp(join(tmpdir(), 'content-store-'));
        const store = new ProjectContentStore(new NodeFsStorage(dir));   // real settle window
        const provider = new ProjectContentProvider(store);
        t.after(async () => { store.dispose(); await rm(dir, { recursive: true, force: true }); });
        return new ContentStoreTestHarness(dir, store, provider);
    }

    public async WaitFor(cond: () => boolean, timeoutMs = 5000): Promise<void>
    {
        const start = Date.now();
        while (!cond())
        {
            if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
            await new Promise((r) => setTimeout(r, 25));
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --conditions=development --test "src/solution-services/project-services/content/tests/content-store-realfs.test.ts"`
Expected: PASS. (If the real-fs rename does not correlate on the dev box's filesystem, the store degrades to remove+add — but on NTFS with a same-volume rename the ino is preserved and `ChildUpdated` fires; the test asserts that path. If it proves flaky on this filesystem, that is a genuine finding for the final review, not something to paper over with sleeps.)

- [ ] **Step 5: Commit**

```bash
git add src/solution-services/project-services/content/tests/content-store-harness.ts src/solution-services/project-services/content/tests/content-store-realfs.test.ts
git commit -m "test(content): real-fs integration tier + ContentStoreTestHarness (condition-based waiting)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Run the full TODL suite as the green gate**

Run: `npx tsx --conditions=development --test "src/**/*.test.ts"` (from the TODL repo)
Expected: green — all prior tests plus the new content + member-status tests. No skips introduced. (If a pre-existing unrelated failure appears, report it by name; do not attribute it to this work without evidence.)

---

## Notes for the executor

- **Order matters across repos:** finish and build Mural (Task 1) before TODL Task 7 (which imports the amended `ChildAdded`/`ChildUpdated`/`HierarchyItemId.Mint`), and finish + build todl-runtime (Tasks 2–3) before TODL Tasks 5–6 (which import `isStatStorage`/`isWatchableStorage`/`FileChangeKind`). Within TODL, Tasks 4→5→6→7 are strictly sequential; Task 8 is independent of the content store and can run any time after setup.
- **Do not publish.** Rebuild `dist` on Mural and todl-runtime after their tasks so TODL resolves the changes locally; the npm publishes are the user's deferred, norms-gated step.
