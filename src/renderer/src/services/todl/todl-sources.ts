import type { SourceFile } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'

// Shared TODL source-collection + project-relative path helpers, used by both
// the project factory (publish) and the validation service. Kept separate so
// neither has to import the other (the factory notifies the service on open;
// the service reads sources) — no import cycle.

export function joinRel(dir: string, name: string): string
{
    return dir === '' ? name : dir + '/' + name
}

export function extname(name: string): string
{
    const i = name.lastIndexOf('.')
    return i > 0 ? name.slice(i).toLowerCase() : ''
}

// Recursively collect every `.todl` file in the project as a TODL SourceFile
// (uri = project-relative POSIX path). This is what check() and publish consume.
export async function collectTodlSources(storage: IStorage): Promise<SourceFile[]>
{
    const out: SourceFile[] = []
    async function walk(dir: string): Promise<void>
    {
        for (const e of await storage.List(dir)) {
            const path = joinRel(dir, e.Name)
            if (e.IsDirectory) await walk(path)
            else if (extname(e.Name) === '.todl') out.push({ uri: path, text: await storage.ReadText(path) })
        }
    }
    await walk('')
    return out
}

// Collect every `.todl` EXCEPT those under the given TOP-LEVEL folders (default
// `samples/`, which holds example instances that must never enter the taxonomy
// compile). A top-level directory whose name is in excludeDirs is skipped whole;
// nested folders of the same name are not special. `collectTodlSources` above
// stays the unfiltered walk it is today.
export async function collectTaxonomySources(
    storage: IStorage,
    excludeDirs: readonly string[] = ['samples'],
): Promise<SourceFile[]>
{
    const exclude = new Set(excludeDirs)
    const out: SourceFile[] = []
    async function walk(dir: string): Promise<void>
    {
        for (const e of await storage.List(dir)) {
            if (dir === '' && e.IsDirectory && exclude.has(e.Name)) continue
            const path = joinRel(dir, e.Name)
            if (e.IsDirectory) await walk(path)
            else if (extname(e.Name) === '.todl') out.push({ uri: path, text: await storage.ReadText(path) })
        }
    }
    await walk('')
    return out
}
