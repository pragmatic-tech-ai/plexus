// project-commands-service.ts — the Open / New project commands the Solution Explorer's
// command bar binds to, plus the New Project form builder (NewProjectFormFor / ApplyPrefill)
// and the single CreateProject entry the agent's create card shares. Built over the todl
// engine's ProjectLifecycle (create / open as typed outcomes + recents tracking); this class
// adds only the UI: the Open Project / New Project dialogs and failure feedback.
import { ServiceBase, ServiceKey, RelayCommand, type ICommand, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import {
    SolutionManagerService, PROJECT_MANIFEST_FILENAME,
} from '@pragmatic-tech-ai/todl'
import { ProjectFactoryRegistryKey } from '../../../projects/project-factory.js'
import { PublishedBasesKey } from '../../../projects/index.js'
import type { BaseRef } from '../../../projects/base-binding.js'
import type { ReferenceNode } from '../../../projects/reference-node.js'
import { RecentProjectsService } from '../../../projects/recent-projects-service.js'
import { OpenProjectsStore } from '../../../projects/open-projects-store.js'
import {
    NewProjectDialogModel, ProjectTypeChoice, type NewProjectResult,
} from '../../../projects/new-project-dialog-model.js'
import { OpenProjectDialogModel, type OpenProjectResult } from '../../../projects/open-project-dialog-model.js'
import { FileSystemService, StorageService } from '../../storage/index.js'
import type { CreateProjectPrefill, CreateProjectResult } from './project-create-contract.js'
import { InfoDialog } from './info-dialog.js'
import { ProjectLifecycle, CreateError, OpenError } from './todl-engine-ops.js'

// The result of CreateProject — the tool outcome minus its correlation id.
export type CreateOutcome = Omit<CreateProjectResult, 'id'>

export class ProjectCommandsService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ProjectCommandsService>('ProjectCommandsService')

    private static readonly OpenTitle = 'Open Project'
    private static readonly NewTitle = 'New Project'
    private static readonly OpenWidth = 720
    private static readonly NewWidth = 520
    private static readonly NoFactoryMessage = 'No project factory registered.'
    private static readonly FolderHasProject = 'That folder already contains a project.'
    private static readonly AlreadyOpenMessage = 'That project is already open.'
    private static readonly OpenNoFactoryMessage = 'No factory is registered for that project type.'
    private static readonly OpenFailedMessage = 'The project could not be opened.'
    private static readonly CreateInvalidMessage = 'Could not create the project in that location.'
    private static readonly CreateUnresolvedMessage = 'The project was created but did not open.'
    private static readonly UnixSeparator = '/'
    private static readonly WindowsSeparator = '\\'

    private readonly _openProjectCommand: ICommand
    private readonly _newProjectCommand: ICommand
    private lifecycle: ProjectLifecycle | undefined

    constructor(provider: IServiceProvider)
    {
        super(provider)
        this._openProjectCommand = new RelayCommand(() => void this.OpenProject())
        this._newProjectCommand = new RelayCommand(() => void this.NewProject())
    }

    public get OpenProjectCommand(): ICommand { return this._openProjectCommand }
    public get NewProjectCommand(): ICommand { return this._newProjectCommand }

    private get dialogs(): DialogService { return this.Provider.getRequired(DialogService.Key) }
    private get fs(): FileSystemService { return this.Provider.getRequired(FileSystemService.Key) }
    private get storageRegistry(): StorageService { return this.Provider.getRequired(StorageService.Key) }
    private get recents(): RecentProjectsService { return this.Provider.getRequired(RecentProjectsService.Key) }

    // Created lazily: the solution engine seams ProjectLifecycle needs are registered after
    // this service's ctor runs at mount. Recents and the open-projects session (persisted via
    // OpenProjectsStore) are both tracked by the lifecycle.
    private get projects(): ProjectLifecycle
    {
        return (this.lifecycle ??= new ProjectLifecycle(
            this.Provider, this.Provider.getRequired(SolutionManagerService.Key),
            this.Provider.getRequired(OpenProjectsStore.Key), this.recents))
    }

    // Reopen the previous session's projects (startup); prunes folders whose manifest is gone.
    public RestoreSession(): Promise<void>
    {
        return this.projects.RestoreSession()
    }

    // Open Project: present the recents-or-Browse dialog; open whatever folder it resolves to.
    public async OpenProject(): Promise<void>
    {
        const recents = await this.recents.List()
        const vm = new OpenProjectDialogModel(recents, this.fs, (r) => this.dialogs.Close(r))
        const result = (await this.dialogs.Show({
            Title: ProjectCommandsService.OpenTitle, Content: vm, Width: ProjectCommandsService.OpenWidth,
        })) as OpenProjectResult | undefined
        if (result === undefined) return
        await this.OpenProjectAt(result.location)
    }

    // Open the project at `folder`; a failure (already open / no factory / error) is reported.
    public async OpenProjectAt(folder: string): Promise<void>
    {
        const outcome = await this.projects.OpenProjectAt(folder)
        if (outcome.opened) return
        await this.Inform(ProjectCommandsService.OpenTitle, ProjectCommandsService.OpenErrorMessage(outcome.error))
    }

    // New Project: present the full type-picker dialog; create in the chosen folder.
    public async NewProject(): Promise<void>
    {
        if (this.TypeChoices().length === 0)
        {
            await this.Inform(ProjectCommandsService.NewTitle, ProjectCommandsService.NoFactoryMessage)
            return
        }
        const vm = await this.NewProjectFormFor((r) => this.dialogs.Close(r))
        const result = (await this.dialogs.Show({
            Title: ProjectCommandsService.NewTitle, Content: vm, Width: ProjectCommandsService.NewWidth,
        })) as NewProjectResult | undefined
        if (result === undefined) return
        const outcome = await this.CreateProject(result)
        if (!outcome.created) await this.Inform(ProjectCommandsService.NewTitle, outcome.error ?? ProjectCommandsService.CreateInvalidMessage)
    }

    // Build a configured New Project form: the type choices, the published meta-models/libraries
    // pickers, and live validation — pre-filled from the agent's proposal. `close` is supplied by
    // the caller (the modal or the chat card).
    public async NewProjectFormFor(
        close: (result?: NewProjectResult) => void,
        prefill?: CreateProjectPrefill): Promise<NewProjectDialogModel>
    {
        const vm = new NewProjectDialogModel(
            this.TypeChoices(),
            this.fs,
            (r) => this.ValidateNewProject(r),
            close,
            await this.PublishedMetaModels(),
            await this.PublishedLibraries(),
        )
        ProjectCommandsService.ApplyPrefill(vm, prefill)
        return vm
    }

    // The single project creator: validate, create on disk via the engine lifecycle, open the
    // member, and return the outcome (which a void command cannot). Shared by the toolbar dialog
    // and the agent's create card. The project always lands in its own subfolder named after it.
    public async CreateProject(data: NewProjectResult): Promise<CreateOutcome>
    {
        const error = await this.ValidateNewProject(data)
        if (error !== null) return { created: false, error }
        const outcome = await this.projects.CreateProject({
            type: data.type as never,
            name: data.name.trim(),
            location: data.location,
            bindings: { metaModels: data.metaModels, libraries: data.libraries },
        })
        if (!outcome.created) return { created: false, error: ProjectCommandsService.CreateErrorMessage(outcome.error) }
        return { created: true, folder: outcome.folder, name: outcome.name, type: data.type }
    }

    // Apply the agent's optional prefill onto a New Project form: set the name / location text
    // and select the matching type (unknown/missing values are ignored, leaving the defaults),
    // then carry the proposed base bindings into the References tree by id@version.
    public static ApplyPrefill(form: NewProjectDialogModel, prefill?: CreateProjectPrefill): void
    {
        if (prefill === undefined) return
        if (prefill.name !== undefined) form.Name = prefill.name
        if (prefill.location !== undefined) form.Location = prefill.location
        if (prefill.type !== undefined)
        {
            const match = form.Types.ToArray().find((t) => t.Type === prefill.type)
            if (match?.SelectCommand !== undefined) match.SelectCommand.Execute()
        }
        if (prefill.metaModels !== undefined) ProjectCommandsService.CheckLeaves(form.MetaModelNodes, prefill.metaModels)
        if (prefill.libraries !== undefined) ProjectCommandsService.CheckLeaves(form.LibraryNodes, prefill.libraries)
    }

    private static CheckLeaves(leaves: readonly ReferenceNode[], wanted: readonly BaseRef[]): void
    {
        const keys = new Set(wanted.map((r) => `${r.id}@${r.version}`))
        for (const leaf of leaves)
        {
            if (leaf.Ref !== undefined && keys.has(`${leaf.Ref.id}@${leaf.Ref.version}`)) leaf.IsSelected = true
        }
    }

    // One selectable choice per installed factory (self-describing: typeId / title /
    // description; requiresMetaModel / offersLibraries drive the pickers).
    private TypeChoices(): ProjectTypeChoice[]
    {
        return this.Provider.getRequired(ProjectFactoryRegistryKey)
            .All()
            .map((f) => new ProjectTypeChoice(
                f.typeId, f.title, f.description,
                f.requiresMetaModel ?? false,
                f.offersLibraries ?? false))
    }

    private async PublishedMetaModels(): Promise<BaseRef[]>
    {
        return (await this.Provider.get(PublishedBasesKey)?.ListMetaModels()) ?? []
    }

    private async PublishedLibraries(): Promise<BaseRef[]>
    {
        return (await this.Provider.get(PublishedBasesKey)?.ListLibraries()) ?? []
    }

    // Refuse a folder that already holds a project. Validates the SUBFOLDER we will create in
    // (location/name), not the chosen parent location.
    private async ValidateNewProject(result: NewProjectResult): Promise<string | null>
    {
        const folder = ProjectCommandsService.JoinPath(result.location, result.name.trim())
        const storage = this.storageRegistry.Create(StorageService.DefaultBackendId, folder)
        if (await storage.Exists(PROJECT_MANIFEST_FILENAME)) return ProjectCommandsService.FolderHasProject
        return null
    }

    // Join an ABSOLUTE OS location with a subfolder name using the location's own separator
    // (the renderer has no node:path).
    private static JoinPath(dir: string, name: string): string
    {
        const sep = dir.includes(ProjectCommandsService.WindowsSeparator) && !dir.includes(ProjectCommandsService.UnixSeparator)
            ? ProjectCommandsService.WindowsSeparator
            : ProjectCommandsService.UnixSeparator
        return dir.endsWith(sep) ? dir + name : dir + sep + name
    }

    private static OpenErrorMessage(error: OpenError): string
    {
        if (error === OpenError.AlreadyOpen) return ProjectCommandsService.AlreadyOpenMessage
        if (error === OpenError.NoFactory) return ProjectCommandsService.OpenNoFactoryMessage
        return ProjectCommandsService.OpenFailedMessage
    }

    private static CreateErrorMessage(error: CreateError): string
    {
        if (error === CreateError.FolderHasManifest) return ProjectCommandsService.FolderHasProject
        if (error === CreateError.NoFactory) return ProjectCommandsService.NoFactoryMessage
        if (error === CreateError.Unresolved) return ProjectCommandsService.CreateUnresolvedMessage
        return ProjectCommandsService.CreateInvalidMessage
    }

    private Inform(title: string, message: string): Promise<void>
    {
        return InfoDialog.Show(this.dialogs, title, message)
    }
}
