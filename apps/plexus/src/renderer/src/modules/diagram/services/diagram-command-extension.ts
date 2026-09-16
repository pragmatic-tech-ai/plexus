import { ServiceKey } from '@pragmatic-tech-ai/mural/runtime'
import type { CommandDefinition, DiagramDocument } from '@pragmatic-tech-ai/mural/framework'

// A seam for app-defined diagram toolbar commands whose behavior lives outside
// mural's built-in DiagramCommandId set. The toolbar dispatches a clicked
// command to the active document's Execute(); PlexusDiagramDocument routes any
// command Id it doesn't recognize through the registered extension (if one
// handles it) before falling back to the base DiagramDocument. This is how an
// app contributes a toolbar command (e.g. the architecture "Edit viewpoints…")
// without a framework change. A no-op seam when nothing is registered.
export interface IDiagramCommandExtension
{
    // Whether this extension owns the given command Id (i.e. the base document
    // wouldn't know how to run it).
    handles(id: string): boolean
    // Run the command against the document (only called when handles(id) is true).
    execute(doc: DiagramDocument, id: string): void
    // Whether the command is currently enabled for the document (gates the
    // toolbar button — e.g. only enabled for an arch-bound diagram).
    canExecute(doc: DiagramDocument, id: string): boolean
}

export const DiagramCommandExtensionKey = new ServiceKey<IDiagramCommandExtension>('DiagramCommandExtension')

// The shape a caller needs from a CommandDefinition — just its Id.
export type { CommandDefinition }
