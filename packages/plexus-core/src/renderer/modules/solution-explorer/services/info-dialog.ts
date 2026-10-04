import type { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { ConfirmDialogModel } from '../../../dialogs/confirm-dialog-model.js'

// A brief OK-only information dialog: a ConfirmDialogModel with ShowCancel=false, shown
// through DialogService. The Solution Explorer has no notification/toast/status channel,
// so operation failures surface here.
export class InfoDialog
{
    private static readonly OkLabel = 'OK'
    private static readonly Width = 420

    public static async Show(dialogs: DialogService, title: string, message: string): Promise<void>
    {
        const vm = new ConfirmDialogModel(message, InfoDialog.OkLabel, (r) => dialogs.Close(r), false)
        await dialogs.Show<boolean>({ Title: title, Content: vm, Width: InfoDialog.Width })
    }
}
