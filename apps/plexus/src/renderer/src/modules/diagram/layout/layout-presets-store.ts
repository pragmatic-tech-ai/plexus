import { type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { PipelineConfiguration } from '@pragmatic-tech-ai/fresco'

import { EnvironmentService } from '../../../services/environment/environment-service.js'
import { FileSystemService } from '../../../services/file-system/file-system-service.js'

// Named layout-pipeline presets, one `<name>.json` file per preset under
// <UserDataDirectory>/layout-presets/. Each file is a Fresco
// PipelineConfiguration (plain JSON, no bespoke serializer). Reads degrade to
// empty/undefined so a host without a filesystem (headless tests) is safe;
// writes assume the desktop host (they run only from user commands).
const FOLDER = 'layout-presets'

export class LayoutPresetsStore
{
    public constructor(private readonly provider: IServiceProvider) {}

    private get fs(): FileSystemService { return this.provider.getRequired(FileSystemService.Key) }
    private get env(): EnvironmentService { return this.provider.getRequired(EnvironmentService.Key) }

    // <UserDataDirectory>/layout-presets
    public dir(): string
    {
        return join(this.env.UserDataDirectory, FOLDER)
    }

    // The saved preset display names (the `.json` stems), sorted. Any failure
    // — a missing folder, an absent filesystem host — yields [].
    public async names(): Promise<string[]>
    {
        try {
            const entries = await this.fs.ListDirectory(this.dir())
            return entries
                .filter((e) => !e.IsDirectory && e.Name.endsWith('.json'))
                .map((e) => e.Name.slice(0, -'.json'.length))
                .sort()
        } catch {
            return []
        }
    }

    // The preset by display name, or undefined if it is missing / unreadable /
    // not valid JSON.
    public async get(name: string): Promise<PipelineConfiguration | undefined>
    {
        try {
            return JSON.parse(await this.fs.ReadText(this.filePath(name))) as PipelineConfiguration
        } catch {
            return undefined
        }
    }

    // Write the preset as <safe(name)>.json and return the sanitized stem (the
    // display name), so the caller can select it. Overwrites silently.
    public async save(name: string, cfg: PipelineConfiguration): Promise<string>
    {
        const stem = safeStem(name)
        await this.fs.CreateDirectory(this.dir())
        await this.fs.WriteText(this.filePath(stem), JSON.stringify(cfg, null, 2))
        return stem
    }

    // Delete the preset file; tolerates its absence.
    public async delete(name: string): Promise<void>
    {
        try {
            await this.fs.Delete(this.filePath(safeStem(name)))
        } catch {
            // already gone — nothing to do
        }
    }

    private filePath(stem: string): string
    {
        return join(this.dir(), `${stem}.json`)
    }
}

// Replace every character outside [A-Za-z0-9._-] with '-' so the name is a safe
// file stem. The sanitized value is also the display name (filenames round-trip).
// Exported so the project-scoped store sanitizes identically.
export function safeStem(name: string): string
{
    return name.trim().replace(/[^A-Za-z0-9._-]/g, '-')
}

// Join a directory and a child using the directory's own separator (no
// node:path in the renderer). Mirrors open-projects-store.join.
function join(dir: string, name: string): string
{
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
    return dir.endsWith(sep) ? dir + name : dir + sep + name
}
