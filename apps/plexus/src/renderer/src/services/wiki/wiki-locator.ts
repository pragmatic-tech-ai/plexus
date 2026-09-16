import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { ModelDraft, parse, type Repository, type SourceFile } from '@pragmatic-tech-ai/todl'

import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'
import { collectTodlSources } from '../todl/todl-sources.js'

// The wiki page `path` a concept declares via `annotate wiki { path }`, read
// straight off a LOADED model — a pure, cheap `repo.resolve('X@wiki')` exactly like
// materializeOf. This is the intended way to consult the annotation; the legacy
// resolveWiki below re-compiles source per call (expensive) and is being retired.
// Undefined when the concept declares no wiki (or an empty path).
export function wikiPathOf(repo: Repository, concept: string): string | undefined
{
    if (concept.length === 0) return undefined
    const v = repo.resolve(`${concept}@wiki`)?.attrs.get('path')
    return typeof v === 'string' && v.length > 0 ? v : undefined
}

// Resolves a concept to the wiki page declared with it, by probing OPEN
// projects' own source. Only the project that DECLARES the concept
// (`concept X { annotate wiki { path } }`) resolves `X@wiki`; a consuming
// architecture project's own source (instances) does not, so it is skipped.
// ModelDraft.fromSources injects the prelude as an implicit base, so `wiki`
// (and the root `Element`) resolve without passing any base.
// Approach A: unresolved (declaring project not open) is a normal `undefined`.
export class WikiLocator
{
    public static readonly Key = new ServiceKey<WikiLocator>('WikiLocator')

    public constructor(private readonly provider: IServiceProvider) {}

    // { root, relPath } for the open project declaring `concept`, else undefined.
    public async resolveWiki(concept: string): Promise<{ root: string; relPath: string } | undefined>
    {
        const explorer = this.provider.get(ProjectExplorerService.Key)
        if (explorer === undefined) return undefined
        for (const op of explorer.OpenProjects.ToArray()) {
            let relPath: string | undefined
            try {
                const sources = await collectTodlSources(op.Storage)
                const repo = ModelDraft.fromSources([], sources, { namespace: namespaceOf(sources, op.Project.Name) }).model
                const v = repo.resolve(`${concept}@wiki`)?.attrs.get('path')
                relPath = typeof v === 'string' && v.length > 0 ? v : undefined
            } catch {
                relPath = undefined   // a source that won't parse in isolation → not this project
            }
            if (relPath !== undefined) return { root: op.Project.RootPath, relPath }
        }
        return undefined
    }
}

// The namespace the first source declares (fromSources partitions "own"
// instances by it); irrelevant to concept resolution but kept faithful.
function namespaceOf(sources: readonly SourceFile[], fallback: string): string
{
    const first = sources[0]
    if (first === undefined) return fallback
    try { return parse(first.text, first.uri).namespace.path || fallback } catch { return fallback }
}
