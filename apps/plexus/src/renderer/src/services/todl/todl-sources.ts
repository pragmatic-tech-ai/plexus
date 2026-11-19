import type { SourceFile } from '@pragmatic-tech-ai/todl'
import { TodlProjectSourceFiles } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Renderer-side TODL source collection. These are thin wrappers over TODL's
// canonical collector (`TodlProjectSourceFiles`) so the build-output / vendor
// exclusions live in ONE place.
//
// Why wrappers and not a second walk: a drifted copy here used to exclude only
// `dist/`. A producer project (e.g. a meta-model) that has been published locally
// carries a `build/npm-package/src/` tree — a COMPILED copy of `concepts/` — plus
// a `dist/` tree. Walking `build/` as source re-declared every concept node, so
// the whole-solution analysis threw `node "<ns>.<concept>" already exists` and the
// LSP diagnostics refresh crashed. `TodlProjectSourceFiles` skips `dist/`, `build/`,
// `node_modules/` and `.git/` at the project root; delegating keeps that list
// authoritative and un-drifted.

export function collectTodlSources(storage: IStorage): Promise<SourceFile[]>
{
    return TodlProjectSourceFiles.Collect(storage)
}

export function collectTaxonomySources(
    storage: IStorage,
    excludeDirs: readonly string[] = ['samples'],
): Promise<SourceFile[]>
{
    return TodlProjectSourceFiles.CollectTaxonomy(storage, excludeDirs)
}
