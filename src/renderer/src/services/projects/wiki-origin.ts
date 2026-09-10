import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ProducerKind } from './project-factory.js'
import { ensureMetaModelsBackend } from '../../modules/meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../modules/library/services/libraries-backend.js'

// Where a concept's declaring artifact lives — the base a relative wiki `path`
// resolves against. Produced by base resolution (which already decides, per base,
// whether it came from an open source project or a published package) and consumed
// by the wiki opener to read the page from the right storage.
export enum WikiOriginKind { OpenProject = 'openProject', Package = 'package' }

export type WikiOrigin =
    // The declaring project is open as live source — the page is a file under its
    // project root (read via its IStorage). Wins over a published copy.
    | { readonly kind: WikiOriginKind.OpenProject; readonly storage: IStorage }
    // The concept came from a published package — the page ships alongside the
    // package at `<backend>/<id>/<version>/…` in the meta-models/libraries backend.
    | { readonly kind: WikiOriginKind.Package; readonly backend: ProducerKind; readonly id: string; readonly version: string }

export function openProjectOrigin(storage: IStorage): WikiOrigin
{
    return { kind: WikiOriginKind.OpenProject, storage }
}

export function packageOrigin(backend: ProducerKind, id: string, version: string): WikiOrigin
{
    return { kind: WikiOriginKind.Package, backend, id, version }
}

// Turn a wiki `path` (relative to its declaring artifact) + its origin into the
// concrete storage + storage-relative path to read the page from: the project's
// own storage for open source, or the package directory in the meta-models /
// libraries backend for a published concept.
export function locateWikiFile(
    provider: IServiceProvider, origin: WikiOrigin, relPath: string,
): { storage: IStorage; path: string }
{
    if (origin.kind === WikiOriginKind.OpenProject) return { storage: origin.storage, path: relPath }
    const backend = origin.backend === ProducerKind.MetaModel
        ? ensureMetaModelsBackend(provider)
        : ensureLibrariesBackend(provider)
    return { storage: backend, path: packageWikiPath(origin.id, origin.version, relPath) }
}

// The storage-relative path of a wiki page inside a published package bundle:
// `<id>/<version>/<relPath>`, where relPath is the page path relative to the
// package root (e.g. `wiki/service.md`).
export function packageWikiPath(id: string, version: string, relPath: string): string
{
    return `${id}/${version}/${relPath}`
}
