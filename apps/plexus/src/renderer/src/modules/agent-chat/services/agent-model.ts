// The model a conversation runs under. Values are the `claude --model` aliases
// (verified against CLI 2.1.139: pass an alias like 'opus'/'sonnet' or a full
// id such as 'claude-sonnet-4-6'). Default is the empty string, which omits the
// flag entirely so the CLI picks the subscription default.
export enum AgentModel
{
    Default = '',
    Opus    = 'opus',
    Sonnet  = 'sonnet',
    Haiku   = 'haiku',
}

// One entry in the composer's model picker: a human label + the alias sent to
// the CLI. `SelectedItem`/`ItemsSource` on the mural ComboBox bind to these.
export interface ModelOption
{
    Label: string
    Value: AgentModel
}

export const DEFAULT_MODELS: ModelOption[] = [
    { Label: 'Default',     Value: AgentModel.Default },
    { Label: 'Opus 4.8',    Value: AgentModel.Opus },
    { Label: 'Sonnet 4.6',  Value: AgentModel.Sonnet },
    { Label: 'Haiku 4.5',   Value: AgentModel.Haiku },
]
