// Watches open project roots (main owns chokidar) and broadcasts external file
// changes to in-renderer consumers. Pure lifecycle + fan-out: it does not know
// about editors or validation — consumers subscribe and decide. Eagerly resolved
// at startup (main.js) so it listens before any project work.
import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { type FileChangeEvent, type IFileWatchApi } from '../../../../shared/file-watch-api.js'
import { ProjectExplorerService } from '../../modules/project-explorer/services/project-explorer-service.js'

export class FileWatchService extends ServiceBase
{
    public static readonly Key = new ServiceKey<FileWatchService>('FileWatchService')

    private readonly api: IFileWatchApi
    private readonly subscribers = new Set<(e: FileChangeEvent) => void>()
    private readonly watched = new Set<string>()
    private readonly disposers: Array<() => void> = []

    constructor(provider: IServiceProvider)
    {
        super(provider)
        const bridge = (globalThis as unknown as { api?: { fileWatch?: IFileWatchApi } }).api
        if (bridge?.fileWatch === undefined)
        {
            throw new Error(
                'FileWatchService: window.api.fileWatch is unavailable — the Electron preload '
                + 'bridge did not load. This service requires the Plexus desktop host.',
            )
        }
        this.api = bridge.fileWatch
        this.disposers.push(this.api.onChanged((e) => { for (const cb of this.subscribers) cb(e) }))

        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        this.disposers.push(explorer.OpenProjects.Subscribe(() => this.reconcile()))
        this.reconcile()
    }

    public Subscribe(cb: (e: FileChangeEvent) => void): () => void
    {
        this.subscribers.add(cb)
        return () => { this.subscribers.delete(cb) }
    }

    // Diff the current open-project roots against what we're watching; watch new,
    // unwatch gone.
    private reconcile(): void
    {
        const explorer = this.Provider.getRequired(ProjectExplorerService.Key)
        const current = new Set(explorer.OpenProjects.ToArray().map((p) => p.Folder))
        for (const folder of current) if (!this.watched.has(folder)) { this.watched.add(folder); void this.api.watch(folder) }
        for (const folder of [...this.watched]) if (!current.has(folder)) { this.watched.delete(folder); void this.api.unwatch(folder) }
    }

    public dispose(): void
    {
        for (const d of this.disposers) d()
        for (const folder of this.watched) void this.api.unwatch(folder)
        this.watched.clear()
        this.subscribers.clear()
    }
}

export default FileWatchService
