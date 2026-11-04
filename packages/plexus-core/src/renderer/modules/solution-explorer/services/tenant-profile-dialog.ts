import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService, DialogAction, ButtonVariant } from '@pragmatic-tech-ai/mural/framework'
import { StackPanel, Orientation, TextBlock, TextBox } from '@pragmatic-tech-ai/mural/basic'

// Collects the Runtime environment a publish goes to.
export interface ITenantTargetPrompt
{
    // Resolves the entered environment name, or undefined when the maker cancels.
    Prompt(): Promise<string | undefined>;
}

// Interim modal on DialogService (a TextBlock label + one TextBox) asking for the environment name;
// the environment picker replaces it. No server address or token is asked for: the main process
// reaches the environment through the tenant plane relay with the account session.
export class TenantProfileDialog implements ITenantTargetPrompt
{
    private static readonly Title = 'Publish to tenant'
    private static readonly EnvironmentLabel = 'Environment'
    private static readonly CancelLabel = 'Cancel'
    private static readonly PublishLabel = 'Publish'
    private static readonly MissingEnvironment = 'Enter an environment.'
    private static readonly DialogWidth = 420

    constructor(private readonly dialogs: DialogService)
    {
    }

    public Prompt(): Promise<string | undefined>
    {
        const panel = new StackPanel()
        panel.Orientation = Orientation.Vertical
        const caption = new TextBlock()
        caption.Text = TenantProfileDialog.EnvironmentLabel
        const environment = new TextBox()
        panel.AddChild(caption)
        panel.AddChild(environment)
        const error = new TextBlock()
        panel.AddChild(error)
        const ok = new RelayCommand(() =>
        {
            if (environment.Text.trim() === '')
            {
                error.Text = TenantProfileDialog.MissingEnvironment
                return
            }
            this.dialogs.Close(environment.Text.trim())
        })
        return this.dialogs.Show<string>({
            Title: TenantProfileDialog.Title,
            Content: panel,
            Width: TenantProfileDialog.DialogWidth,
            Actions: [
                new DialogAction(TenantProfileDialog.CancelLabel, new RelayCommand(() => this.dialogs.Close(undefined))),
                new DialogAction(TenantProfileDialog.PublishLabel, ok, ButtonVariant.Filled),
            ],
        })
    }
}
