import { Connector, type ConnectorEndpoint, type DiagramDocument, DiagramSettings, PortSide, ShapeText } from '@pragmatic-tech-ai/mural/framework'
import { Panel, Point, PropertyValueSource } from '@pragmatic-tech-ai/mural/runtime'
import { Brush, FontFamily, SolidColorBrush } from '@pragmatic-tech-ai/mural/visual-engine'
import { LabelStyleCodec, type LabelStyle } from './label-style-codec.js'

// Bug 1: an architecture connector is MODEL-DERIVED (IsDerived), so mural's
// .diagram serializer skips it — the model stores only from/to, with nowhere for
// the connector's PRESENTATION (pinned route waypoints, routing mode, pinned port
// sides) to live. Result: a manual route/port choice was lost on reopen because
// the connector re-derived with default routing.
//
// We persist that presentation in the document's opaque Metadata (the same
// travels-with-the-.diagram mechanism scenarios/viewpoints use), keyed by the
// connector's stable model EDGE KEY, and re-apply it when the binding projects the
// connector. Only user-meaningful bits are stored: PINNED (userAltered) waypoints,
// an explicit routing mode, and pinned port sides/indices — router-derived values
// (undefined) are left out so the router still owns the auto layout.
export const ARCH_CONNECTOR_VISUALS_KEY = 'arch.connectorVisuals'

interface EndpointVisual { portSide?: PortSide; portIndex?: number }

// A connector LABEL's persisted presentation: its position along the connector
// (LabelPosition), a free-drag offset + rotation of the label block (ShapeText
// Offset/Angle), and the text-style overrides (font/color/weight/…). Like the
// connector itself, the label is model-derived, so none of this survives in the
// .diagram serialize — it rides here instead. Every field is optional; only the
// bits the user actually changed are stored.
export interface ConnectorLabelVisual
{
    position?: number
    offsetX?: number
    offsetY?: number
    angle?: number
    style?: Record<string, unknown>
}

export interface ConnectorVisual
{
    waypoints?: Array<{ x: number; y: number; userAltered: boolean }>
    routingMode?: string
    source?: EndpointVisual
    target?: EndpointVisual
    label?: ConnectorLabelVisual
    // Paint z-order (Panel.ZIndex). Omitted when at the connector's behind-figures
    // default (Connector.DefaultZIndex) so an un-reordered connector serializes
    // nothing. A reorder command renumbers the unified figure+connector stack to
    // 0..n-1, so a reordered connector always stores a concrete (>= 0) value.
    zIndex?: number
}

// The full edgeKey → visual map recorded on the document ({} when absent/invalid).
export function readConnectorVisuals(doc: DiagramDocument): Record<string, ConnectorVisual>
{
    const raw = doc.Metadata[ARCH_CONNECTOR_VISUALS_KEY]
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, ConnectorVisual>
        : {}
}

// Merge one connector's visual into the document metadata (or drop the key when
// the visual carries nothing user-meaningful). The caller persists by saving the
// document — this only updates the in-memory bag that the .diagram serializer reads.
export function writeConnectorVisual(doc: DiagramDocument, key: string, v: ConnectorVisual): void
{
    const all = { ...readConnectorVisuals(doc) }
    if (isEmptyVisual(v)) delete all[key]
    else all[key] = v
    doc.Metadata = { ...doc.Metadata, [ARCH_CONNECTOR_VISUALS_KEY]: all }
}

function endpointEmpty(e: EndpointVisual | undefined): boolean
{
    return e === undefined || (e.portSide === undefined && e.portIndex === undefined)
}
function labelEmpty(l: ConnectorLabelVisual | undefined): boolean
{
    return l === undefined
        || (l.style === undefined && l.position === undefined
            && l.offsetX === undefined && l.offsetY === undefined && l.angle === undefined)
}
function isEmptyVisual(v: ConnectorVisual): boolean
{
    return (v.waypoints === undefined || v.waypoints.length === 0)
        && v.routingMode === undefined
        && endpointEmpty(v.source) && endpointEmpty(v.target)
        && labelEmpty(v.label)
        && v.zIndex === undefined
}

// True when the DP holds an explicit (user/restore-set) value rather than its
// registered default — the only reliable way to tell a touched ShapeText style /
// LabelPosition from an untouched one, since those DPs default to real values (0,
// Normal, …) not undefined. Capturing on this predicate keeps an unstyled label out
// of the metadata entirely.
function isSet(owner: Connector | ShapeText, key: Parameters<Connector['GetValueSource']>[0]): boolean
{
    return owner.GetValueSource(key) !== PropertyValueSource.Default
}

// FontSize and Foreground can't use the isSet() default-source test: ShapeText's
// constructor writes both as LOCAL values (DiagramSettings.TextDefaultFontSize /
// ShapeLabelInk), so every label reads as "set". Diff against that same baseline
// instead — a value equal to the default is not a user override worth storing.
function foregroundOverride(t: ShapeText): Brush | undefined
{
    const fg = t.Foreground
    if (fg === undefined) return undefined
    const base = DiagramSettings.ShapeLabelInk()
    if (fg instanceof SolidColorBrush && fg.Color.ToHex() === base.Color.ToHex()) return undefined
    return fg
}

// Read a connector's CURRENT label presentation (only the explicitly-set bits).
function captureConnectorLabel(c: Connector): ConnectorLabelVisual | undefined
{
    const t = c.Text
    const style: LabelStyle = {}
    if (isSet(t, ShapeText.FontFamilyKey)) {
        const f = t.FontFamily
        style.fontFamily = f instanceof FontFamily ? f.Source : (typeof f === 'string' ? f : undefined)
    }
    if (t.FontSize !== DiagramSettings.TextDefaultFontSize()) style.fontSize = t.FontSize
    const fg = foregroundOverride(t); if (fg !== undefined) style.foreground = fg
    if (isSet(t, ShapeText.FontWeightKey)) style.fontWeight = t.FontWeight
    if (isSet(t, ShapeText.FontStyleKey)) style.fontStyle = t.FontStyle
    if (isSet(t, ShapeText.TextDecorationsKey)) style.textDecorations = t.TextDecorations
    if (isSet(t, ShapeText.TextAlignmentKey)) style.textAlignment = t.TextAlignment

    const out: ConnectorLabelVisual = {}
    const serialized = LabelStyleCodec.Serialize(style)
    if (serialized !== undefined) out.style = serialized
    if (isSet(c, Connector.LabelPositionKey)) out.position = c.LabelPosition
    if (isSet(t, ShapeText.OffsetKey)) { out.offsetX = t.Offset.X; out.offsetY = t.Offset.Y }
    if (isSet(t, ShapeText.AngleKey)) out.angle = t.Angle
    return labelEmpty(out) ? undefined : out
}

// Apply a saved label presentation onto a freshly-projected connector's ShapeText.
function applyConnectorLabel(c: Connector, l: ConnectorLabelVisual): void
{
    const t = c.Text
    if (l.style !== undefined) {
        const s = LabelStyleCodec.Deserialize(l.style)
        if (s.fontFamily !== undefined) t.FontFamily = s.fontFamily
        if (s.fontSize !== undefined) t.FontSize = s.fontSize
        if (s.foreground !== undefined) t.Foreground = s.foreground
        if (s.fontWeight !== undefined) t.FontWeight = s.fontWeight
        if (s.fontStyle !== undefined) t.FontStyle = s.fontStyle
        if (s.textDecorations !== undefined) t.TextDecorations = s.textDecorations
        if (s.textAlignment !== undefined) t.TextAlignment = s.textAlignment
    }
    if (l.position !== undefined) c.LabelPosition = l.position
    if (l.offsetX !== undefined && l.offsetY !== undefined) t.Offset = new Point(l.offsetX, l.offsetY)
    if (l.angle !== undefined) t.Angle = l.angle
}

// Read a connector's CURRENT presentation into a ConnectorVisual — only pinned
// waypoints and pinned port sides (router-derived state is omitted).
export function captureConnectorVisual(c: Connector): ConnectorVisual
{
    const wps = (c.Waypoints ?? [])
        .filter((w) => w.userAltered)
        .map((w) => ({ x: w.point.X, y: w.point.Y, userAltered: true }))
    const ep = (e: ConnectorEndpoint | undefined): EndpointVisual | undefined => {
        if (e === undefined) return undefined
        const out: EndpointVisual = {}
        if (e.PortSide !== undefined) out.portSide = e.PortSide
        if (e.PortIndex !== undefined) out.portIndex = e.PortIndex
        return endpointEmpty(out) ? undefined : out
    }
    const v: ConnectorVisual = {}
    if (wps.length > 0) v.waypoints = wps
    if (c.RoutingMode !== undefined && c.RoutingMode !== '') v.routingMode = c.RoutingMode
    const s = ep(c.Source); if (s !== undefined) v.source = s
    const t = ep(c.Target); if (t !== undefined) v.target = t
    const label = captureConnectorLabel(c); if (label !== undefined) v.label = label
    if (Panel.GetZIndex(c) !== Connector.DefaultZIndex) v.zIndex = Panel.GetZIndex(c)
    return v
}

// Apply a saved visual onto a freshly-projected connector (before the listeners
// that capture edits are wired, so this restore doesn't echo back).
export function applyConnectorVisual(c: Connector, v: ConnectorVisual): void
{
    if (v.waypoints !== undefined && v.waypoints.length > 0)
        c.Waypoints = v.waypoints.map((w) => ({ point: new Point(w.x, w.y), userAltered: w.userAltered }))
    if (v.routingMode !== undefined) c.RoutingMode = v.routingMode
    if (v.source !== undefined && c.Source !== undefined) {
        if (v.source.portSide !== undefined) c.Source.PortSide = v.source.portSide
        if (v.source.portIndex !== undefined) c.Source.PortIndex = v.source.portIndex
    }
    if (v.target !== undefined && c.Target !== undefined) {
        if (v.target.portSide !== undefined) c.Target.PortSide = v.target.portSide
        if (v.target.portIndex !== undefined) c.Target.PortIndex = v.target.portIndex
    }
    if (v.label !== undefined) applyConnectorLabel(c, v.label)
    if (v.zIndex !== undefined) Panel.SetZIndex(c, v.zIndex)
}
