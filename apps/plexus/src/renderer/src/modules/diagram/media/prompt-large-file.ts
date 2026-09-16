import type { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { ConfirmDialogModel } from '../../../services/dialogs/confirm-dialog-model.js'
import { LargeFileChoice } from './media-storage.js'

// Build the large-file Embed/Link prompt. Reuses the shared two-button confirm
// dialog: Confirm ("Embed a copy") → Embed a copy into the project's media/
// folder; Cancel or scrim-dismiss → Link to the original file in place. With no
// DialogService (headless / tests) it defaults to Embed so the pipeline still
// produces a self-contained project.
export function makeLargeFilePrompt(
    dialogs: DialogService | undefined,
): (name: string) => Promise<LargeFileChoice>
{
    return async (name: string): Promise<LargeFileChoice> => {
        if (dialogs === undefined) return LargeFileChoice.Embed
        const message =
            `"${name}" is over 1 MB. Embed a copy in the project, or Cancel to link to the original file instead.`
        const vm = new ConfirmDialogModel(message, 'Embed a copy', (confirmed) => dialogs.Close(confirmed))
        const result = await dialogs.Show<boolean>({ Title: 'Large file', Content: vm, Width: 440 })
        return result === true ? LargeFileChoice.Embed : LargeFileChoice.Link
    }
}
