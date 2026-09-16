import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import type { IDiagramCommandExtension } from '../../diagram/services/diagram-command-extension.js'
import { DiagramViewpointsEditor } from './diagram-viewpoints-editor.js'

// The diagram toolbar command id for editing an architecture diagram's governing
// viewpoints. Matches the CommandDefinition in architecture-projects.module.mu.
export const EDIT_VIEWPOINTS_COMMAND_ID = 'arch.editViewpoints'

// Backs the "Edit Viewpoints" toolbar command via the diagram command-extension
// seam: enabled only for an arch-bound diagram (so the button greys out on a
// standalone diagram), and opens the shared DiagramViewpointsEditor flow.
export class ArchEditViewpointsCommand extends ServiceBase implements IDiagramCommandExtension
{
    public static readonly Key = new ServiceKey<ArchEditViewpointsCommand>('ArchEditViewpointsCommand')

    public constructor(provider: IServiceProvider) { super(provider) }

    public handles(id: string): boolean
    {
        return id === EDIT_VIEWPOINTS_COMMAND_ID
    }

    public canExecute(doc: DiagramDocument): boolean
    {
        return this.Provider.getRequired(DiagramViewpointsEditor.Key).canEdit(doc)
    }

    public execute(doc: DiagramDocument): void
    {
        void this.Provider.getRequired(DiagramViewpointsEditor.Key).edit(doc)
    }
}
