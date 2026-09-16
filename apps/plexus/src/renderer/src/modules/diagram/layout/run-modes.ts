import type { LayoutOutcome, PositionSet } from './diagram-graph-adapter.js'

// How a pipeline run affects the diagram, chosen before running:
//   Positions — write new positions; keep every node (nodes the transforms
//               drop stay where they were, just excluded from the layout
//               computation)
//   Preview   — commit nothing; the service publishes the target arrangement
//               on Diagram.LayoutPreview (the framework overlay renders it) and
//               an explicit Apply commits it
//
// A destructive mode (actually removing dropped nodes) is intentionally out of
// scope: mural exposes no undo/transaction API, so removal could not be made
// reversible. Revisit when it does.
export enum RunMode
{
    Positions = 'positions',
    Preview   = 'preview',
}

export interface DiagramMutation
{
    setPositions: PositionSet[]
}

export interface RunPlan
{
    mutation:    DiagramMutation
    previewOnly: boolean
}

export function planForMode(mode: RunMode, outcome: LayoutOutcome): RunPlan
{
    switch (mode) {
        case RunMode.Positions:
            return { previewOnly: false, mutation: { setPositions: outcome.setPositions } }
        case RunMode.Preview:
            return { previewOnly: true, mutation: { setPositions: [] } }
    }
}
