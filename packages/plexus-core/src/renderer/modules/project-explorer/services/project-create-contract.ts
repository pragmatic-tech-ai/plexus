// The project-creation contract the explorer's agent-driven create path consumes:
// prefill for the New Project pickers, and the outcome it returns. Mirrors the app
// agent's MCP shapes (apps/plexus shared/agent-api) structurally, so an app-typed
// prefill/result passes here without any core→app import.
export interface PrefillBaseRef { id: string; version: string }

export interface CreateProjectPrefill
{
    name?:      string
    type?:      string
    location?:  string
    metaModel?: PrefillBaseRef
    libraries?: readonly PrefillBaseRef[]
}

export interface CreateProjectResult
{
    id:         string
    created:    boolean
    cancelled?: boolean
    folder?:    string
    name?:      string
    type?:      string
    error?:     string
}
