import { MetaData, MuralBase, RelayCommand, type ICommand } from '@pragmatic-tech-ai/mural/runtime'
import type { DialogService } from '@pragmatic-tech-ai/mural/framework'

// A three-way "unsaved changes" prompt view-model. The host shows it through
// DialogService and awaits a SavePromptResult: Save persists then proceeds,
// Don't Save proceeds discarding, Cancel aborts. DialogService resolves
// `undefined` on a scrim/Escape dismiss, which promptSave() maps to Cancel.
// Rendered by DataTemplate[SavePromptModel]; the labels are DPs so the same VM
// serves both tab-close ("Save"/"Don't Save") and quit ("Save All"/"Discard All").
export enum SavePromptResult { Save, DontSave, Cancel }

export class SavePromptModel extends MuralBase
{
    static readonly MessageKey = MuralBase.RegisterProperty<string>(
        SavePromptModel, 'Message', '', MetaData.None)
    static readonly SaveLabelKey = MuralBase.RegisterProperty<string>(
        SavePromptModel, 'SaveLabel', 'Save', MetaData.None)
    static readonly DontSaveLabelKey = MuralBase.RegisterProperty<string>(
        SavePromptModel, 'DontSaveLabel', "Don't Save", MetaData.None)
    static readonly SaveCommandKey = MuralBase.RegisterProperty<ICommand>(
        SavePromptModel, 'SaveCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly DontSaveCommandKey = MuralBase.RegisterProperty<ICommand>(
        SavePromptModel, 'DontSaveCommand', undefined as unknown as ICommand, MetaData.None)
    static readonly CancelCommandKey = MuralBase.RegisterProperty<ICommand>(
        SavePromptModel, 'CancelCommand', undefined as unknown as ICommand, MetaData.None)

    // Live countdown when auto-close is armed (0 = disarmed). The DontSave label
    // carries the countdown so the existing binding renders it — no extra chrome.
    private readonly _baseDontSaveLabel: string
    private _remaining = 0
    private _timer: ReturnType<typeof setInterval> | undefined

    constructor(
        message: string,
        saveLabel: string,
        dontSaveLabel: string,
        private readonly close: (result: SavePromptResult) => void,
        // When set, the prompt auto-chooses DontSave after this many seconds of
        // no user action, counting down on the DontSave button. Used by the quit
        // gate so an unattended quit proceeds (Discard All) rather than hanging.
        autoCloseSeconds?: number,
    )
    {
        super()
        this._baseDontSaveLabel = dontSaveLabel
        this.set_property_value(SavePromptModel.MessageKey, message)
        this.set_property_value(SavePromptModel.SaveLabelKey, saveLabel)
        this.set_property_value(SavePromptModel.DontSaveLabelKey, dontSaveLabel)
        this.set_property_value(SavePromptModel.SaveCommandKey, new RelayCommand(() => this.choose(SavePromptResult.Save)))
        this.set_property_value(SavePromptModel.DontSaveCommandKey, new RelayCommand(() => this.choose(SavePromptResult.DontSave)))
        this.set_property_value(SavePromptModel.CancelCommandKey, new RelayCommand(() => this.choose(SavePromptResult.Cancel)))
        if (autoCloseSeconds !== undefined && autoCloseSeconds > 0) this.startAutoClose(autoCloseSeconds)
    }

    public get Message(): string { return this.get_property_value(SavePromptModel.MessageKey) }
    public get SaveLabel(): string { return this.get_property_value(SavePromptModel.SaveLabelKey) }
    public get DontSaveLabel(): string { return this.get_property_value(SavePromptModel.DontSaveLabelKey) }
    public get SaveCommand(): ICommand { return this.get_property_value(SavePromptModel.SaveCommandKey) }
    public get DontSaveCommand(): ICommand { return this.get_property_value(SavePromptModel.DontSaveCommandKey) }
    public get CancelCommand(): ICommand { return this.get_property_value(SavePromptModel.CancelCommandKey) }

    // Any explicit choice stops the countdown, then resolves the prompt.
    private choose(result: SavePromptResult): void
    {
        this.stopAutoClose()
        this.close(result)
    }

    private startAutoClose(seconds: number): void
    {
        this._remaining = seconds
        this.showCountdown()
        this._timer = setInterval(() =>
        {
            this._remaining -= 1
            if (this._remaining <= 0) { this.choose(SavePromptResult.DontSave); return }
            this.showCountdown()
        }, 1000)
    }

    private showCountdown(): void
    {
        this.set_property_value(SavePromptModel.DontSaveLabelKey, `${this._baseDontSaveLabel} (${this._remaining})`)
    }

    // Clear the countdown timer. Idempotent. Called on any explicit choice and,
    // by promptSave, after the dialog resolves for ANY reason (incl. scrim /
    // Escape dismiss, which never routes through the VM's commands).
    public stopAutoClose(): void
    {
        if (this._timer === undefined) return
        clearInterval(this._timer)
        this._timer = undefined
        this.set_property_value(SavePromptModel.DontSaveLabelKey, this._baseDontSaveLabel)
    }
}

// Show the prompt and resolve a SavePromptResult. With no DialogService
// (headless/tests) or a scrim dismiss, resolves Cancel — the safe default that
// neither loses work nor forces a close.
export async function promptSave(
    dialogs: DialogService | undefined,
    opts: { title: string; message: string; saveLabel?: string; dontSaveLabel?: string; autoCloseSeconds?: number },
): Promise<SavePromptResult>
{
    if (dialogs === undefined) return SavePromptResult.Cancel
    const model = new SavePromptModel(
        opts.message, opts.saveLabel ?? 'Save', opts.dontSaveLabel ?? "Don't Save",
        (r) => dialogs.Close(r), opts.autoCloseSeconds)
    const result = await dialogs.Show<SavePromptResult>({ Title: opts.title, Content: model, Width: 400 })
    // Stop the countdown no matter how the dialog closed — a scrim / Escape
    // dismiss resolves Show without routing through the VM's commands, so the
    // timer would otherwise keep ticking and fire after the dialog is gone.
    model.stopAutoClose()
    return result ?? SavePromptResult.Cancel
}

export default SavePromptModel
