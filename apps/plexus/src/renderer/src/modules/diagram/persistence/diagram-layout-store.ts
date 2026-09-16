import type { DiagramDocument } from '@pragmatic-tech-ai/mural/framework'
import type { PipelineConfiguration } from '@pragmatic-tech-ai/fresco'

// Per-diagram layout persistence, stored in the document's opaque metadata
// (DiagramDocument.Metadata) so it travels with the .diagram file and restores
// on open. Mirrors diagram-camera-store.ts. Two independent slots:
//   * layout.config  — the diagram's CURRENT working pipeline config (the
//     implicit, unnamed autosave: the inspector hydrates from it on open and
//     writes it back on every edit).
//   * layout.presets — the diagram-SCOPED named presets ({ name -> config }),
//     one of the three preset scopes (see preset-scope.ts).
// mural never reads either key.
export const DIAGRAM_LAYOUT_CONFIG_KEY  = 'layout.config'
export const DIAGRAM_LAYOUT_PRESETS_KEY = 'layout.presets'

// Shape-guard for a stored PipelineConfiguration: a string name, an array of
// transforms, and an object layout. Fresco validates the interior when the
// pipeline is built; this only rejects obvious garbage from a hand-edited file.
export function isPipelineConfiguration(v: unknown): v is PipelineConfiguration
{
    if (typeof v !== 'object' || v === null) return false
    const r = v as Record<string, unknown>
    return typeof r.name === 'string' && Array.isArray(r.transforms) && typeof r.layout === 'object' && r.layout !== null
}

// ── working config (implicit per-diagram autosave) ──────────────────────────

// The working config recorded on the document, or undefined when none is set
// (or the stored value is malformed). Undefined lets the caller keep the
// default config.
export function readLayoutConfig(doc: DiagramDocument): PipelineConfiguration | undefined
{
    const raw = doc.Metadata[DIAGRAM_LAYOUT_CONFIG_KEY]
    return isPipelineConfiguration(raw) ? structuredClone(raw) : undefined
}

// Merge the working config into the document metadata, preserving other keys.
// Clones so later in-place edits of the live config don't mutate the stored
// copy. The caller persists by saving the document.
export function writeLayoutConfig(doc: DiagramDocument, cfg: PipelineConfiguration): void
{
    doc.Metadata = { ...doc.Metadata, [DIAGRAM_LAYOUT_CONFIG_KEY]: structuredClone(cfg) }
}

// ── diagram-scoped named presets ({ name -> config }) ───────────────────────

function readPresetMap(doc: DiagramDocument): Record<string, PipelineConfiguration>
{
    const raw = doc.Metadata[DIAGRAM_LAYOUT_PRESETS_KEY]
    if (typeof raw !== 'object' || raw === null) return {}
    const out: Record<string, PipelineConfiguration> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isPipelineConfiguration(v)) out[k] = v
    return out
}

// The diagram-scoped preset names (sorted).
export function diagramPresetNames(doc: DiagramDocument): string[]
{
    return Object.keys(readPresetMap(doc)).sort()
}

// The diagram-scoped preset by name (a clone), or undefined if absent.
export function getDiagramPreset(doc: DiagramDocument, name: string): PipelineConfiguration | undefined
{
    const cfg = readPresetMap(doc)[name]
    return cfg === undefined ? undefined : structuredClone(cfg)
}

// Store a diagram-scoped preset under `name` (a clone), preserving the others.
// The caller persists by saving the document.
export function saveDiagramPreset(doc: DiagramDocument, name: string, cfg: PipelineConfiguration): void
{
    const map = { ...readPresetMap(doc), [name]: structuredClone(cfg) }
    doc.Metadata = { ...doc.Metadata, [DIAGRAM_LAYOUT_PRESETS_KEY]: map }
}

// Remove a diagram-scoped preset; tolerates its absence. The caller persists by
// saving the document.
export function deleteDiagramPreset(doc: DiagramDocument, name: string): void
{
    const map = readPresetMap(doc)
    if (!(name in map)) return
    delete map[name]
    doc.Metadata = { ...doc.Metadata, [DIAGRAM_LAYOUT_PRESETS_KEY]: map }
}
