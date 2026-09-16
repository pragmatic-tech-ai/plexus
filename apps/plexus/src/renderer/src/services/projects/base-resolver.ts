import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { TodlDocument, PackageRef } from '@pragmatic-tech-ai/todl'
import { PackageKind } from '@pragmatic-tech-ai/todl'

import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ensureMetaModelsBackend } from '../../modules/meta-model/services/meta-models-backend.js'
import { ensureLibrariesBackend } from '../../modules/library/services/libraries-backend.js'
import type { BaseBindings } from './base-binding.js'

// A published model.json read back: the graph plus any recorded base deps.
interface PackageDocument extends TodlDocument { dependencies?: PackageRef[] }

// Resolve a project's declared bases into parsed TodlDocuments, walking each
// package's recorded `dependencies` transitively. Own-only packages record the
// bases they were compiled against; this reassembles the full closure. Deduped by
// `kind:id@version` (cycle-safe); TODL's checkAgainst/mergeBases dedups any
// residual node overlap. A binding whose compiled model.json is missing/unreadable
// is collected in `problems` (so validation can surface "meta-model not published")
// rather than thrown — a consuming project stays usable while its bases are being
// published. An old full-closure package with no `dependencies` field resolves as
// a leaf, exactly as before.
export async function resolveBases(
    provider: IServiceProvider,
    bindings: BaseBindings,
): Promise<{ bases: TodlDocument[]; problems: string[] }>
{
    const bases: TodlDocument[] = []
    const problems: string[] = []
    const visited = new Set<string>()

    const backendFor = (kind: PackageKind): IStorage =>
        kind === PackageKind.Library ? ensureLibrariesBackend(provider) : ensureMetaModelsBackend(provider)

    // Seed the worklist with the project's direct bindings (meta-model first, then
    // libraries — a stable order).
    const queue: PackageRef[] = []
    if (bindings.metaModel !== undefined) queue.push({ kind: PackageKind.MetaModel, ...bindings.metaModel })
    for (const lib of bindings.libraries ?? []) queue.push({ kind: PackageKind.Library, ...lib })

    while (queue.length > 0) {
        const ref = queue.shift()!
        const key = `${ref.kind}:${ref.id}@${ref.version}`
        if (visited.has(key)) continue
        visited.add(key)

        const path = `${ref.id}/${ref.version}/model.json`
        try {
            const doc = JSON.parse(await backendFor(ref.kind).ReadText(path)) as PackageDocument
            bases.push({ nodes: doc.nodes, edges: doc.edges })
            for (const dep of doc.dependencies ?? []) queue.push(dep)
        } catch {
            const kind = ref.kind === PackageKind.Library ? 'library' : 'meta-model'
            problems.push(`${kind} "${ref.id}@${ref.version}" is not published`)
        }
    }
    return { bases, problems }
}
