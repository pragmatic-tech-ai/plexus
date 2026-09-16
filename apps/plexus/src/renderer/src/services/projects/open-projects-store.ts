import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { EnvironmentService } from '../environment/environment-service.js'
import { FileSystemService } from '../file-system/file-system-service.js'

// OpenProjectsStore — persists the set of currently-open project folders to a
// plain JSON array at <UserDataDirectory>/open-projects.json (through the
// existing FileSystemService, no new IPC). The explorer updates it on
// open/create/close and reads it at launch to restore the workspace. Kept off
// the settings store on purpose (same reason as RecentProjectsService).
export class OpenProjectsStore extends ServiceBase
{
    public static readonly Key = new ServiceKey<OpenProjectsStore>('OpenProjectsStore')
    private static readonly FileName = 'open-projects.json'

    // In-memory mirror of the persisted list, so Current() is synchronous and
    // Add/Remove can notify with the new set. Lazily loaded on first List().
    private folders: string[] | null = null
    private readonly listeners = new Set<(folders: readonly string[]) => void>()

    constructor(provider: IServiceProvider) { super(provider) }

    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get env(): EnvironmentService { return this.Provider.getRequired(EnvironmentService.Key) }

    private get filePath(): string
    {
        return join(this.env.UserDataDirectory, OpenProjectsStore.FileName)
    }

    // The stored open-project folders. Loads the file into the in-memory mirror
    // once (subsequent calls return the mirror). Tolerates a missing/corrupt
    // file → [].
    public async List(): Promise<readonly string[]>
    {
        if (this.folders !== null) return this.folders
        try {
            if (!(await this.fs.Exists(this.filePath))) { this.folders = []; return this.folders }
            const parsed = JSON.parse(await this.fs.ReadText(this.filePath))
            this.folders = Array.isArray(parsed) ? (parsed as string[]) : []
        } catch {
            this.folders = []
        }
        return this.folders
    }

    // The current open folders (the in-memory mirror; [] until first load).
    public Current(): readonly string[] { return this.folders ?? [] }

    // Subscribe to open-set changes; returns an unsubscribe thunk. Fired by
    // Add/Remove when the set actually changes.
    public Subscribe(listener: (folders: readonly string[]) => void): () => void
    {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    // Append a folder if it isn't already present (dedupe by exact path). A dedup
    // no-op does not notify — the set didn't change.
    public async Add(folder: string): Promise<void>
    {
        const list = [...await this.List()]
        if (list.includes(folder)) return
        list.push(folder)
        this.folders = list
        await this.write(list)
        this.notify()
    }

    public async Remove(folder: string): Promise<void>
    {
        const list = (await this.List()).filter((f) => f !== folder)
        this.folders = list
        await this.write(list)
        this.notify()
    }

    private notify(): void
    {
        for (const l of this.listeners) l(this.Current())
    }

    private write(list: readonly string[]): Promise<void>
    {
        return this.fs.WriteText(this.filePath, JSON.stringify(list, null, 2))
    }
}

// Join a directory and a file name using the directory's own separator (no
// node:path in the renderer).
function join(dir: string, name: string): string
{
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    return dir.endsWith(sep) ? dir + name : dir + sep + name
}
