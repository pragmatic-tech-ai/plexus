import { PresentationBakerKey, type IPresentationBaker, type BakeOptions, type BakeResult } from '@pragmatic-tech-ai/todl'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import type { IStorage, IServiceProvider } from '@pragmatic-tech-ai/todl-runtime'

import { publishPresentation } from '../../modules/meta-model/services/presentation-publisher.js'
import { publishLibraryPresentation } from '../../modules/library/services/library-presentation-publisher.js'

// The concrete IPresentationBaker the producer factories (now in todl) resolve through
// PresentationBakerKey. Baking runs the MURAL compiler's include resolver, so the
// implementation lives app-side; todl owns only the seam. This adapter dispatches to
// the two existing (app-verified) publishers by the requested dictionary name — the
// only thing that differs between the meta-model and library bakes (dict name +
// icon-key prefix). Both publishers already return the {ok,icons}|{ok,missing} shape
// BakeResult expects, so the results pass straight through.
export class MuralPresentationBaker implements IPresentationBaker {
    // Registered under todl's PresentationBakerKey (the `.services:` addInstance
    // convention keys by static Key), so the producer factories resolve it.
    public static readonly Key = PresentationBakerKey
    private static readonly LIBRARY_DICT = 'LibraryPresentation'

    // Ctor takes the provider the `.services:` lowering supplies (unused — baking is
    // stateless), so it fits the eager-singleton registration shape.
    constructor(_provider: IServiceProvider) {}

    public Bake(project: IStorage, dest: IStorage, base: string, doc: TodlDocument, options: BakeOptions): Promise<BakeResult> {
        return options.dictName === MuralPresentationBaker.LIBRARY_DICT
            ? publishLibraryPresentation(project, dest, base, doc)
            : publishPresentation(project, dest, base, doc)
    }
}
