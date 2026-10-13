import { test, expect } from 'vitest'
import { SvgFormatSink } from '../svg-format-sink.js'
import { SvgStyleProp } from '../svg-style-prop.js'
import { SvgStyle } from '../svg-style.js'

test('Load sets Fill/Stroke without firing Edited', () => {
    const sink = new SvgFormatSink()
    const fired: SvgStyleProp[] = []
    sink.Edited = (p) => fired.push(p)
    sink.Load({ fill: SvgStyle.BrushFromHex('#ff0000'), stroke: SvgStyle.PenFromHex('#000000', 2) })
    expect(SvgStyle.HexFromBrush(sink.Fill)).toBe('#ff0000')
    expect(sink.Stroke?.Thickness).toBe(2)
    expect(fired).toEqual([])
})

test('a control edit (Fill/Stroke change while not loading) fires Edited', () => {
    const sink = new SvgFormatSink()
    const fired: SvgStyleProp[] = []
    sink.Edited = (p) => fired.push(p)
    sink.Fill = SvgStyle.BrushFromHex('#00ff00')
    sink.Stroke = SvgStyle.PenFromHex('#123456', 3)
    expect(fired).toEqual([SvgStyleProp.Fill, SvgStyleProp.Stroke])
})
