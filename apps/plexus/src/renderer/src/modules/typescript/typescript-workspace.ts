import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { ITypeScriptWorkspaceSink } from '@pragmatic-tech-ai/plexus-core/renderer/typescript/typescript-seams.js'
import type { IModelRegistry } from './model-registry.js'

// Per-project TypeScript language context: keeps a Monaco model for every project
// .ts/.tsx/.d.ts file so the global TS worker resolves cross-file imports, not just
// files open in a tab. Models live at file:///<projectKey>/<relPath> so TypeScript's
// upward module resolution reaches the /node_modules framework typings, and two open
// projects never collide on a shared file name.
export class TypeScriptWorkspace implements ITypeScriptWorkspaceSink
{
    public static Key = new ServiceKey<TypeScriptWorkspace>('TypeScriptWorkspace')

    private static readonly Scheme = 'file:///'
    private static readonly SourceDirectory = 'src'
    private static readonly GeneratedDirectory = 'generated'
    private static readonly Separator = '/'
    private static readonly Language = 'typescript'
    private static readonly Extensions = ['.ts', '.tsx', '.d.ts']
    private static readonly SeparatorPattern = /[\\/]/
    private static readonly HexWidth = 4
    private static readonly HexRadix = 16
    private static readonly HexPad = '0'

    // projectId -> { storage, relPaths } so DetachProject disposes exactly its own.
    private readonly projects = new Map<string, { storage: IStorage; relPaths: Set<string> }>()

    constructor(private readonly registry: IModelRegistry)
    {
    }

    public async AttachProject(projectId: string, _projectName: string, storage: IStorage): Promise<void>
    {
        const relPaths = new Set<string>()
        await this.Gather(storage, TypeScriptWorkspace.SourceDirectory, relPaths)
        await this.Gather(storage, TypeScriptWorkspace.GeneratedDirectory, relPaths)
        this.projects.set(projectId, { storage, relPaths })
        for (const relPath of relPaths)
        {
            this.registry.Ensure(TypeScriptWorkspace.ModelUriFor(projectId, relPath), await storage.ReadText(relPath), TypeScriptWorkspace.Language)
        }
    }

    public DetachProject(projectId: string): void
    {
        const project = this.projects.get(projectId)
        if (project === undefined) return
        for (const relPath of project.relPaths) this.registry.Dispose(TypeScriptWorkspace.ModelUriFor(projectId, relPath))
        this.projects.delete(projectId)
    }

    // Re-create one file's model from storage if missing (CodeEditor disposes the
    // URI-keyed model it adopted when its tab closes).
    public async EnsureModelFor(projectId: string, relPath: string): Promise<void>
    {
        const project = this.projects.get(projectId)
        if (project === undefined) return
        const uri = TypeScriptWorkspace.ModelUriFor(projectId, relPath)
        if (this.registry.Has(uri)) return
        project.relPaths.add(relPath)
        this.registry.Ensure(uri, await project.storage.ReadText(relPath), TypeScriptWorkspace.Language)
    }

    public ProjectIdFor(storage: IStorage): string | undefined
    {
        for (const [projectId, project] of this.projects)
        {
            if (project.storage === storage) return projectId
        }
        return undefined
    }

    public ProjectIdForKey(projectKey: string): string | undefined
    {
        for (const projectId of this.projects.keys())
        {
            if (TypeScriptWorkspace.ProjectKeyFor(projectId) === projectKey) return projectId
        }
        return undefined
    }

    private async Gather(storage: IStorage, dir: string, out: Set<string>): Promise<void>
    {
        let entries: readonly { Name: string; IsDirectory: boolean }[]
        try { entries = await storage.List(dir) }
        catch { return } // absent dir (e.g. generated/ before a build): no files
        for (const entry of entries)
        {
            const path = `${dir}${TypeScriptWorkspace.Separator}${entry.Name}`
            if (entry.IsDirectory) await this.Gather(storage, path, out)
            else if (TypeScriptWorkspace.IsTypeScript(entry.Name)) out.add(path)
        }
    }

    private static IsTypeScript(name: string): boolean
    {
        const lower = name.toLowerCase()
        return TypeScriptWorkspace.Extensions.some((ext) => lower.endsWith(ext))
    }

    public static ProjectKeyFor(projectId: string): string
    {
        let hex = ''
        for (let i = 0; i < projectId.length; i++)
        {
            hex += projectId.charCodeAt(i).toString(TypeScriptWorkspace.HexRadix).padStart(TypeScriptWorkspace.HexWidth, TypeScriptWorkspace.HexPad)
        }
        return hex
    }

    public static PrefixFor(projectId: string): string
    {
        return `${TypeScriptWorkspace.Scheme}${TypeScriptWorkspace.ProjectKeyFor(projectId)}${TypeScriptWorkspace.Separator}`
    }

    public static ModelUriFor(projectId: string, relPath: string): string
    {
        return `${TypeScriptWorkspace.PrefixFor(projectId)}${relPath.split(TypeScriptWorkspace.SeparatorPattern).join(TypeScriptWorkspace.Separator)}`
    }

    public static RelPathFromUri(uri: string): { projectKey: string; relPath: string } | undefined
    {
        if (!uri.startsWith(TypeScriptWorkspace.Scheme)) return undefined
        const rest = uri.slice(TypeScriptWorkspace.Scheme.length)
        const slash = rest.indexOf(TypeScriptWorkspace.Separator)
        if (slash <= 0) return undefined
        return { projectKey: rest.slice(0, slash), relPath: rest.slice(slash + 1) }
    }
}
