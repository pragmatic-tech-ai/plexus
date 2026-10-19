import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService, DialogAction, ButtonVariant } from '@pragmatic-tech-ai/mural/framework'
import { StackPanel, Orientation, TextBlock, TextBox } from '@pragmatic-tech-ai/mural/basic'
import { TenantServerUrl, type TenantProfileInput } from '../../../../shared/tenant-publish-api.js'

// Collects the tenant server URL and admin token for the Configure tenant command.
export interface ITenantProfilePrompt
{
    // Resolves the entered profile, or undefined when the maker cancels.
    Prompt(): Promise<TenantProfileInput | undefined>;
}

// Minimal modal on DialogService (TextBlock labels + two TextBoxes). Mural has no masked
// input control yet, so the token is visible while typed; it is never shown back, logged, or
// retained after the dialog closes. A richer masked dialog is a tracked follow-up Feature.
export class TenantProfileDialog implements ITenantProfilePrompt
{
    private static readonly Title = 'Configure tenant'
    private static readonly UrlLabel = 'Server URL (wss://...)'
    private static readonly TokenLabel = 'Admin token'
    private static readonly CancelLabel = 'Cancel'
    private static readonly SaveLabel = 'Save'
    private static readonly MissingFields = 'Enter both a server URL and an admin token.'
    private static readonly DialogWidth = 420

    constructor(private readonly dialogs: DialogService)
    {
    }

    public async Prompt(): Promise<TenantProfileInput | undefined>
    {
        const panel = new StackPanel()
        panel.Orientation = Orientation.Vertical
        const url = TenantProfileDialog.Field(panel, TenantProfileDialog.UrlLabel)
        const token = TenantProfileDialog.Field(panel, TenantProfileDialog.TokenLabel)
        const error = new TextBlock()
        panel.AddChild(error)
        const save = new RelayCommand(() =>
        {
            if (url.Text.trim() === '' || token.Text === '')
            {
                error.Text = TenantProfileDialog.MissingFields
                return
            }
            try
            {
                const validated = TenantServerUrl.Validate(url.Text)
                this.dialogs.Close({ ServerUrl: validated, Token: token.Text } satisfies TenantProfileInput)
            }
            catch (e)
            {
                error.Text = e instanceof Error ? e.message : String(e)
            }
        })
        const result = await this.dialogs.Show<TenantProfileInput>({
            Title: TenantProfileDialog.Title,
            Content: panel,
            Width: TenantProfileDialog.DialogWidth,
            Actions: [
                new DialogAction(TenantProfileDialog.CancelLabel, new RelayCommand(() => this.dialogs.Close(undefined))),
                new DialogAction(TenantProfileDialog.SaveLabel, save, ButtonVariant.Filled),
            ],
        })
        token.Text = ''
        return result
    }

    private static Field(panel: StackPanel, label: string): TextBox
    {
        const caption = new TextBlock()
        caption.Text = label
        const box = new TextBox()
        panel.AddChild(caption)
        panel.AddChild(box)
        return box
    }
}
