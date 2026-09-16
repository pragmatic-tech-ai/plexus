import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { EnvironmentService } from '../environment/environment-service.js'
import { FileSystemService } from '../file-system/file-system-service.js'

// One entry in the recent-projects list (an MRU of opened/created projects).
export interface RecentProject
{
    name:     string
    path:     string
    type:     string
    openedAt: number
}

// RecentProjectsService — persists the recent-projects MRU to a plain JSON file
// at <UserDataDirectory>/recent-projects.json, through the existing
// FileSystemService (no new IPC bridge). It is kept OFF the settings store on
// purpose: ApplicationSettings.persist() rewrites the whole settings record
// from its typed keys, so a shared key there would be clobbered.
export class RecentProjectsService extends ServiceBase
{
    public static readonly Key = new ServiceKey<RecentProjectsService>('RecentProjectsService')
    public static readonly MaxEntries = 10
    private static readonly FileName = 'recent-projects.json'

    constructor(provider: IServiceProvider) { super(provider) }

    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get env(): EnvironmentService { return this.Provider.getRequired(EnvironmentService.Key) }

    private get filePath(): string
    {
        return join(this.env.UserDataDirectory, RecentProjectsService.FileName)
    }

    // The stored list, most-recent first. Tolerates a missing/corrupt file → [].
    public async List(): Promise<readonly RecentProject[]>
    {
        try {
            if (!(await this.fs.Exists(this.filePath))) return []
            const parsed = JSON.parse(await this.fs.ReadText(this.filePath))
            return Array.isArray(parsed) ? (parsed as RecentProject[]) : []
        } catch {
            return []
        }
    }

    // Insert (or move) an entry to the front; dedupe by path; cap at MaxEntries.
    public async Add(entry: RecentProject): Promise<void>
    {
        const rest = (await this.List()).filter((e) => e.path !== entry.path)
        const next = [entry, ...rest].slice(0, RecentProjectsService.MaxEntries)
        await this.write(next)
    }

    public async Remove(path: string): Promise<void>
    {
        const next = (await this.List()).filter((e) => e.path !== path)
        await this.write(next)
    }

    private write(list: readonly RecentProject[]): Promise<void>
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
