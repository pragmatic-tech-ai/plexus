import {
    ActionStatus, ProjectBuildStatus, Severity,
    type BuildDiagnostic, type IBuildProgress, type ProjectId,
} from '@pragmatic-tech-ai/todl/build-system-core'

// The subset of a background-work task the reporter drives. Both the live TaskHandle and
// the executor's ITaskContext satisfy it structurally (each exposes report()/log()), so a
// job can hand the reporter either, and a unit test can hand it a fake that records calls.
// A real role interface — not a lambda seam-bag — so the reporter owns one named sink.
export interface ITaskProgressSink
{
    report(fraction: number, note?: string): void
    log(line: string): void
}

// Maps a TODL engine build's IBuildProgress callbacks onto a background-work task: each
// project and its actions advance the task fraction, each action start / diagnostic /
// per-project terminal status appends a log line. A real class implementing IBuildProgress
// (never a lambda bag) so the engine can report down into it and it can be tested in
// isolation. The task's OWN terminal status (succeed/fail) is set by the job wrapper from
// the build outcome — this reporter only mirrors progress and narrates the log.
export class BuildProgressReporter implements IBuildProgress
{
    private static readonly NoProgress = 0
    private static readonly Complete = 1
    private static readonly SingleProject = 1
    private static readonly ActionIndent = '  '
    private static readonly DefaultOperation = 'Building'
    private static readonly StartSuffix = '…'
    private static readonly ActionFailedSuffix = ' failed'
    private static readonly WordSeparator = ' '
    private static readonly IdSeparator = '-'
    private static readonly FailedLabel = 'error: '
    private static readonly WarningLabel = 'warning: '
    private static readonly InfoLabel = ''
    private static readonly BuiltStatusText = 'built successfully'
    private static readonly FailedStatusText = 'failed'
    private static readonly SkippedStatusText = 'skipped'
    // Internal build-action ids → plain-language descriptions for the user-facing log.
    // One home for the step wording; an unmapped action falls back to a humanized id.
    private static readonly ActionLabels: Readonly<Record<string, string>> = {
        'resolve-bases':       'Resolving referenced packages',
        'compile-model':       'Compiling the model',
        'compile-mural':       'Compiling views',
        'stamp-resource-keys': 'Assigning resource keys',
        'bake-resources':      'Baking icons and presentation',
        'emit-bundle':         'Bundling the palette',
        'emit-package-layout': 'Writing the package layout',
        'publish-package':     'Publishing to the registry',
        'bundle-app':          'Bundling the app',
        'emit-entry':          'Writing the entry point',
        'emit-bundled-host':   'Writing the host page',
    }

    private readonly sink: ITaskProgressSink
    private readonly operation: string
    private projectsTotal = BuildProgressReporter.SingleProject
    private projectsDone = 0
    private actionsTotal = 0
    private actionsDone = 0

    constructor(sink: ITaskProgressSink, operation: string = BuildProgressReporter.DefaultOperation)
    {
        this.sink = sink
        this.operation = operation
    }

    public SolutionStarted(order: readonly ProjectId[]): void
    {
        this.projectsTotal = order.length
        this.projectsDone = 0
        this.sink.report(BuildProgressReporter.NoProgress)
    }

    public ProjectStarted(id: ProjectId, actions: readonly string[]): void
    {
        this.actionsTotal = actions.length
        this.actionsDone = 0
        const header = `${this.operation}${BuildProgressReporter.WordSeparator}${id}${BuildProgressReporter.StartSuffix}`
        this.sink.log(header)
        this.sink.report(this.Fraction(), header)
    }

    public ActionStarted(_project: ProjectId, action: string): void
    {
        this.sink.log(`${BuildProgressReporter.ActionIndent}${BuildProgressReporter.FriendlyAction(action)}${BuildProgressReporter.StartSuffix}`)
    }

    public ActionFinished(_project: ProjectId, action: string, status: ActionStatus): void
    {
        this.actionsDone += 1
        if (status === ActionStatus.Failed)
        {
            this.sink.log(`${BuildProgressReporter.ActionIndent}${BuildProgressReporter.FriendlyAction(action)}${BuildProgressReporter.ActionFailedSuffix}`)
        }
        this.sink.report(this.Fraction())
    }

    public ProjectFinished(id: ProjectId, status: ProjectBuildStatus): void
    {
        this.projectsDone += 1
        this.actionsTotal = 0
        this.actionsDone = 0
        this.sink.log(`${id}${BuildProgressReporter.WordSeparator}${BuildProgressReporter.FriendlyStatus(status)}`)
        this.sink.report(this.Fraction())
    }

    public Diagnostic(_project: ProjectId, diagnostic: BuildDiagnostic): void
    {
        this.sink.log(`${BuildProgressReporter.LabelFor(diagnostic.severity)}${diagnostic.message}`)
    }

    // Blend the completed-project count with the in-flight project's action progress, so a
    // single-project build (no SolutionStarted) still advances action-by-action and a
    // multi-project build never runs past 1.
    private Fraction(): number
    {
        const total = this.projectsTotal > 0 ? this.projectsTotal : BuildProgressReporter.SingleProject
        const within = this.actionsTotal > 0 ? this.actionsDone / this.actionsTotal : 0
        return Math.min(BuildProgressReporter.Complete, (this.projectsDone + within) / total)
    }

    // A plain-language label for an internal build-action id (see ActionLabels); an
    // unmapped id is humanized ("emit-bundled-host" → "Emit bundled host"), so a new
    // action still reads sensibly rather than leaking its raw id.
    private static FriendlyAction(id: string): string
    {
        const mapped = BuildProgressReporter.ActionLabels[id]
        if (mapped !== undefined) return mapped
        const words = id.split(BuildProgressReporter.IdSeparator)
        const head = words[0] ?? id
        const capitalized = head.charAt(0).toUpperCase() + head.slice(1)
        return [capitalized, ...words.slice(1)].join(BuildProgressReporter.WordSeparator)
    }

    private static FriendlyStatus(status: ProjectBuildStatus): string
    {
        switch (status)
        {
            case ProjectBuildStatus.Built:
                return BuildProgressReporter.BuiltStatusText
            case ProjectBuildStatus.Failed:
                return BuildProgressReporter.FailedStatusText
            default:
                return BuildProgressReporter.SkippedStatusText
        }
    }

    private static LabelFor(severity: Severity): string
    {
        switch (severity)
        {
            case Severity.Error:
                return BuildProgressReporter.FailedLabel
            case Severity.Warning:
                return BuildProgressReporter.WarningLabel
            default:
                return BuildProgressReporter.InfoLabel
        }
    }
}
