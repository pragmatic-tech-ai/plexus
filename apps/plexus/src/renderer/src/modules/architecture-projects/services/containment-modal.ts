import { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { ConfirmDialogModel } from '../../../services/dialogs/confirm-dialog-model.js'

// The "illegal containment" rejection modal, shared by the drop-into-container
// (ArchInstanceDropFactory) and drag-into-container (ArchDiagramBinding.handleReparent)
// paths so both explain a refused nest identically. Informational — a single OK
// button (the confirm command); the caller has already refused / reverted the nest.
// No-op when there is no DialogService (headless / tests).
export function showContainmentRejected(dialogs: DialogService | undefined, childLabel: string, parentLabel: string): void
{
    if (dialogs === undefined) return
    const message = `Can't place "${childLabel}" in "${parentLabel}" — the meta-model defines no containment relation between them.`
    const vm = new ConfirmDialogModel(message, 'OK', () => dialogs.Close(true))
    void dialogs.Show<boolean>({ Title: 'Cannot nest here', Content: vm, Width: 420 })
}
