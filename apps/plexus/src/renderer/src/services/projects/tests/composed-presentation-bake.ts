import { ServiceProvider, type IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { PresentationBakerKey, ProjectSystemComposer, type BakeOptions, type BakeResult, type TodlDocument } from '@pragmatic-tech-ai/todl'

// Test driver that bakes a hand-built own-only document through the presentation
// baker Plexus composes — TodlProjectSystemModule's PresentationBakerKey (TODL's
// DefaultPresentationBaker) — so the app-side loaders are exercised against the
// artifact format TODL actually writes. Replaces the deleted app-side publishers.
export class ComposedPresentationBake
{
    private static readonly MetaModelOptions: BakeOptions = { dictName: 'MetaModelPresentation', iconPrefix: 'mm:' }
    private static readonly LibraryOptions: BakeOptions = { dictName: 'LibraryPresentation', iconPrefix: '' }
    private static readonly IconAnnotation = 'todl.icon'
    private static readonly MuralResourceAnnotation = 'todl.MuralResource'
    private static readonly AnnotationMetaKind = 'annotation'
    private static readonly ExtendsEdgeKind = 'Extends'

    // Bakes `document` as a meta-model presentation (mm: icon keyspace).
    public static MetaModel(project: IStorage, dest: IStorage, base: string, document: TodlDocument): Promise<BakeResult>
    {
        return ComposedPresentationBake.Bake(project, dest, base, document, ComposedPresentationBake.MetaModelOptions)
    }

    // Bakes `document` as a library presentation (bare class-id icon keyspace).
    public static Library(project: IStorage, dest: IStorage, base: string, document: TodlDocument): Promise<BakeResult>
    {
        return ComposedPresentationBake.Bake(project, dest, base, document, ComposedPresentationBake.LibraryOptions)
    }

    private static Bake(project: IStorage, dest: IStorage, base: string, document: TodlDocument, options: BakeOptions): Promise<BakeResult>
    {
        const provider = new ServiceProvider()
        ProjectSystemComposer.Compose(provider)
        return provider.getRequired(PresentationBakerKey)
            .Bake(project, dest, base, document, ComposedPresentationBake.Closure(document), options)
    }

    // The closure a compiled package would carry: the own document plus the prelude's
    // `icon : MuralResource` annotation declarations, which the baker resolves icon
    // ancestry against.
    private static Closure(document: TodlDocument): TodlDocument
    {
        return {
            ...document,
            nodes: [
                ...document.nodes,
                { id: ComposedPresentationBake.IconAnnotation, type: null, metaKind: ComposedPresentationBake.AnnotationMetaKind, attrs: {} },
                { id: ComposedPresentationBake.MuralResourceAnnotation, type: null, metaKind: ComposedPresentationBake.AnnotationMetaKind, attrs: {} },
            ],
            edges: [
                ...document.edges,
                { kind: ComposedPresentationBake.ExtendsEdgeKind, from: ComposedPresentationBake.IconAnnotation, to: ComposedPresentationBake.MuralResourceAnnotation },
            ],
        } as unknown as TodlDocument
    }
}
