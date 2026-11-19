import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { OpenProject } from '../open-project.js'

// The formats a board node can be exported to straight from the tree.
export enum BoardExportFormat { Svg = 'svg', Pptx = 'pptx' }

// Exports a project's board file to disk (headless render + save). The impl
// (app-side) owns the renderer + export pipeline; the explorer just points it at
// the node's path and the chosen format.
export interface IBoardTreeExport
{
    Export(op: OpenProject, path: string, format: BoardExportFormat): Promise<void>
}

export const BoardTreeExportKey = new ServiceKey<IBoardTreeExport>('IBoardTreeExport')
