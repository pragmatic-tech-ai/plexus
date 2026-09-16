import { ResourceDictionary, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import type { PresentationContribution, PresentationSource } from '../../diagram/services/todl-presentation-registry.js'
import { ensureLibrariesBackend } from './libraries-backend.js'
import type { LoadedLibrary } from './library-loader.js'
import { loadCompiledPresentation } from '../../meta-model/services/compiled-presentation.js'
import { readIconIndex } from '../../meta-model/services/icon-index.js'

// A PresentationSource contributing all installed libraries' icon assets +
// entityKey→resource-key index for the TodlPresentationRegistry. For each
// LoadedLibrary it merges the baked asset dictionary and reads icon-index.json
// (keyed by bare class id). Assets-only: no authored .mural or legacy per-class
// icon tiers — every class renders through Plexus's one default template.
export class LibraryPresentationSource implements PresentationSource
{
    readonly id = 'library'

    constructor(
        private readonly provider: IServiceProvider,
        private readonly libraries: () => Promise<LoadedLibrary[]>,
    ) {}

    public async load(): Promise<PresentationContribution>
    {
        const backend = ensureLibrariesBackend(this.provider)
        const assets = new ResourceDictionary()
        const iconKeys = new Map<string, string>()
        for (const lib of await this.libraries()) {
            const base = `${lib.id}/${lib.version}`
            const pres = await loadCompiledPresentation(backend, base)
            if (pres !== undefined) for (const [k, v] of pres.Entries()) assets.Set(k, v)
            for (const [k, v] of await readIconIndex(backend, base)) iconKeys.set(k, v)
        }
        return { assets, iconKeys }
    }
}
