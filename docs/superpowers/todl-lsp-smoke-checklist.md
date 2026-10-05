# TODL Language Service — Manual Smoke Checklist

The irreducibly visual gate for the Plexus TODL language features. Everything
below is headless-tested where possible; this checklist covers what only real
Monaco + Electron can prove. Run with `npm run dev`.

**Architecture (LSP Wave 2):** the TODL language service runs **in-process** in the
renderer — `LspServicesEngine` hosts `SolutionLanguageService` (the single
`ILanguageService` + base-resolution authority); `TodlLanguageClient` is a thin
in-process adapter that keeps the synthetic `todl://` URI scheme, diagnostics
routing, and the `applyWorkspaceEdit` path. There is **no** out-of-process server,
no `build:todl-server`, and no `todlLsp` IPC bridge.

**Prerequisite:** `@pragmatic-tech-ai/todl` (≥ 0.44.0) installed; for live iteration
`npm link` a local TODL checkout with `dist` built. No server bundle is produced.

## Startup / plumbing
- [ ] App launches with no console errors about the language client or base resolution.
- [ ] No extra server child process is spawned (analysis runs in the renderer).

## Diagnostics (in-process, whole-project)
- [ ] Open a TODL project (meta-model / library / architecture). The Problems panel populates from the in-process service.
- [ ] Introduce an error (e.g. a missing required field on an instance) → a red squiggle appears and a Problems entry shows.
- [ ] Fix it → the squiggle and Problems entry clear.
- [ ] A file with an unresolved base binding still shows the "Unresolved base: …" project-level problem.
- [ ] An **unpublished in-solution member** (e.g. a library binding a sibling meta-model that is open but never published) resolves its symbols — NO "not published" / "no publishable version" / mass "undefined symbol" problems (the "0 bases" fix).
- [ ] Edit a `.todl` file that is NOT the active tab (via a second open project) → its diagnostics still update (whole-project analysis).

## Navigation & hover
- [ ] Hover a concept / instance → a hover popup with kind + signature + description.
- [ ] Ctrl-click a reference (e.g. an `extends`, a `&ref`, a relationship target) → jumps to the definition, including cross-file.
- [ ] Find All References on a symbol → lists every occurrence across files.

## Completion (schema-aware)
- [ ] Ctrl-Space in a type slot → concept/primitive/enum names.
- [ ] Type `&` in an assignment whose field targets a concept → only instances/terms valid for that concept (the schema-aware case).
- [ ] Completion inside an instance body → the concept's field/relationship names.

## Rename & quick-fix (WorkspaceEdit write-path)
- [ ] Rename a concept referenced across multiple files, some open and some closed → all occurrences update; open buffers become dirty (undo works), closed files are written to disk.
- [ ] Invalid rename (non-kebab / collision) → rejected with a message.
- [ ] Quick-fix lightbulb on a "missing required field" diagnostic → applies the `<field> = ;` insertion.

## Formatting / folding / symbols / semantic tokens
- [ ] Format Document → normalizes indentation/spacing; comments survive; running it again is a no-op.
- [ ] Folding arrows appear on braces/blocks and collapse correctly.
- [ ] The Outline / breadcrumb shows the document's symbols.
- [ ] Semantic colouring distinguishes concepts / primitives / enums / instances (richer than the Monarch base).

## Resilience
- [ ] Create / delete / rename a `.todl` file in the Solution Explorer → the service picks it up (diagnostics for the new/removed file appear/clear) via the rescan → ResyncProject path.
- [ ] A reference (re)publish / reference edit refreshes bases live (the dependent project's diagnostics update without an app reload).
