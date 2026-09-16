import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import type { INewFileParticipant } from '../../../services/documents/new-file-participant.js'
import type { OpenProject } from '../../../services/projects/open-project.js'
import { ArchitectureModelService } from './architecture-model-service.js'
import { pickViewpoints } from './viewpoint-picker.js'
import { writeViewpointsToFile } from './arch-diagram-viewpoints-store.js'

// The architecture-projects new-file participant: for a new `.diagram` in an
// architecture project, prompt for the governing viewpoints (a modal picker via
// DialogService) and serialize the selection into the diagram file, so it
// restores on open and scopes what can be added.
//
// OnCreated returns whether to KEEP the just-created file: false only when the
// user cancels the picker (the explorer then deletes the file, aborting
// creation). Every other path returns true and leaves the file untouched — a
// non-architecture project, a non-.diagram file, a headless host with no
// DialogService, or a model that declares no viewpoints to scope by.
export class ArchNewDiagramParticipant extends ServiceBase implements INewFileParticipant
{
    public static readonly Key = new ServiceKey<ArchNewDiagramParticipant>('ArchNewDiagramParticipant')

    public constructor(provider: IServiceProvider) { super(provider) }

    public async OnCreated(op: OpenProject, path: string): Promise<boolean>
    {
        if (op.Project.Type !== 'architecture' || !path.toLowerCase().endsWith('.diagram')) return true
        const dialogs = this.Provider.get(DialogService.Key)
        if (dialogs === undefined) return true   // headless: no picker, keep the file
        const model = await this.Provider.getRequired(ArchitectureModelService.Key).modelFor(op)
        const viewpoints = model.viewpoints().map((v) => v.id)
        if (viewpoints.length === 0) return true   // nothing to scope by, keep the file
        const chosen = await pickViewpoints(dialogs, viewpoints)
        if (chosen === undefined) return false     // cancelled → abort creation
        await writeViewpointsToFile(op.Storage, path, chosen)
        return true
    }
}
