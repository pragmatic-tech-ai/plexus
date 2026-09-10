import type { PipelineConfiguration } from '@pragmatic-tech-ai/fresco'

import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { safeStem } from './layout-presets-store.js'

// Project-scoped layout presets: one `<name>.json` per preset under
// `.plexus/layout-presets/` in the project's storage, so they are shared by
// every diagram in the project (and travel with the project, not the user).
// The project-relative twin of LayoutPresetsStore (which is user-data / global)
// — same JSON-file-per-preset contract, over an IStorage rooted at the project
// instead of the FileSystemService at UserDataDirectory.
//
// The active diagram's FileDiagramStorage.ProjectStorage supplies the IStorage;
// the service only constructs this store when a diagram with a project backing
// is active. Reads degrade to empty/undefined so a missing folder is safe.
const FOLDER = '.plexus/layout-presets'

export class ProjectLayoutPresetsStore
{
    public constructor(private readonly storage: IStorage) {}

    // The saved preset names (the `.json` stems), sorted. Any failure — a
    // missing folder, a backend error — yields [].
    public async names(): Promise<string[]>
    {
        try {
            const entries = await this.storage.List(FOLDER)
            return entries
                .filter((e) => !e.IsDirectory && e.Name.endsWith('.json'))
                .map((e) => e.Name.slice(0, -'.json'.length))
                .sort()
        } catch {
            return []
        }
    }

    // The preset by name, or undefined if missing / unreadable / not valid JSON.
    public async get(name: string): Promise<PipelineConfiguration | undefined>
    {
        try {
            return JSON.parse(await this.storage.ReadText(this.path(safeStem(name)))) as PipelineConfiguration
        } catch {
            return undefined
        }
    }

    // Write the preset as <safe(name)>.json and return the sanitized stem (the
    // display name), so the caller can select it. Overwrites silently.
    public async save(name: string, cfg: PipelineConfiguration): Promise<string>
    {
        const stem = safeStem(name)
        await this.storage.CreateDirectory(FOLDER)
        await this.storage.WriteText(this.path(stem), JSON.stringify(cfg, null, 2))
        return stem
    }

    // Delete the preset file; tolerates its absence.
    public async delete(name: string): Promise<void>
    {
        try {
            await this.storage.Delete(this.path(safeStem(name)))
        } catch {
            // already gone — nothing to do
        }
    }

    // IStorage paths are project-relative POSIX, so a plain `/` join is correct.
    private path(stem: string): string
    {
        return `${FOLDER}/${stem}.json`
    }
}
