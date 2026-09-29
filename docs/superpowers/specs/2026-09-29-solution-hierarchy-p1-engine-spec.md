# Spec — Solution Hierarchy P1: Engine (content store + provider)

> Sub-project P1 of the Solution Hierarchy Migration (umbrella:
> `2026-09-29-solution-hierarchy-migration-spec.md`; framework primitives:
> `2026-09-29-solution-hierarchy-p0-framework-spec.md`, implemented in Mural main).
> On approval this hands to writing-plans.

**Goal:** a reactive, lazy, disk-watched per-project **content store** in TODL that hands a
project's files/folders out as change deltas with stable ids, plus the first real
`IHierarchyProvider` over it, plus member load-status so a broken project no longer aborts a
solution open.

**Architecture:** three repos in release order. **Mural** amends the P0 delta contract so a
provider can supply identity. **todl-runtime** gains two feature-tested storage capabilities
(stat + watch). **TODL** adds a `ProjectContentStore` (its own decoupled `ContentChange` feed),
a thin `ProjectContentProvider` adapter that maps `ContentChange` → mural `HierarchyChange`, and
`SolutionMember.Status`/`Error`.

**Tech stack:** TypeScript, `node:test`, `node:fs/promises`, chokidar (new), `@pragmatic-tech-ai/todl-runtime`,
`@pragmatic-tech-ai/mural` (framework contracts — TODL may now depend on mural).

## 1. What this is — and is not

**In scope (P1):**

- Mural: `ChildAdded(Id, Node)` + `ChildUpdated(Id, Node)`; `HierarchyModel.patch` uses the
  provider-supplied id and refreshes node data in place; a public way for a provider to mint a
  `HierarchyItemId`. Update P0's own tests. Doc-only: record the P1 content-node key families
  (`folder`/`file`/`diagram`/`todl`, TODL-owned — §8) in `KEY-NAMESPACES.md`.
- todl-runtime: `IStatStorage`, `IWatchableStorage`, `FileStat`, feature-test guards;
  `NodeFsStorage` + `FakeStorage` implementations; add `chokidar`.
- TODL: `ProjectContentStore` (+ `ProjectContentNode`, `ContentNodeId`, `ContentChange`),
  `ProjectContentProvider` (`implements IHierarchyProvider`), `SolutionMember.Status`/`Error`,
  `Solution.OpenOne` hardening, an `ActiveSolution`-semantics test.

**Not in scope (later phases):**

- The `SolutionExplorer` capability, the `HierarchyModel` wiring, the projects-listing
  (solution→members) contributor, and the file-tree contributor registration — **P2 (Plexus)**.
- Mutation (new/rename/delete/move) and real `CanAccept` drop rules — **P3**. P1 ships a
  minimal `CanAccept` (returns `false`) so the interface is satisfied.
- Commands/selection — **P4**; cross-hierarchy (Connections/References) — **P5**;
  canonical-name persistence/reactive restore — **P6**.
- No UI, no Plexus edits.

## 2. Cross-repo shape and release order

Land + test + green in each repo, publish, bump the next repo's pin, adopt:

1. **Mural** — contract amendment (§3). Publish (minor bump; P0 has no external consumers, so
   only P0's own tests change).
2. **todl-runtime** — storage capabilities (§4). Publish; bump TODL's pin.
3. **TODL** — store + provider + member status (§5–§9). Publish; TODL bumps its mural pin to the
   §3 release and its todl-runtime pin to the §4 release.

Plexus adopts all three at **P2**. Per the "always latest packages" rule, each bump goes to the
newest published version.

## 3. Mural contract amendment (P0 touch-up)

The P0 `HierarchyChange` delta could not round-trip provider-owned identity (`ChildAdded`
carried no id; `HierarchyModel` minted its own; a provider had no shared `===` handle for
`ChildRemoved`/`ChildUpdated`). Resolution (decided): **the provider mints the id and every
delta carries it.**

`Mural/src/framework/hierarchy/hierarchy-node.ts`:

```ts
export class ChildAdded extends HierarchyChange
{
    constructor(public readonly Id: HierarchyItemId, public readonly Node: HierarchyNode) { super(); }
}
export class ChildUpdated extends HierarchyChange
{
    // now carries fresh node data so a caption/icon refresh is an in-place swap (id unchanged)
    constructor(public readonly Id: HierarchyItemId, public readonly Node: HierarchyNode) { super(); }
}
export class ChildRemoved extends HierarchyChange   // unchanged
{
    constructor(public readonly Id: HierarchyItemId) { super(); }
}
```

Provider id minting — `HierarchyItemId` is abstract (with `Root`/`Nil`); add a public factory so
a provider can create opaque, `===`-stable ids without reaching into `HierarchyModel`'s private
`MintedItemId`:

```ts
abstract class HierarchyItemId
{
    // ... Root, Nil ...
    static Mint(): HierarchyItemId   // returns a fresh unique instance; identity is object identity
}
```

`Mural/src/framework/hierarchy/hierarchy-model.ts` — `patch` (provider regime only):

- `ChildAdded`: store the **supplied** id and node — `this.entries.set(c.Id, { node: c.Node, children: [] }); parent.children.push(c.Id);` (no internal minting).
- `ChildUpdated`: `const e = this.entries.get(c.Id); if (e !== undefined) e.node = c.Node;` — in-place refresh, id preserved (selection survives). Closes the P0 deferred "refresh caption/icon in place".
- `ChildRemoved`: unchanged.

Update P0 tests to the new signatures and add: (a) a `ChildUpdated(id, node')` test asserting the
node's `Caption`/`IconKey` change while the id is `===`-stable; (b) a round-trip test where a fake
provider mints an id, emits `ChildAdded(id, n)`, then `ChildRemoved(id)` with the **same id
instance**, and the child is dropped. The keyed regime is untouched.

## 4. todl-runtime storage capabilities

`IStorage` stays pull-only. Two optional capabilities a backend may implement, feature-tested
exactly like the existing `ILocalFileAccess`/`isLocalFileAccess`.

`todl-runtime/src/storage/storage.ts`:

```ts
export interface FileStat
{
    readonly IsDirectory: boolean;
    readonly Ino: string;    // stringified inode; '' when the platform gives none (0 / unsupported FS)
    readonly Dev: string;    // stringified device id; '' when unavailable
    readonly Size: number;
    readonly MtimeMs: number;
}

export interface IStatStorage
{
    Stat(path: string): Promise<FileStat>;
}

export const enum FileChangeKind { Added, Removed, Changed }

export interface FileChange
{
    readonly Kind: FileChangeKind;
    readonly Path: string;        // project-relative POSIX path
    readonly IsDirectory: boolean;
}

export interface IWatchableStorage
{
    // Watch `path` (one directory level; not recursive — the store watches folders on demand).
    // Returns a disposer. `sink` fires per raw fs event; rename correlation is the store's job.
    Watch(path: string, sink: (change: FileChange) => void): () => void;
}

export function isStatStorage(s: IStorage): s is IStorage & IStatStorage;
export function isWatchableStorage(s: IStorage): s is IStorage & IWatchableStorage;
```

- `NodeFsStorage` (`/node`) implements both. `Stat` → `fs.stat`, mapping `ino`/`dev` to strings
  (`0`/absent → `''`). `Watch` → a per-directory chokidar watcher (`depth: 0`, `ignoreInitial:
  true`), mapping `add`/`addDir`/`unlink`/`unlinkDir`/`change` to `FileChange`; disposer closes
  the watcher. Add `chokidar` to `todl-runtime/package.json`.
- `FakeStorage` implements both for tests: `Stat` returns a synthetic monotonically-assigned
  `Ino` per created path (stable until deletion; a fresh create after delete gets a new ino unless
  a test opts into reuse), `Dev` a constant; `Watch` records sinks per path and exposes a test-only
  `EmitFileChange(path, kind, isDir)` so unit tests inject deterministic events. Guards return true.
- Tests in `todl-runtime/.../tests/`: `Stat` shape over real temp files (ino nonzero on the dev
  box's NTFS) and FakeStorage; `Watch` over a real temp dir (create/delete/rename) using
  condition-based waiting; FakeStorage `EmitFileChange` fan-out.

## 5. TODL content store

`TODL/src/solution-services/project-services/content/`.

`content-node.ts`:

```ts
export type ContentNodeId = string & { readonly __brand: 'ContentNodeId' };

export class ProjectContentNode   // extends Observable (INPC on Path/Name for in-place rename)
{
    readonly Id: ContentNodeId;
    Path: string;                  // project-relative POSIX
    Name: string;
    readonly Kind: ProjectNodeKind;   // Folder | Diagram | Todl | File (existing enum)
}
```

`content-change.ts` — the store's **native, mural-independent** delta:

```ts
export abstract class ContentChange {}
export class ContentAdded   extends ContentChange { constructor(readonly Node: ProjectContentNode) { super(); } }
export class ContentUpdated extends ContentChange { constructor(readonly Node: ProjectContentNode) { super(); } }  // rename → new Path/Name, SAME Id
export class ContentRemoved extends ContentChange { constructor(readonly Id: ContentNodeId) { super(); } }
```

`project-content-store.ts` — `ProjectContentStore`:

```ts
class ProjectContentStore
{
    constructor(storage: IStorage /* may also be IStatStorage & IWatchableStorage */);
    readonly Root: ProjectContentNode;                                   // the project root folder
    ObserveChildren(folder: ContentNodeId, sink: (c: ContentChange) => void): () => void;
    dispose(): void;                                                     // stop all watchers
}
```

**Realize = subscribe + lazy (§2 of the design):**

- First subscriber to a folder (`Signal` `onFirstSubscriber` idiom) → `List` that **one level**;
  for each entry mint-or-reuse a `ProjectContentNode` + `ContentNodeId` (§6), start watching that
  folder (if `isWatchableStorage`), replay one `ContentAdded(node)` per existing child. Initial
  load and later external edits are the **same channel**.
- Last unsubscriber → stop that folder's watcher but **keep its id map**, so a re-subscribe
  re-`List`s, reconciles against the kept map (same path/ino → same id), replays `ContentAdded`,
  and restarts the watcher — identity survives collapse/expand and catches up on changes missed
  while collapsed.
- A store with a plain `IStorage` (no watch capability) still works: lazy load + no live updates
  (memory-tier default unless the fake's watch is used).

## 6. Stable-id assignment and reconciliation

**Decided:** store-assigned opaque `ContentNodeId`, reconciled by **inode+dev where available,
else by path**.

Per folder the store keeps: `byPath: Map<path, ContentNodeId>`, `byIno: Map<'dev:ino', ContentNodeId>`
(only entries with nonzero ino), and `nodes: Map<ContentNodeId, ProjectContentNode>`.

- **Mint:** a fresh `ContentNodeId` (e.g. a monotonic counter or uuid — opaque). On enumerating a
  path: if `isStatStorage`, `Stat` it; if a live `byIno['dev:ino']` exists → **reuse** that id
  (same file, e.g. seen under a different path after a move); else if `byPath[path]` exists →
  reuse; else mint. Populate both maps.
- **Reconciliation across a rename** is done in the watch loop (§7), keyed on ino; the maps above
  are the state it consults.
- **Fallbacks:** ino `''` (unsupported FS / 0) → path-only identity (a rename becomes
  remove+add). Cross-volume move → `dev` differs → different `dev:ino` key → remove+add.
  Inode-reuse-after-delete within the settle window is a possible false match; mitigated by the
  same-`IsDirectory` check (§7) and the short window. These are accepted edges, documented.

## 7. Watch → reconciliation → delta loop

chokidar (via `IWatchableStorage.Watch`) delivers uncorrelated `Added`/`Removed`/`Changed`
`FileChange`s per watched folder. Each folder runs a short **settle window** (default 75 ms;
configurable constant) so a rename's remove+add pair can be correlated:

- `Removed(P)` → **buffer** (record its `ContentNodeId`, ino, dev, kind); do not emit yet.
- `Added(P')` → `Stat(P')`. If a buffered removal has the **same `dev:ino` and same
  `IsDirectory`** → **rename/move**: reuse its id, update `Node.Path`/`Node.Name` in place, emit
  `ContentUpdated(node')`, cancel the buffered removal. Else mint (or reuse by ino/path per §6) and
  emit `ContentAdded(node)`.
- A buffered `Removed` with no ino match by end of window → emit `ContentRemoved(id)`, drop the
  node + map entries.
- `Changed(P)` (file content) → no `ContentChange` unless a node property the tree surfaces
  changes (P1 tree shows Name/Kind only, so this is a no-op; reserved for later).
- The window also coalesces editor save-rename storms.

Determinism for tests: the settle window is injected (constructor option / DI constant) so unit
tests can set it to `0` and drive `EmitFileChange` synchronously; integration tests keep the real
window and poll.

## 8. `ProjectContentProvider` — the adapter to mural

`project-content-provider.ts` — `class ProjectContentProvider implements IHierarchyProvider`. Thin:
it owns a bidirectional `ContentNodeId ↔ HierarchyItemId` map (mint a `HierarchyItemId` on first
sight of a store id) and a `ProjectNodeKind → NodeKey`/`IconKey` mapping.

```ts
ObserveChildren(node: HierarchyItemId, sink: (c: HierarchyChange) => void): () => void
```

- Map the incoming `HierarchyItemId` → its `ContentNodeId` (the provider's own root maps to
  `store.Root.Id`); `store.ObserveChildren(contentFolderId, storeSink)`.
- Translate each `ContentChange` → `HierarchyChange` and call `sink`:
  - `ContentAdded(n)` → `ChildAdded(idFor(n.Id), hierarchyNodeFor(n))`.
  - `ContentUpdated(n)` → `ChildUpdated(idFor(n.Id), hierarchyNodeFor(n))` (same id).
  - `ContentRemoved(cid)` → `ChildRemoved(idFor(cid))`.
- `hierarchyNodeFor(n)`: `{ Key: keyFor(n.Kind), Caption: n.Name, IconKey: iconFor(n.Kind),
  ExtObject: n, Severity: Ok }`. Content-node keys (`folder`/`file`/`diagram`/`todl`) are a
  **TODL-owned** `ContentNodeKey` constant class in the content module — provider-scoped
  presentation families that live below the provider boundary (never contributor-matched, so
  they are *not* added to mural's `NodeKey`). Their allocation is recorded in Mural's
  `KEY-NAMESPACES.md` governance table (doc-only) so the namespace stays authoritative.

Other `IHierarchyProvider` members:

- `GetProperty(id, prop)` → from the store node (`Caption`=Name, `IconKey`, `IsExpandable`=Kind is
  Folder, `CanonicalName`, `ExtObject`, `Severity`).
- `GetCanonicalName(id)` → the node's project-relative path (path IS the canonical name for
  content nodes in P1). `ParseCanonicalName(name)` → the `HierarchyItemId` for that path if the
  store has enumerated it, else `HierarchyItemId.Nil`.
- `CanAccept(target, drop)` → `false` in P1 (real drop rules are P3).

## 9. `SolutionMember` status and open hardening

`SolutionMember`:

```ts
export const enum SolutionMemberStatus { Unopened, Resolved, UnknownType, LoadFailed }
// fields: Status (get/set, raises 'Status', default Unopened); Error: string | undefined
// IsResolved === (Status === Resolved)
```

`Solution.OpenOne(member, storageFor, factoryFor)`:

- `factoryFor(type)` undefined → `Status = UnknownType`, `Project`/`Storage` undefined (already
  non-throwing today).
- `factory.openProject(storage)` **throws** → **catch** → `Status = LoadFailed`,
  `Error = message`, `Project` undefined, **do not rethrow** — sibling members still open. (Fixes
  the long-standing bug: today a mid-open throw aborts the whole solution open.)
- success → `Status = Resolved`.

`ActiveSolution`: already published via `RaisePropertyChanged('ActiveSolution', old, new)`. P1
adds a test pinning that `OpenSolution`/`CloseSolution`/`setActive` publish old→new correctly; no
new code unless the test finds a gap.

## 10. Testing

Two tiers, per the recovered strategy (real fixtures where the engine touches disk):

**Unit (deterministic, `FakeStorage` + injected events, settle window 0):**

- store: lazy one-level load on subscribe; `onLast` stops watch but re-subscribe reuses ids;
  reconciliation cases via `EmitFileChange` — create → `ContentAdded`; delete → `ContentRemoved`;
  same-ino rename → `ContentUpdated` (id stable); ino `''` rename → remove+add; cross-`dev` →
  remove+add; inode-reuse-in-window with differing kind → not merged.
- provider: `ContentChange` → `HierarchyChange` mapping incl. id mint/reuse and the `ExtObject`
  round-trip; `GetCanonicalName`/`ParseCanonicalName` round-trip + `Nil`; `CanAccept` false.
- member/solution: `OpenOne` sets each `Status`; a throwing factory yields `LoadFailed` + `Error`
  and the sibling still reaches `Resolved`; `ActiveSolution` raise semantics.
- Mural (in the Mural repo, alongside P0): §3 `ChildUpdated` refresh + id round-trip.

**Integration (`NodeFsStorage` + real chokidar + `mkdtemp` temp dirs, real settle window,
condition-based waiting — never fixed sleeps):**

- create a file on disk → observer sees `ChildAdded`; rename on disk → `ChildUpdated` with a
  `===`-stable id; delete → `ChildRemoved`; nested-folder lazy expand loads on subscribe.
- teardown removes the temp dir and disposes the store (all watchers closed).

Introduce `ContentStoreTestHarness` (`memory()` + `realFs(t)` tiers, mirroring the existing
`SolutionsTestCompositionRoot` pattern) to remove per-test `mkdtemp`/cleanup boilerplate.

## 11. Carried and open decisions

- **Decided (this spec):** full disk-watching in P1; store-assigned id + ino/path reconciliation;
  provider mints id + `ChildAdded`/`ChildUpdated` carry it; TODL may depend on mural; store keeps a
  decoupled `ContentChange` feed with a thin adapter provider.
- **Open, deferred:** real `CanAccept` drop rules (P3); whether content-node `IconKey` comes from
  the presentation registry or a fixed map (P2, when the tree renders); recursive/at-scale watch
  budgeting (revisit if large trees stress per-folder watchers).

## 12. Deliverable and release

Three green, independently shippable increments (Mural → todl-runtime → TODL), each with its own
tests passing on a clean checkout. P1 ends when TODL exposes a `ProjectContentProvider` that a P2
`HierarchyModel` can mount over a real project and see files appear, rename in place, and
disappear — live from disk — with member load failures isolated to the failing member.
