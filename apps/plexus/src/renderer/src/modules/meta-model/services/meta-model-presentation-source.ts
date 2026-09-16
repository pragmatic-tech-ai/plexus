import { ResourceDictionary, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { PresentationContribution, PresentationSource } from '../../diagram/services/todl-presentation-registry.js'
import { ensureMetaModelsBackend } from './meta-models-backend.js'
import { scanPublishedModels } from './meta-model-tree-builder.js'
import { loadCompiledPresentation } from './compiled-presentation.js'
import { readIconIndex } from './icon-index.js'

// A PresentationSource contributing all published meta-models' icon assets +
// entityKey→resource-key index for the TodlPresentationRegistry. For each published
// <id>/<version> it merges the baked asset dictionary and reads icon-index.json
// (keyed mm:<entity-id>). A version whose artifact is absent contributes nothing.
export class MetaModelPresentationSource implements PresentationSource
{
    readonly id = 'meta-model'

    constructor(private readonly provider: IServiceProvider) {}

    public async load(): Promise<PresentationContribution>
    {
        let backend: IStorage
        try { backend = ensureMetaModelsBackend(this.provider) }
        catch { return { assets: new ResourceDictionary(), iconKeys: new Map() } }   // headless / not wired

        const assets = new ResourceDictionary()
        const iconKeys = new Map<string, string>()
        for (const { id, versions } of await scanPublishedModels(backend)) {
            for (const version of versions) {
                const base = `${id}/${version}`
                const pres = await loadCompiledPresentation(backend, base)
                if (pres !== undefined) for (const [k, v] of pres.Entries()) assets.Set(k, v)
                for (const [k, v] of await readIconIndex(backend, base)) iconKeys.set(k, v)
            }
        }
        return { assets, iconKeys }
    }
}
