// ── BRIDGE: todl 0.40.0 engine ops that its package `exports` omits ───────────
//
// todl 0.40.0 SHIPS these classes/interfaces in its published `dist` (Tasks 2/4/6
// built them and Task 7's engine-boundary test even pins their files), but its
// package `exports` map does NOT re-export them from the public index. A bare
// `@pragmatic-tech-ai/todl` import of `MemberContentOps` / `ReferenceEditor` /
// `ProjectLifecycle` therefore fails type resolution (TS2307), and a bare SUBPATH
// import is blocked by the exports field. A RELATIVE path into the installed `dist`
// side-steps the exports map (it governs package specifiers, not relative paths)
// and resolves under both tsc (Bundler) and vite/vitest.
//
// This file is the ONE place that reaches into the dist. When todl re-exports these
// from its index (0.40.1+), collapse every line below to a single bare re-export
// `export { ... } from '@pragmatic-tech-ai/todl'` and delete the relative paths.
//
// (MemberProjectOps, ConnectionSelection, UniqueName and VersionPart ARE exported
// from the index, so those are imported bare elsewhere — not bridged here.)

export {
    MemberContentOps,
    RenameError,
    type RenameResult,
    type MoveResult,
    type ImportFile,
} from '../../../../../../../node_modules/@pragmatic-tech-ai/todl/dist/solution-services/project-services/content/member-content-ops.js'
export type { IContentLifecycleGuard } from '../../../../../../../node_modules/@pragmatic-tech-ai/todl/dist/solution-services/project-services/content/content-lifecycle.js'
export {
    ReferenceEditor,
    type IPublishedBaseCatalog,
    type RefChoiceDTO,
    type ReferenceBindingsInput,
} from '../../../../../../../node_modules/@pragmatic-tech-ai/todl/dist/solution-services/project-services/references/reference-editor.js'
export {
    ProjectLifecycle,
    type ICloseGuard,
    type IProjectSessionStore,
} from '../../../../../../../node_modules/@pragmatic-tech-ai/todl/dist/solution-services/solution-manager/engine/project-lifecycle.js'
