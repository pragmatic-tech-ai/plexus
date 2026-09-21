// The project-factory contracts now live in todl (the headless engine that owns
// the whole project/solution ecosystem). This module re-exports them so the many
// plexus consumers keep importing from their established path while the single
// source of truth is todl. The concrete factories are likewise todl's; the app
// supplies only the mural/OS-coupled seams (IPresentationBaker, IProducerStorageBackends).
export {
    PROJECT_MANIFEST_FILENAME,
    ProducerKind,
    isPublishable,
    canGeneratePresentation,
    isVersioned,
    // The engine project-factory registry — the single source a project-explorer
    // resolves for the New-Project gallery (All) and open routing (factoryFor).
    // Supersedes mural's retired shell-side ProjectFactoryRegistry.
    ProjectFactoryRegistryKey,
} from '@pragmatic-tech-ai/todl'
export type {
    IProjectFactory,
    IProjectFactoryRegistry,
    ProjectFileFormat,
    ProjectManifestEnvelope,
    PublishResult,
    IPublishableProjectFactory,
    IPresentationProjectFactory,
    IVersionedProjectFactory,
} from '@pragmatic-tech-ai/todl'
