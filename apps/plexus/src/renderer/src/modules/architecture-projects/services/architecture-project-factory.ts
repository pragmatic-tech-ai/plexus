import { ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

import {
    type ProjectFileFormat,
    type ProjectManifestEnvelope,
} from '../../../services/projects/project-factory.js'
import { TodlProjectFactory, type ScaffoldFile } from '../../../services/projects/todl-project-factory.js'
import type { BaseBindings, BaseRef } from '../../../services/projects/base-binding.js'
import { ARCHITECTURE_SCAFFOLD } from './architecture-scaffold.js'

// The 'architecture' project type — the architecture-projects module's
// contribution to the generic ProjectExplorerService (declared via
// `.projectFactories:`, resolved through the ProjectFactoryRegistry). It is a
// TODL-authoring project: its `.todl` files are the instance-tier architecture
// model, validated live against the project's BOUND bases — a meta-model AND a
// set of libraries — by the shared base-aware TodlValidationService (which reads
// the manifest's metaModel + libraries via resolveBases). Architecture is the
// terminal consumer: it binds bases but publishes nothing, so it is not an
// IPublishableProjectFactory.
//
// All project-lifecycle plumbing (create/open/save, the tree walk, and the
// TODL agent scaffold) lives in TodlProjectFactory; this class declares only
// what differs: the .diagram + .todl formats, the bound-manifest shape, and its
// own CLAUDE.md scaffold contribution. The `.todl` / `.diagram` FILE formats are
// edited by their document factories (resolved by extension) — editors own
// files, this factory owns the project.
interface ArchitectureManifest extends ProjectManifestEnvelope
{
    metaModel?: BaseRef                  // the meta-model this architecture conforms to
    libraries?: readonly BaseRef[]       // the technology libraries it draws on
    diagrams?: { [path: string]: { viewpoints: string[] } }   // per-diagram viewpoint selection (SP4c)
}

export class ArchitectureProjectFactory extends TodlProjectFactory
{
    public static readonly Key = new ServiceKey<ArchitectureProjectFactory>('ArchitectureProjectFactory')
    public static readonly ProjectType = 'architecture'

    public readonly requiresMetaModel = true
    public readonly offersLibraries = true

    public readonly formats: readonly ProjectFileFormat[] = [
        { extension: '.diagram', kind: 'diagram', displayName: 'Diagram' },
        { extension: '.todl',    kind: 'todl',    displayName: 'TODL Definition' },
    ]

    constructor(provider: IServiceProvider) { super(provider) }

    protected buildManifest(name: string, bindings?: BaseBindings): ProjectManifestEnvelope
    {
        const manifest: ArchitectureManifest = {
            type: ArchitectureProjectFactory.ProjectType, name, version: 1,
            ...(bindings?.metaModel !== undefined ? { metaModel: bindings.metaModel } : {}),
            ...(bindings?.libraries !== undefined && bindings.libraries.length > 0
                ? { libraries: bindings.libraries } : {}),
        }
        return manifest
    }

    // The architecture project's own scaffold (its CLAUDE.md); the shared TODL
    // manual + rules are added by the base.
    protected scaffoldContributions(): readonly ScaffoldFile[]
    {
        return ARCHITECTURE_SCAFFOLD
    }
}
