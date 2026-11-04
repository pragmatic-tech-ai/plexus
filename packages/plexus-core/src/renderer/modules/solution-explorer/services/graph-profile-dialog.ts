import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService, DialogAction, ButtonVariant } from '@pragmatic-tech-ai/mural/framework'
import { StackPanel, Orientation, TextBlock, TextBox } from '@pragmatic-tech-ai/mural/basic'

// Where a contribute goes: a Development environment of the signed-in account and one of its graphs.
export interface GraphTargetInput
{
    Environment: string;
    GraphName: string;
}

// Collects the contribute target.
export interface IGraphTargetPrompt
{
    // Resolves the entered target, or undefined when the maker cancels.
    Prompt(): Promise<GraphTargetInput | undefined>;
}

// Interim modal on DialogService (TextBlock labels + two TextBoxes) asking for the environment and
// graph names; the environment picker replaces it. No server address or token is asked for: the
// main process reaches the environment through the tenant plane relay with the account session.
export class GraphProfileDialog implements IGraphTargetPrompt
{
    private static readonly Title = 'Contribute to graph'
    private static readonly EnvironmentLabel = 'Environment'
    private static readonly GraphLabel = 'Graph name'
    private static readonly CancelLabel = 'Cancel'
    private static readonly ContributeLabel = 'Contribute'
    private static readonly MissingFields = 'Enter an environment and a graph name.'
    private static readonly DialogWidth = 420

    constructor(private readonly dialogs: DialogService)
    {
    }

    public Prompt(): Promise<GraphTargetInput | undefined>
    {
        const panel = new StackPanel()
        panel.Orientation = Orientation.Vertical
        const environment = GraphProfileDialog.Field(panel, GraphProfileDialog.EnvironmentLabel)
        const graph = GraphProfileDialog.Field(panel, GraphProfileDialog.GraphLabel)
        const error = new TextBlock()
        panel.AddChild(error)
        const ok = new RelayCommand(() =>
        {
            if (environment.Text.trim() === '' || graph.Text.trim() === '')
            {
                error.Text = GraphProfileDialog.MissingFields
                return
            }
            this.dialogs.Close({ Environment: environment.Text.trim(), GraphName: graph.Text.trim() } satisfies GraphTargetInput)
        })
        return this.dialogs.Show<GraphTargetInput>({
            Title: GraphProfileDialog.Title,
            Content: panel,
            Width: GraphProfileDialog.DialogWidth,
            Actions: [
                new DialogAction(GraphProfileDialog.CancelLabel, new RelayCommand(() => this.dialogs.Close(undefined))),
                new DialogAction(GraphProfileDialog.ContributeLabel, ok, ButtonVariant.Filled),
            ],
        })
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
