import { registerNodeSerializer, serializerByType } from '@pragmatic-tech-ai/mural/framework'
import { LabelStyleCodec } from './label-style-codec.js'
import { ArchNodeVM } from './arch-node-vm.js'

// The label-style overrides the user set on a node's title (Format Shape → Text
// page). Each DP is undefined until touched, so an unstyled node serializes to a
// bare `{}` exactly as before — only styled labels carry a `labelStyle` block. The
// DP↔JSON mapping is shared with connector labels via LabelStyleCodec.
function serializeLabelStyle(vm: ArchNodeVM): Record<string, unknown> | undefined {
    return LabelStyleCodec.Serialize({
        fontFamily: vm.LabelFontFamily,
        fontSize: vm.LabelFontSize,
        foreground: vm.LabelForeground,
        fontWeight: vm.LabelFontWeight,
        fontStyle: vm.LabelFontStyle,
        textDecorations: vm.LabelTextDecorations,
        textAlignment: vm.LabelTextAlignment,
    })
}

// Restore the persisted overrides onto the node's Label* DPs (only the fields the
// block actually carried; an absent field leaves the DP untouched at its default).
function applyLabelStyle(vm: ArchNodeVM, data: unknown): void {
    const s = LabelStyleCodec.Deserialize(data)
    if (s.fontFamily !== undefined) vm.LabelFontFamily = s.fontFamily
    if (s.fontSize !== undefined) vm.LabelFontSize = s.fontSize
    if (s.foreground !== undefined) vm.LabelForeground = s.foreground
    if (s.fontWeight !== undefined) vm.LabelFontWeight = s.fontWeight
    if (s.fontStyle !== undefined) vm.LabelFontStyle = s.fontStyle
    if (s.textDecorations !== undefined) vm.LabelTextDecorations = s.textDecorations
    if (s.textAlignment !== undefined) vm.LabelTextAlignment = s.textAlignment
}

// Idempotent — safe to call more than once (production wiring + tests).
export function registerArchNodeSerializer(): void {
    if (serializerByType('arch') !== undefined) return
    registerNodeSerializer({
        type: 'arch',
        matches: (n: unknown) => n instanceof ArchNodeVM,
        // Content-only: an arch node has no persisted content of its own (icon /
        // label re-derive on open from the entity via ArchDiagramBinding). Geometry
        // — position, size, and the userSized latch — rides the document's `visuals`
        // section (the container Figure owns it), not the node record. The one
        // exception is the label's text-style overrides, which are presentation the
        // user set (not derivable from the entity) → persisted as `labelStyle`. The
        // document assigns .Id and applies geometry after construction.
        serialize: (node: unknown): Record<string, unknown> => {
            const labelStyle = serializeLabelStyle(node as ArchNodeVM)
            return labelStyle !== undefined ? { labelStyle } : {}
        },
        deserialize: (data: Record<string, unknown>): ArchNodeVM => {
            const vm = new ArchNodeVM()
            applyLabelStyle(vm, data.labelStyle)
            return vm
        },
    })
}

// Register at module-import time, NOT only when ArchDiagramBindingService is
// constructed. The renderer bootstrap statically imports the binding service
// (hence this module), so this runs at bundle evaluation — before session
// restore or any DiagramDocument.Load(). Without it, a diagram that loads
// before the service is constructed drops every `arch` node, and each of their
// connectors permanently collapses to the diagram origin (its nodeId can no
// longer resolve). Idempotent, so the service ctor's call is a harmless no-op.
registerArchNodeSerializer()
