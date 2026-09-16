// toolbox-projection.ts — pure: a loaded model.json → the taxonomies an author
// marked visible for the toolbox, each with its visible terms. No I/O, no mural.
//
// Authoring contract (annotation is author-declared: `annotation toolbox {
// visible : boolean; }`): a taxonomy appears ONLY if it carries
// `annotate toolbox { visible = true }`; a term is shown UNLESS it carries
// `annotate toolbox { visible = false }`.
import { projectAnnotations, type TodlDocument, type JsonNode } from '@pragmatic-tech-ai/todl'

import { resolveFacets } from './presentation-generator.js'
import { termsOf } from './meta-model-tree-builder.js'

// One draggable term on a toolbox page. `concept` is what the drop resolver keys
// on; `icon`/`label` drive the tile visual.
export interface ToolboxTermRef { id: string; label: string; icon?: string; concept: string }

// One toolbox page: a visible taxonomy and its visible terms, in model order.
export interface ToolboxTaxonomy { id: string; label: string; terms: ToolboxTermRef[] }

// The `visible` boolean of a node's `toolbox` annotation, or undefined when the
// node carries no `toolbox` annotation.
function toolboxVisible(doc: TodlDocument, id: string): boolean | undefined
{
    const v = projectAnnotations(doc, id)['toolbox']?.['visible']
    return typeof v === 'boolean' ? v : undefined
}

// A term node's concept: its `instanceOf` when present, else its `typeOf`.
function conceptOf(t: JsonNode): string
{
    const io = (t as unknown as { instanceOf?: string }).instanceOf
    return typeof io === 'string' ? io : t.typeOf
}

export function projectToolbox(doc: TodlDocument): ToolboxTaxonomy[]
{
    const out: ToolboxTaxonomy[] = []
    for (const n of doc.nodes) {
        if (n.tier !== 'Ontology' || n.typeOf !== 'taxonomy') continue
        if (toolboxVisible(doc, n.id) !== true) continue                   // taxonomy: opt-in
        const facets = resolveFacets(n, projectAnnotations(doc, n.id))
        const terms: ToolboxTermRef[] = []
        for (const t of termsOf(doc, n.id)) {
            if (toolboxVisible(doc, t.id) === false) continue              // term: opt-out
            const f = resolveFacets(t, projectAnnotations(doc, t.id))
            terms.push({ id: t.id, label: f.label, icon: f.icon, concept: conceptOf(t) })
        }
        out.push({ id: n.id, label: facets.label, terms })
    }
    return out
}
