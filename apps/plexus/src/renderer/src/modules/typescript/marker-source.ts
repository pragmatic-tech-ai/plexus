import * as monaco from 'monaco-editor'
import type { IDisposable } from '@pragmatic-tech-ai/mural/runtime'

export interface MarkerRecord
{
    Uri: string
    Severity: number
    Message: string
    StartLine: number
    StartColumn: number
    EndLine: number
    EndColumn: number
}

// A seam over Monaco's marker service so the diagnostics bridge is testable headless.
export interface IMarkerSource
{
    OnDidChange(listener: () => void): IDisposable
    All(): readonly MarkerRecord[]
}

export class MonacoMarkerSource implements IMarkerSource
{
    public OnDidChange(listener: () => void): IDisposable
    {
        return monaco.editor.onDidChangeMarkers(() => listener())
    }

    public All(): readonly MarkerRecord[]
    {
        return monaco.editor.getModelMarkers({}).map((m) => ({
            Uri: m.resource.toString(),
            Severity: m.severity,
            Message: m.message,
            StartLine: m.startLineNumber,
            StartColumn: m.startColumn,
            EndLine: m.endLineNumber,
            EndColumn: m.endColumn,
        }))
    }
}
