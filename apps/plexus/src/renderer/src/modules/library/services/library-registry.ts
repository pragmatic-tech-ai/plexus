import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import { ensureLibrariesBackend } from './libraries-backend.js'
import { discoverLibraries, type LoadedLibrary, type LoadProblem } from './library-loader.js'
import { DiagnosticsService } from '../../../services/diagnostics/diagnostics-service.js'
import { DiagnosticSeverity, type Diagnostic } from '../../../services/diagnostics/diagnostic.js'

const OWNER = 'libraries'

// Metadata-only registry for published library bundles. Scans each library.json,
// builds per-library Problems slices (discovery errors only), and publishes them to
// DiagnosticsService. Does NOT compile visual templates, merge resources into
// Application, or hold any resolve() logic — those responsibilities belong to
// LibraryPresentationSource (aggregated by TodlPresentationRegistry).
export class LibraryRegistry extends ServiceBase
{
    public static readonly Key = new ServiceKey<LibraryRegistry>('LibraryRegistry')

    // Per-library Problems slices, rebuilt on each discover().
    private readonly slices = new Map<string, { lib: LoadedLibrary; problems: LoadProblem[] }>()

    constructor(provider: IServiceProvider)
    {
        super(provider)
    }

    // Discover every published library (reads each library.json), rebuilds the
    // per-library Problems slices for discovery errors, and returns the loaded set
    // for the Libraries panel. No visual compilation happens here.
    public async discover(): Promise<LoadedLibrary[]>
    {
        this.slices.clear()
        const backend = ensureLibrariesBackend(this.Provider)
        const libs = await discoverLibraries(backend)
        for (const lib of libs) {
            const pid = this.projectIdOf(lib)
            this.slices.set(pid, { lib, problems: [...lib.problems] })
            this.publishSlice(pid)
        }
        return libs
    }

    // Uninstall a published library: remove its <id>/<version> folder from the
    // backend and clear its Problems slice (keyed as publish() does). The panel
    // reloads afterwards so the row disappears. Does not touch any authored library
    // *project* on disk — only the installed copy in the local libraries store.
    public async delete(id: string, version: string): Promise<void>
    {
        const backend = ensureLibrariesBackend(this.Provider)
        await backend.Delete(`${id}/${version}`)
        this.Provider.get(DiagnosticsService.Key)?.Publish(OWNER, `library:${id}@${version}`, [])
    }

    private projectIdOf(lib: LoadedLibrary): string { return `library:${lib.id}@${lib.version}` }

    private publishSlice(pid: string): void
    {
        const slice = this.slices.get(pid)
        if (slice !== undefined) this.publish(slice.lib, slice.problems)
    }

    private publish(lib: LoadedLibrary, problems: readonly LoadProblem[]): void
    {
        const diagnostics = this.Provider.get(DiagnosticsService.Key)
        if (diagnostics === undefined) return
        const projectId = `library:${lib.id}@${lib.version}`
        const projectName = `${lib.name} (${lib.id}@${lib.version})`
        const diags: Diagnostic[] = problems.map((p) => ({
            owner: OWNER, projectId, projectName, uri: p.uri, message: p.message,
            severity: p.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning, span: null,
        }))
        diagnostics.Publish(OWNER, projectId, diags)   // empty array clears the slice
    }
}
