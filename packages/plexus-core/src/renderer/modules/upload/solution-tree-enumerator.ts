import { TodlProjectSourceFiles, type Solution } from '@pragmatic-tech-ai/todl'
import { PROJECT_MANIFEST_FILENAME } from '../../projects/project-factory.js'
import type { UploadEntry } from '../../../shared/upload-api.js'
import { UploadPathGuard } from '../../../shared/upload-path-guard.js'

// Walks the active local solution into the flat tree the main-process upload writes: the solution
// manifest (<name>.pksln at the solution root) plus, per member project, its project.plexus and every
// .todl source file the TODL engine itself collects (TodlProjectSourceFiles.Collect: every .todl
// except the top-level dist/ output folder). Paths are solution-relative, POSIX, with each member under its own
// member path. Members without storage are skipped, as SolutionPackageBuilder skips them.
export class SolutionTreeEnumerator
{
    private static readonly ManifestExtension = '.pksln'
    private static readonly SourceExtension = '.todl'
    private static readonly EmptyTree = 'The solution has no files to upload.'
    private static readonly NoStorage = 'The solution has not been saved to a folder, so there is nothing to upload.'

    public async Enumerate(solution: Solution): Promise<UploadEntry[]>
    {
        const tree: UploadEntry[] = []
        const root = solution.Storage
        if (root === undefined) throw new Error(SolutionTreeEnumerator.NoStorage)
        const manifest = (await root.List('')).find((e) => !e.IsDirectory && e.Name.endsWith(SolutionTreeEnumerator.ManifestExtension))
        if (manifest !== undefined) tree.push({ Path: UploadPathGuard.Clean(manifest.Name), Text: await root.ReadText(manifest.Name) })
        for (const member of solution.Members.ToArray())
        {
            const storage = member.Storage
            if (storage === undefined) continue
            const prefix = UploadPathGuard.Prefix(member.Ref.path)
            if (await storage.Exists(PROJECT_MANIFEST_FILENAME))
            {
                tree.push({ Path: prefix + PROJECT_MANIFEST_FILENAME, Text: await storage.ReadText(PROJECT_MANIFEST_FILENAME) })
            }
            for (const source of await TodlProjectSourceFiles.Collect(storage))
            {
                tree.push({ Path: prefix + UploadPathGuard.Clean(source.uri), Text: source.text })
            }
        }
        if (tree.length === 0) throw new Error(SolutionTreeEnumerator.EmptyTree)
        return tree
    }
}
