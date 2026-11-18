import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { Solution } from '@pragmatic-tech-ai/todl'
import { PROJECT_MANIFEST_FILENAME } from '../../projects/project-factory.js'
import type { UploadEntry } from '../../../shared/upload-api.js'

// Walks the active local solution into the flat tree the main-process upload writes: the solution
// manifest (<name>.pksln at the solution root) plus, per member project, its project.plexus and every
// .todl source file under it. Paths are solution-relative, POSIX, with each member under its own
// member path. Members without storage are skipped, as SolutionPackageBuilder skips them.
export class SolutionTreeEnumerator
{
    private static readonly ManifestExtension = '.pksln'
    private static readonly SourceExtension = '.todl'
    private static readonly Separator = '/'
    private static readonly CurrentDir = '.'
    private static readonly NoStorage = 'The solution has not been saved to a folder, so there is nothing to upload.'

    public async Enumerate(solution: Solution): Promise<UploadEntry[]>
    {
        const tree: UploadEntry[] = []
        const root = solution.Storage
        if (root === undefined) throw new Error(SolutionTreeEnumerator.NoStorage)
        const manifest = (await root.List('')).find((e) => !e.IsDirectory && e.Name.endsWith(SolutionTreeEnumerator.ManifestExtension))
        if (manifest !== undefined) tree.push({ Path: manifest.Name, Text: await root.ReadText(manifest.Name) })
        for (const member of solution.Members.ToArray())
        {
            const storage = member.Storage
            if (storage === undefined) continue
            const prefix = SolutionTreeEnumerator.Prefix(member.Ref.path)
            if (await storage.Exists(PROJECT_MANIFEST_FILENAME))
            {
                tree.push({ Path: prefix + PROJECT_MANIFEST_FILENAME, Text: await storage.ReadText(PROJECT_MANIFEST_FILENAME) })
            }
            await SolutionTreeEnumerator.Collect(storage, '', prefix, tree)
        }
        return tree
    }

    // '' for the solution root itself, else 'member/path/'.
    private static Prefix(memberPath: string): string
    {
        const parts = memberPath.split(/[\/]+/).filter((s) => s !== '' && s !== SolutionTreeEnumerator.CurrentDir)
        return parts.length === 0 ? '' : parts.join(SolutionTreeEnumerator.Separator) + SolutionTreeEnumerator.Separator
    }

    private static async Collect(storage: IStorage, dir: string, prefix: string, into: UploadEntry[]): Promise<void>
    {
        const entries = [...await storage.List(dir)].sort((a, b) => a.Name.localeCompare(b.Name))
        for (const entry of entries)
        {
            const rel = dir === '' ? entry.Name : dir + SolutionTreeEnumerator.Separator + entry.Name
            if (entry.IsDirectory)
            {
                await SolutionTreeEnumerator.Collect(storage, rel, prefix, into)
            }
            else if (entry.Name.endsWith(SolutionTreeEnumerator.SourceExtension))
            {
                into.push({ Path: prefix + rel, Text: await storage.ReadText(rel) })
            }
        }
    }
}
