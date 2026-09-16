import {
    MetaData,
    MuralBase,
    RelayCommand,
    type ICommand,
} from '@pragmatic-tech-ai/mural/runtime'

// A reusable yes/no confirmation dialog view-model. The host shows it through
// DialogService and awaits a boolean: ConfirmCommand closes `true`, CancelCommand
// closes `false` (and DialogService resolves `undefined` on a scrim dismiss, which
// callers treat as "not confirmed"). Rendered by DataTemplate[ConfirmDialogModel].
//
// Deliberately generic — it carries only a message and the confirm-button label,
// so any destructive action (delete, discard, overwrite) can reuse it. The
// DialogService supplies the title/surface; the caller passes the confirm label
// so the primary button reads as the action ("Delete", "Discard", …).
export class ConfirmDialogModel extends MuralBase
{
    static readonly MessageKey = MuralBase.RegisterProperty<string>(
        ConfirmDialogModel, 'Message', '', MetaData.None)
    static readonly ConfirmLabelKey = MuralBase.RegisterProperty<string>(
        ConfirmDialogModel, 'ConfirmLabel', 'OK', MetaData.None)
    static readonly ConfirmCommandKey = MuralBase.RegisterProperty<ICommand>(
        ConfirmDialogModel, 'ConfirmCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly CancelCommandKey = MuralBase.RegisterProperty<ICommand>(
        ConfirmDialogModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    constructor(
        message: string,
        confirmLabel: string,
        private readonly close: (confirmed: boolean) => void,
    )
    {
        super()
        this.set_property_value(ConfirmDialogModel.MessageKey, message)
        this.set_property_value(ConfirmDialogModel.ConfirmLabelKey, confirmLabel)
        this.set_property_value(ConfirmDialogModel.ConfirmCommandKey, new RelayCommand(() => this.close(true)))
        this.set_property_value(ConfirmDialogModel.CancelCommandKey, new RelayCommand(() => this.close(false)))
    }

    public get Message(): string { return this.get_property_value(ConfirmDialogModel.MessageKey) }
    public get ConfirmLabel(): string { return this.get_property_value(ConfirmDialogModel.ConfirmLabelKey) }
    public get ConfirmCommand(): ICommand { return this.get_property_value(ConfirmDialogModel.ConfirmCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(ConfirmDialogModel.CancelCommandKey) }
}
