import type { DialogService } from '@pragmatic-tech-ai/mural/framework'
import { ConfirmDialogModel } from '@pragmatic-tech-ai/plexus-core/renderer/dialogs/confirm-dialog-model.js'
import type { ConceptGenerationResult } from '@pragmatic-tech-ai/todl'

// Tells the maker what a Generate UI run did.
export interface IGenerationReporter
{
    Report(concept: string, result: ConceptGenerationResult): Promise<void>
    ReportFailure(concept: string, error: unknown): Promise<void>
}

export class DialogGenerationReporter implements IGenerationReporter
{
    private static readonly Title = 'Generate UI'
    private static readonly OkLabel = 'OK'
    private static readonly Width = 520
    private static readonly Newline = '\n'
    private static readonly BulletPrefix = '  - '
    private static readonly WrittenHeader = ' file(s) written:'
    private static readonly SkippedHeader = ' file(s) skipped:'
    private static readonly SummaryPrefix = 'Generated UI for '
    private static readonly NothingWritten = 'No files were written.'
    private static readonly FailurePrefix = 'Generate UI failed for '
    private static readonly FailureSeparator = ': '

    public constructor(private readonly dialogs: DialogService) {}

    // Plain-text summary: the written paths, the skipped paths, then any maker-facing
    // messages (e.g. the hand-edited-app-root guidance).
    public static Format(concept: string, result: ConceptGenerationResult): string
    {
        const lines: string[] = [`${DialogGenerationReporter.SummaryPrefix}${concept}`]
        if (result.Written.length === 0) lines.push(DialogGenerationReporter.NothingWritten)
        else DialogGenerationReporter.AddSection(lines, result.Written, DialogGenerationReporter.WrittenHeader)
        if (result.Skipped.length > 0) DialogGenerationReporter.AddSection(lines, result.Skipped, DialogGenerationReporter.SkippedHeader)
        for (const message of result.Messages) lines.push(message)
        return lines.join(DialogGenerationReporter.Newline)
    }

    private static AddSection(lines: string[], paths: readonly string[], header: string): void
    {
        lines.push(`${paths.length}${header}`)
        for (const path of paths) lines.push(`${DialogGenerationReporter.BulletPrefix}${path}`)
    }

    public Report(concept: string, result: ConceptGenerationResult): Promise<void>
    {
        return this.Show(DialogGenerationReporter.Format(concept, result))
    }

    public ReportFailure(concept: string, error: unknown): Promise<void>
    {
        const detail = error instanceof Error ? error.message : String(error)
        return this.Show(`${DialogGenerationReporter.FailurePrefix}${concept}${DialogGenerationReporter.FailureSeparator}${detail}`)
    }

    private async Show(message: string): Promise<void>
    {
        const vm = new ConfirmDialogModel(message, DialogGenerationReporter.OkLabel, (r) => this.dialogs.Close(r), false)
        await this.dialogs.Show<boolean>({ Title: DialogGenerationReporter.Title, Content: vm, Width: DialogGenerationReporter.Width })
    }
}
