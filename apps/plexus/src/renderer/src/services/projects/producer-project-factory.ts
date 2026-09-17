import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { ProducerKind, type IProjectFactory } from '@pragmatic-tech-ai/plexus-core/renderer/projects/project-factory.js'

// Optional capability a producer factory (meta-model, library) implements:
// compile the project's sources into its base TodlDocument — exactly as publish
// would, given already-resolved bases. `problems` carries compile-error messages
// so callers decide whether to block (publish) or surface (the workspace
// resolver). Publish and the WorkspaceBaseResolver share this one pipeline.
//
// This lives app-side (not in plexus-core) because it references the todl
// compiler's TodlDocument type, and core keeps a todl-runtime-only floor.
export interface IProducerProjectFactory
{
    readonly producerKind: ProducerKind
    compileToDocument(
        storage: IStorage,
        bases: TodlDocument[],
        provider: IServiceProvider,
    ): Promise<{ doc: TodlDocument; problems: string[] }>
}

// Type guard: does this factory produce a consumable base?
export function isProducer(factory: IProjectFactory): factory is IProjectFactory & IProducerProjectFactory
{
    return typeof (factory as Partial<IProducerProjectFactory>).compileToDocument === 'function'
}
