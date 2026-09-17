import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { OpenProject } from '../open-project.js'

// The formats a diagram node can be exported to straight from the tree.
export enum DiagramExportFormat { Svg = 'svg', Pptx = 'pptx' }

// Exports a project's diagram file to disk (headless render + save). The impl
// (app-side) owns the renderer + export pipeline; the explorer just points it at
// the node's path and the chosen format.
export interface IDiagramTreeExport
{
    export(op: OpenProject, path: string, format: DiagramExportFormat): Promise<void>
}

export const DiagramTreeExportKey = new ServiceKey<IDiagramTreeExport>('IDiagramTreeExport')
