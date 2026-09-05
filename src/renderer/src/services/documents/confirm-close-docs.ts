import type { DialogService, DocumentsContentHostService } from '@pragmatic-tech-ai/mural/framework'
import { promptSave, SavePromptResult } from '../dialogs/save-prompt-model.js'

// Consolidated unsaved-changes gate for app quit. Returns true when it is safe to
// proceed (no dirty docs, or the user chose Save All / Discard All) and false to
// cancel the quit. `prompt` is injected for testability; production passes the
// promptSave-over-DialogService default. One dialog covers ALL dirty docs (the
// confirmed UX), reworded "Save All" / "Discard All".
export async function confirmCloseDocs(
    host: Pick<DocumentsContentHostService, 'OpenDocuments' | 'SaveAll'>,
    dialogs: DialogService | undefined,
    prompt: (
        dialogs: DialogService | undefined,
        opts: { title: string; message: string; saveLabel: string; dontSaveLabel: string; autoCloseSeconds?: number },
    ) => Promise<SavePromptResult> = (d, o) => promptSave(d, o),
): Promise<boolean>
{
    const dirty = host.OpenDocuments.ToArray().filter((d) => d.IsDirty)
    if (dirty.length === 0) return true
    const message = dirty.length === 1
        ? `"${dirty[0].Title}" has unsaved changes.`
        : `${dirty.length} documents have unsaved changes.`
    // Auto-close after 10s defaulting to Discard All: an unattended quit should
    // proceed rather than hang on the modal indefinitely.
    const choice = await prompt(dialogs, {
        title: 'Unsaved changes', message, saveLabel: 'Save All', dontSaveLabel: 'Discard All',
        autoCloseSeconds: 10,
    })
    if (choice === SavePromptResult.Cancel) return false
    if (choice === SavePromptResult.Save) await host.SaveAll()
    return true
}
