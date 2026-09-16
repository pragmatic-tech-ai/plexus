// Reacts to external file changes anywhere under an open project root by
// re-scanning + re-validating that project (the same path the agent's
// refresh_project uses). Debounced per folder so a burst collapses to one rescan.
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { type FileChangeEvent } from '../../../../shared/file-watch-api.js'
import { FileWatchService } from './file-watch-service.js'
import { normalizePath } from './path-utils.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'
import { EnvironmentService } from '../environment/environment-service.js'

const DEBOUNCE_MS = 250

export class ProjectRescanService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ProjectRescanService>('ProjectRescanService')

    private readonly unsubscribe: () => void
    private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const watch = this.Provider.getRequired(FileWatchService.Key)
        this.unsubscribe = watch.Subscribe((e) => this.handle(e))
    }

    private handle(e: FileChangeEvent): void
    {
        const folder = this.owningFolder(e.path)
        if (folder === undefined) return
        const existing = this.pending.get(folder)
        if (existing !== undefined) clearTimeout(existing)
        this.pending.set(folder, setTimeout(() => {
            this.pending.delete(folder)
            void this.Provider.getRequired(ProjectExplorerService.Key).RefreshProjects([folder])
        }, DEBOUNCE_MS))
    }

    // The open-project root that contains this path (prefix match, path-normalized).
    private owningFolder(absPath: string): string | undefined
    {
        const ci = this.Provider.getRequired(EnvironmentService.Key).IsWindows
        const target = normalizePath(absPath, ci)
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        for (const p of explorer.OpenProjects.ToArray())
        {
            const root = normalizePath(p.Folder, ci)
            if (target === root || target.startsWith(root + '/')) return p.Folder
        }
        return undefined
    }

    public dispose(): void
    {
        this.unsubscribe()
        for (const t of this.pending.values()) clearTimeout(t)
        this.pending.clear()
    }
}

export default ProjectRescanService
