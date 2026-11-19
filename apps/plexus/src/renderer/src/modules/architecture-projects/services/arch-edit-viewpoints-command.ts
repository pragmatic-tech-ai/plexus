import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import type { BoardDocument } from '@pragmatic-tech-ai/mural/framework'
import type { IBoardCommandExtension } from '../../board/services/board-command-extension.js'
import { BoardViewpointsEditor } from './board-viewpoints-editor.js'

// The board toolbar command id for editing an architecture board's governing
// viewpoints. Matches the CommandDefinition in architecture-projects.module.mu.
export const EDIT_VIEWPOINTS_COMMAND_ID = 'arch.editViewpoints'

// Backs the "Edit Viewpoints" toolbar command via the board command-extension
// seam: enabled only for an arch-bound board (so the button greys out on a
// standalone board), and opens the shared BoardViewpointsEditor flow.
export class ArchEditViewpointsCommand extends ServiceBase implements IBoardCommandExtension
{
    public static readonly Key = new ServiceKey<ArchEditViewpointsCommand>('ArchEditViewpointsCommand')

    public constructor(provider: IServiceProvider) { super(provider) }

    public handles(id: string): boolean
    {
        return id === EDIT_VIEWPOINTS_COMMAND_ID
    }

    public canExecute(doc: BoardDocument): boolean
    {
        return this.Provider.getRequired(BoardViewpointsEditor.Key).canEdit(doc)
    }

    public execute(doc: BoardDocument): void
    {
        void this.Provider.getRequired(BoardViewpointsEditor.Key).edit(doc)
    }
}
