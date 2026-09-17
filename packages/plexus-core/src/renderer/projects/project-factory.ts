import type { IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { TodlDocument } from '@pragmatic-tech-ai/todl'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import type { Project } from './project.js'
import type { BaseBindings } from './base-binding.js'

// The contract a module's project factory implements — the behavior the
// generic ProjectExplorerService delegates to. A module declares a
// ProjectFactoryDefinition (mural) whose Factory service token resolves to an
// IProjectFactory; the explorer routes create/open/save through it, staying
// ignorant of any concrete project. FILE editing (open/save/new a document)
// is a separate concern — an IDocumentFactory resolved by extension via the
// DocumentTypeRegistry; editors own files, factories own projects.
//
// Persistence flows through an IStorage (rooted at the project, project-relative
// paths) rather than the raw file system, so a project's backend — local FS
// today, cloud/REST later — is transparent to the factory. The explorer builds
// the IStorage and hands it in.

// The manifest file at a project folder's root. Its `type` routes a folder to
// the factory that owns it; the rest of the manifest is factory-specific (each
// factory reads/writes its own extended shape). Only this envelope is generic.
// (JSON content, but the `.plexus` name alone identifies it — no `.json` tail.)
export const PROJECT_MANIFEST_FILENAME = 'project.plexus'

export interface ProjectManifestEnvelope
{
    type:     string
    name?:    string
    version?: number
    // The storage backend the project lives on (a StorageProviderRegistry id).
    // Absent ⇒ the default 'local' backend.
    storage?: string
}

// One file format a factory understands — surfaced in a "New file" affordance.
// `kind` is the ProjectNode kind ('diagram' for openable-in-app formats).
export interface ProjectFileFormat
{
    extension:   string   // leading dot, e.g. ".diagram"
    kind:        string
    displayName: string
}

export interface IProjectFactory
{
    readonly formats: readonly ProjectFileFormat[]

    // True when creating this project type needs a meta-model base chosen up front
    // (the New-Project dialog shows a meta-model picker). Absent ⇒ false.
    readonly requiresMetaModel?: boolean

    // True when this project type binds a set of libraries chosen up front (the
    // New-Project dialog shows a libraries multi-select). Absent ⇒ false.
    readonly offersLibraries?: boolean

    // Project lifecycle. createProject writes an initial manifest into a fresh
    // project storage — with the chosen base bindings, when the type declares any;
    // openProject reads the manifest + builds the file tree; saveProject persists
    // project-level state (the manifest). All operate on a rooted IStorage
    // (project-relative paths).
    createProject(storage: IStorage, name: string, bindings?: BaseBindings): Promise<Project>
    openProject(storage: IStorage): Promise<Project>
    saveProject(project: Project, storage: IStorage): Promise<void>
}

// The outcome of a publish — surfaced verbatim by the explorer as its status.
export interface PublishResult
{
    ok:      boolean
    message: string
}

// Optional capability a factory MAY also implement: producing a shareable
// artifact from the project. The explorer feature-tests with isPublishable
// before offering its Publish command — the same pattern as ILocalFileAccess.
// `provider` is passed so publish can resolve a destination backend / services.
export interface IPublishableProjectFactory
{
    publish(project: Project, storage: IStorage, provider: IServiceProvider): Promise<PublishResult>
}

// Type guard: does this factory support publishing?
export function isPublishable(factory: IProjectFactory): factory is IProjectFactory & IPublishableProjectFactory
{
    return typeof (factory as Partial<IPublishableProjectFactory>).publish === 'function'
}

// Optional capability a factory MAY also implement: (re)generating a presentation
// resource dictionary into the project from its compiled model. `colored` picks the
// icon mode (true → colorful IconDefinitions, false → monochrome geometry). The
// explorer feature-tests with canGeneratePresentation before offering its Generate
// Presentation submenu (Colorful / Monochrome) — same pattern as isPublishable.
export interface IPresentationProjectFactory
{
    regeneratePresentation(storage: IStorage, colored: boolean): Promise<void>
}

// Type guard: can this factory (re)generate a presentation?
export function canGeneratePresentation(
    factory: IProjectFactory,
): factory is IProjectFactory & IPresentationProjectFactory
{
    return typeof (factory as Partial<IPresentationProjectFactory>).regeneratePresentation === 'function'
}

// Optional capability a producer factory (meta-model, library) implements: read
// and update the manifest's published version. The explorer's Bump Version
// command feature-tests with isVersioned before offering it — same pattern as
// isPublishable. Each producer knows its own manifest field (modelVersion /
// libVersion); this seam hides that from the caller.
export interface IVersionedProjectFactory
{
    getVersion(storage: IStorage): Promise<string>
    setVersion(storage: IStorage, version: string): Promise<void>
}

// Type guard: does this factory expose a bumpable version?
export function isVersioned(
    factory: IProjectFactory,
): factory is IProjectFactory & IVersionedProjectFactory
{
    const f = factory as Partial<IVersionedProjectFactory>
    return typeof f.getVersion === 'function' && typeof f.setVersion === 'function'
}

// The producer kinds — a project type that publishes a base other projects
// consume. Values match the corresponding factory `ProjectType` strings.
export enum ProducerKind
{
    MetaModel = 'meta-model',
    Library   = 'library',
}

// Optional capability a producer factory (meta-model, library) implements:
// compile the project's sources into its base TodlDocument — exactly as publish
// would, given already-resolved bases. `problems` carries compile-error messages
// so callers decide whether to block (publish) or surface (the workspace
// resolver). Publish and the WorkspaceBaseResolver share this one pipeline.
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
