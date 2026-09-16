import { ProjectNode } from './project.js'

// Pure move-planning + drop-target resolution for the project tree. No storage —
// the service applies the plan (collision check + Rename + rescan). Kept separate
// so the interesting logic is unit-tested without a live IStorage or DOM.

// Project-relative path helpers (POSIX '/'; the storage backend translates).
function joinRel(dir: string, name: string): string { return dir === '' ? name : dir + '/' + name }
function parentOf(path: string): string { const i = path.lastIndexOf('/'); return i === -1 ? '' : path.slice(0, i) }

// The folder a drop over `node` targets: undefined (project header / empty area)
// → root ''; a folder → its own path; a file → its containing folder.
export function resolveDropTargetPath(node: ProjectNode | undefined): string
{
    if (node === undefined) return ''
    return node.Kind === 'folder' ? node.Path : parentOf(node.Path)
}

export interface PlannedMove { from: string; to: string; name: string }
export interface MovePlan { moves: PlannedMove[]; rejects: { name: string; reason: string }[] }

// Plan moving `nodes` into `destParentPath`. Drops a node whose ancestor is also
// selected (a folder move carries its descendants). Within the same project
// (`sameProject`, the default) it also skips a node already in the destination and
// rejects moving a folder into itself or a descendant; those guards are meaningless
// across projects (a different tree), so a cross-project plan omits them. Name
// collisions are checked later, against the target storage.
export function planNodeMoves(nodes: readonly ProjectNode[], destParentPath: string, sameProject = true): MovePlan
{
    const moves: PlannedMove[] = []
    const rejects: { name: string; reason: string }[] = []
    const paths = nodes.map((n) => n.Path)
    for (const node of nodes) {
        if (paths.some((p) => p !== node.Path && node.Path.startsWith(p + '/'))) continue   // ancestor selected
        if (sameProject && parentOf(node.Path) === destParentPath) continue                 // already there
        if (sameProject && (destParentPath === node.Path || destParentPath.startsWith(node.Path + '/'))) {
            rejects.push({ name: node.Name, reason: 'into itself' }); continue               // into self/descendant
        }
        moves.push({ from: node.Path, to: joinRel(destParentPath, node.Name), name: node.Name })
    }
    return { moves, rejects }
}
