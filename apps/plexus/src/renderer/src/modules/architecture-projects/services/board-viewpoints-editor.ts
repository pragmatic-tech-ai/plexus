import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService, type IDocument } from '@pragmatic-tech-ai/mural/framework'
import { ConfirmDialogModel } from '@pragmatic-tech-ai/plexus-core/renderer/dialogs/confirm-dialog-model.js'
import { ArchBoardBindingService } from './arch-board-binding-service.js'
import { pickViewpoints } from './viewpoint-picker.js'
import type { LeavingNode } from './viewpoint-scope-reconcile.js'

// Shared "edit the governing viewpoints" orchestration, invoked from both the
// board toolbar and the Project Explorer's board context menu. It runs the
// full flow against a live, arch-bound board document:
//   pick viewpoints (pre-selected to the current scope)
//     → if narrowing drops nodes, confirm with the list
//       → commit the new scope (which removes those nodes + persists).
// A no-op when the document isn't an arch-bound board, or when there is no
// DialogService (headless).
export class BoardViewpointsEditor extends ServiceBase
{
    public static readonly Key = new ServiceKey<BoardViewpointsEditor>('BoardViewpointsEditor')

    public constructor(provider: IServiceProvider) { super(provider) }

    public async edit(doc: IDocument): Promise<void>
    {
        const dialogs = this.Provider.get(DialogService.Key)
        const binding = this.Provider.get(ArchBoardBindingService.Key)
        if (dialogs === undefined || binding === undefined) return
        const model = binding.modelForDocument(doc)
        if (model === undefined) return
        const all = model.viewpoints().map((v) => v.id)
        if (all.length === 0) return
        const current = binding.scopeForDocument(doc) ?? new Set(all)

        const chosen = await pickViewpoints(dialogs, all, current)
        if (chosen === undefined) return   // cancelled the picker

        const leaving = binding.nodesLeavingScope(doc, chosen)
        if (leaving.length > 0 && !(await confirmRemoval(dialogs, leaving))) return
        await binding.setDocumentScope(doc, chosen)
    }

    // Whether `doc` is an arch-bound board (so a surface can enable/disable its
    // "Edit viewpoints…" affordance).
    public canEdit(doc: IDocument): boolean
    {
        return this.Provider.get(ArchBoardBindingService.Key)?.modelForDocument(doc) !== undefined
    }
}

// Confirm dropping the out-of-scope nodes, listing them by label. Resolves true
// when the user confirms, false on cancel/dismiss.
function confirmRemoval(dialogs: DialogService, leaving: readonly LeavingNode[]): Promise<boolean>
{
    const list = leaving.map((l) => `• ${l.label}`).join('\n')
    const message = `Narrowing the viewpoints will remove ${leaving.length} item(s) from this board:\n\n${list}\n\nThe items stay in the model — only their board nodes are removed. Continue?`
    const model = new ConfirmDialogModel(message, 'Remove', (confirmed) => dialogs.Close(confirmed))
    return dialogs
        .Show<boolean>({ Title: 'Remove out-of-scope items?', Content: model, Width: 380 })
        .then((r) => r === true)
}
