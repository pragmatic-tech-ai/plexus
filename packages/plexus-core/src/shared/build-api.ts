// Build wire contract — todl build execution runs in the Electron main process;
// this is the IPC seam both sides import.
//   • main     — registers handlers for Run / Applicable and emits Progress
//   • preload  — exposes IBuildServerApi on window.api
//   • renderer — the build client calls Run / Applicable and subscribes to progress
// Plain types only: no engine import, so the contract stays layer-free.

export enum BuildChannel
{
    Run        = 'build:run',
    Applicable = 'build:applicable',
    Progress   = 'build:progress',
}

export enum BuildProgressKind
{
    SolutionStarted = 'solution-started',
    ProjectStarted  = 'project-started',
    ActionStarted   = 'action-started',
    ActionFinished  = 'action-finished',
    ProjectFinished = 'project-finished',
    Diagnostic      = 'diagnostic',
}

export interface BuildRunRequest
{
    runId:       string
    projectRoot: string
    systemId:    string
    flavorId?:   string
    options?:    { OutputRootOverride?: string }
}

// Mirrors the engine BuildDiagnostic, kept local so the contract has no engine import.
export interface BuildDiagnosticDto
{
    severity: string
    message:  string
    source?:  string
}

export interface BuildRunResult
{
    Ok:           boolean
    OutputPath?:  string
    Diagnostics:  readonly BuildDiagnosticDto[]
}

export interface BuildApplicable
{
    systemId:   string
    systemName: string
    flavorId:   string
    flavorName: string
}

export interface BuildProgressEvent
{
    runId: string
    kind:  BuildProgressKind
    args:  readonly unknown[]
}

export interface IBuildServerApi
{
    Run(req: BuildRunRequest): Promise<BuildRunResult>
    Applicable(manifestJson: string): Promise<readonly BuildApplicable[]>
    OnProgress(cb: (e: BuildProgressEvent) => void): () => void
}
