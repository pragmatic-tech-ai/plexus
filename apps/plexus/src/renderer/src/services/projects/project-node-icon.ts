// project-node-icon.ts — the project explorer's small glyph converters.
//
// The project tree renders declaratively (a HierarchicalDataTemplate over
// ProjectNode.Children — see project-explorer.resources.mu). Two bits are
// data-driven glyphs a template can't express as a static resource, so each
// flows through a value converter: the per-kind node icon (`$Kind <<
// KindToGeometry`) and the project header's expand/collapse chevron
// (`$IsExpanded << ExpandedToChevron`).
import { Application, Visibility, type ValueConverter } from '@pragmatic-tech-ai/mural/runtime'

import type { ProjectNodeKind } from './project.js'

// The leading glyph resource key for a node kind (registered in plexus-icons.mu).
// 'folder' reuses the command-bar @Folder; each file kind has its own glyph; an
// unrecognised kind falls back to the generic file glyph.
export function iconKeyForKind(kind: ProjectNodeKind): string
{
    switch (kind) {
        case 'folder': return 'Folder'
        case 'diagram': return 'Diagram'
        case 'todl': return 'Todl'
        default: return 'File'
    }
}

// Resolves a node's Kind to its themed leading geometry. Geometries are
// theme-agnostic (registered once in PlexusIcons), so a one-shot resolve is
// stable across scheme switches — the Shape's Fill carries the reactive theme
// brush. Returns undefined only if the resource dictionary isn't mounted yet,
// in which case the Shape paints nothing (same as an unresolved glyph).
//
// Memoised by glyph key: this converter runs once per tree ROW, and the project
// tree can be thousands of rows, so resolving the same handful of kind glyphs
// out of the resource dictionary on every row was a top CPU cost
// (ResourceDictionary.Resolve in the navigation profile). The resolved geometry
// is stable, so the dictionary walk happens at most once per kind. A
// not-yet-mounted resolve (undefined) is NOT cached, so it retries once the
// dictionary is up.
const geometryByKey = new Map<string, unknown>()

/** @internal test-only — clears the memo so a test can assert resolve counts. */
export function __resetKindGeometryCache(): void { geometryByKey.clear() }

export const KindToGeometry: ValueConverter = {
    convert: (kind: unknown) => {
        const key = iconKeyForKind(kind as ProjectNodeKind)
        const cached = geometryByKey.get(key)
        if (cached !== undefined) return cached
        const geom = Application.current?.Resources.Resolve(key)
        if (geom !== undefined) geometryByKey.set(key, geom)
        return geom
    },
}

// Maps a project header's IsExpanded flag to its twisty glyph — down when
// expanded, right when collapsed — using the theme's shared Chevron* geometries
// (the same ones the TreeView rows paint).
export const ExpandedToChevron: ValueConverter = {
    convert: (expanded: unknown) =>
        Application.current?.Resources.Resolve(expanded ? 'ChevronDown' : 'ChevronRight'),
}

// The row label's visibility given the node's IsEditing flag — the inverse of
// the framework's ToVisibility: the static label hides while the rename editor
// (bound with ToVisibility) is shown, and vice-versa.
export const EditingToLabelVisibility: ValueConverter = {
    convert: (editing: unknown) => (editing ? Visibility.Collapsed : Visibility.Visible),
}
