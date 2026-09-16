import { MuralBase, MetaData, type PropertyDescriptor } from '@pragmatic-tech-ai/mural/runtime'
import { Brush, Pen } from '@pragmatic-tech-ai/mural/visual-engine'
import { SvgStyleProp } from './svg-style-prop.js'

// The Format Shape "sink" for the SVG editor: the object a mural ShapeFormatControl
// two-way binds its Fill (Brush) and Stroke (Pen) to. Extends MuralBase — the
// justified DP exception (like SvgDocument) — because Fill/Stroke are two-way
// bound to the framework control. The SvgSceneHost Loads it from the current
// selection (suppressed) and reacts to the control's edits via Edited(): a Fill
// or Stroke change (while not loading) is a user edit routed back to the elements.
export class SvgFormatSink extends MuralBase
{
    public static readonly FillKey = MuralBase.RegisterProperty<Brush | undefined>(
        SvgFormatSink, 'Fill', undefined, MetaData.None)
    public static readonly StrokeKey = MuralBase.RegisterProperty<Pen | undefined>(
        SvgFormatSink, 'Stroke', undefined, MetaData.None)

    private loading = false
    // Set by the host: a control edit to Fill/Stroke routes here.
    public Edited?: (prop: SvgStyleProp) => void

    public get Fill(): Brush | undefined { return this.get_property_value(SvgFormatSink.FillKey) }
    public set Fill(v: Brush | undefined) { this.set_property_value(SvgFormatSink.FillKey, v) }
    public get Stroke(): Pen | undefined { return this.get_property_value(SvgFormatSink.StrokeKey) }
    public set Stroke(v: Pen | undefined) { this.set_property_value(SvgFormatSink.StrokeKey, v) }

    // Push selection values in without triggering Edited (host → sink).
    public Load(v: { fill?: Brush; stroke?: Pen }): void
    {
        this.loading = true
        this.Fill = v.fill
        this.Stroke = v.stroke
        this.loading = false
    }

    protected override OnPropertyChanged(descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue)
        if (this.loading || this.Edited === undefined) return
        if (descriptor.Name === 'Fill') this.Edited(SvgStyleProp.Fill)
        else if (descriptor.Name === 'Stroke') this.Edited(SvgStyleProp.Stroke)
    }
}
