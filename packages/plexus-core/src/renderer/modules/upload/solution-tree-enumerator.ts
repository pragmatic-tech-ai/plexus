import { TodlProjectSourceFiles, type Solution } from '@pragmatic-tech-ai/todl'
import { PROJECT_MANIFEST_FILENAME } from '../../projects/project-factory.js'
import type { UploadEntry } from '../../../shared/upload-api.js'

// Walks the active local solution into the flat tree the main-process upload writes: the solution
// manifest (<name>.pksln at the solution root) plus, per member project, its project.plexus and every
// .todl source file the TODL engine itself collects (TodlProjectSourceFiles.Collect: every .todl
// except the top-level dist/ output folder). Paths are solution-relative, POSIX, with each member under its own
// member path. Members without storage are skipped, as SolutionPackageBuilder skips them.
export class SolutionTreeEnumerator
{
    private static readonly ManifestExtension = '.pksln'
    private static readonly SourceExtension = '.todl'
    private static readonly Separator = '/'
    private static readonly CurrentDir = '.'
    private static readonly BackslashSegments = /[\\/]+/
    private static readonly Backslash = '\\'
    private static readonly ParentSegment = '..'
    private static readonly DriveMarker = ':'
    private static readonly UnsafePath = 'Refusing to upload an unsafe path: '
    private static readonly EmptyTree = 'The solution has no files to upload.'
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
            for (const source of await TodlProjectSourceFiles.Collect(storage))
            {
                tree.push({ Path: prefix + SolutionTreeEnumerator.Clean(source.uri), Text: source.text })
            }
        }
        if (tree.length === 0) throw new Error(SolutionTreeEnumerator.EmptyTree)
        return tree
    }

    // '' for the solution root itself, else 'member/path/'. A member path that escapes the solution
    // ('..'), is absolute or names a drive is refused; backslashes are treated as separators.
    private static Prefix(memberPath: string): string
    {
        const parts = SolutionTreeEnumerator.Segments(memberPath)
        return parts.length === 0 ? '' : parts.join(SolutionTreeEnumerator.Separator) + SolutionTreeEnumerator.Separator
    }

    // A file path inside a member: POSIX segments only; same rules as Prefix, and no backslash at all.
    private static Clean(path: string): string
    {
        if (path.includes(SolutionTreeEnumerator.Backslash)) throw new Error(SolutionTreeEnumerator.UnsafePath + path)
        return SolutionTreeEnumerator.Segments(path).join(SolutionTreeEnumerator.Separator)
    }

    // Splits on either separator, drops empty and '.' segments, and refuses a leading separator
    // (absolute path), a '..' segment and any segment containing ':' (drive letter).
    private static Segments(path: string): string[]
    {
        if (/^[\\/]/.test(path)) throw new Error(SolutionTreeEnumerator.UnsafePath + path)
        const parts = path.split(SolutionTreeEnumerator.BackslashSegments).filter((s) => s !== '' && s !== SolutionTreeEnumerator.CurrentDir)
        if (parts.some((s) => s === SolutionTreeEnumerator.ParentSegment || s.includes(SolutionTreeEnumerator.DriveMarker))) throw new Error(SolutionTreeEnumerator.UnsafePath + path)
        return parts
    }
}
