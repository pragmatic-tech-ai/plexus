import { RelayCommand } from '@pragmatic-tech-ai/mural/runtime'
import { DialogService, DialogAction, ButtonVariant } from '@pragmatic-tech-ai/mural/framework'
import { StackPanel, Orientation, TextBlock, TextBox } from '@pragmatic-tech-ai/mural/basic'

// The server URL, target graph name, and maker token the Configure/Contribute graph commands
// collect. The token is write-only: it goes straight to IGraphContributor.SetProfile and is
// never echoed back, logged, or retained.
export interface GraphProfileInput
{
    ServerUrl: string;
    GraphName: string;
    Token: string;
}

// Collects the graph server URL, target graph name, and maker token for the graph commands.
export interface IGraphProfilePrompt
{
    // Resolves the entered profile, or undefined when the maker cancels.
    Prompt(): Promise<GraphProfileInput | undefined>;
    // Graph name only, for repeat contributes once the server URL + token are stored. Resolves
    // undefined when the maker cancels.
    PromptGraphName(): Promise<string | undefined>;
}

// Minimal modal on DialogService (TextBlock labels + three TextBoxes). Mural has no masked
// input control yet, so the token is visible while typed; it is never shown back, logged, or
// retained after the dialog closes. A richer masked dialog is a tracked follow-up Feature.
// Validation is non-empty only — the authoritative wss/loopback check runs main-side on
// SetProfile (GraphServerUrl lives in apps/plexus and is unreachable from plexus-core).
export class GraphProfileDialog implements IGraphProfilePrompt
{
    private static readonly Title = 'Configure graph server'
    private static readonly UrlLabel = 'Server URL (wss://...)'
    private static readonly GraphLabel = 'Graph name'
    private static readonly TokenLabel = 'Maker token'
    private static readonly GraphNameTitle = 'Contribute to graph'
    private static readonly MissingGraph = 'Enter a graph name.'
    private static readonly CancelLabel = 'Cancel'
    private static readonly SaveLabel = 'Save'
    private static readonly MissingFields = 'Enter a server URL, a graph name, and a maker token.'
    private static readonly DialogWidth = 420

    constructor(private readonly dialogs: DialogService)
    {
    }

    public async Prompt(): Promise<GraphProfileInput | undefined>
    {
        const panel = new StackPanel()
        panel.Orientation = Orientation.Vertical
        const url = GraphProfileDialog.Field(panel, GraphProfileDialog.UrlLabel)
        const graph = GraphProfileDialog.Field(panel, GraphProfileDialog.GraphLabel)
        const token = GraphProfileDialog.Field(panel, GraphProfileDialog.TokenLabel)
        const error = new TextBlock()
        panel.AddChild(error)
        const save = new RelayCommand(() =>
        {
            if (url.Text.trim() === '' || graph.Text.trim() === '' || token.Text.trim() === '')
            {
                error.Text = GraphProfileDialog.MissingFields
                return
            }
            this.dialogs.Close({ ServerUrl: url.Text, GraphName: graph.Text, Token: token.Text } satisfies GraphProfileInput)
        })
        const result = await this.dialogs.Show<GraphProfileInput>({
            Title: GraphProfileDialog.Title,
            Content: panel,
            Width: GraphProfileDialog.DialogWidth,
            Actions: [
                new DialogAction(GraphProfileDialog.CancelLabel, new RelayCommand(() => this.dialogs.Close(undefined))),
                new DialogAction(GraphProfileDialog.SaveLabel, save, ButtonVariant.Filled),
            ],
        })
        token.Text = ''
        return result
    }

    public async PromptGraphName(): Promise<string | undefined>
    {
        const panel = new StackPanel()
        panel.Orientation = Orientation.Vertical
        const graph = GraphProfileDialog.Field(panel, GraphProfileDialog.GraphLabel)
        const error = new TextBlock()
        panel.AddChild(error)
        const save = new RelayCommand(() =>
        {
            if (graph.Text.trim() === '')
            {
                error.Text = GraphProfileDialog.MissingGraph
                return
            }
            this.dialogs.Close(graph.Text)
        })
        return this.dialogs.Show<string>({
            Title: GraphProfileDialog.GraphNameTitle,
            Content: panel,
            Width: GraphProfileDialog.DialogWidth,
            Actions: [
                new DialogAction(GraphProfileDialog.CancelLabel, new RelayCommand(() => this.dialogs.Close(undefined))),
                new DialogAction(GraphProfileDialog.SaveLabel, save, ButtonVariant.Filled),
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
