import { MetaKind, type Repository } from '@pragmatic-tech-ai/todl'

export interface MaterializeSpec { concept?: string; via?: string; propagate?: boolean }

function str(v: unknown): string | undefined { return typeof v === 'string' && v.length > 0 ? v : undefined }
function bool(v: unknown): boolean | undefined { return typeof v === 'boolean' ? v : undefined }

// Reads the `<id>@materialize` annotation application off a concept or term.
// Undefined when the node carries no marker; a bare `annotate materialize {}`
// returns {} (present, every field undefined).
export function materializeOf(repo: Repository, id: string): MaterializeSpec | undefined {
    const node = repo.resolve(`${id}@materialize`)
    if (node === undefined) return undefined
    return { concept: str(node.attrs.get('concept')), via: str(node.attrs.get('via')), propagate: bool(node.attrs.get('propagate')) }
}

// A drop-created root: a concept carrying a materialize marker that does NOT
// redirect elsewhere (no foreign `concept` param).
export function isMaterializeRoot(repo: Repository, conceptId: string): boolean {
    if (repo.resolve(conceptId)?.typeOf !== MetaKind.Concept) return false
    const spec = materializeOf(repo, conceptId)
    return spec !== undefined && (spec.concept === undefined || spec.concept === conceptId)
}

// Every concept id that is a materialize root.
export function materializeRoots(repo: Repository): string[] {
    return repo.allNodes()
        .filter((n) => n.typeOf === MetaKind.Concept && isMaterializeRoot(repo, n.id))
        .map((n) => n.id)
}
