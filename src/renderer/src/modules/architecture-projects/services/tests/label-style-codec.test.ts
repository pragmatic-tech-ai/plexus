import { test, expect } from 'vitest'
import { SolidColorBrush, Color, FontWeight, FontStyle, TextAlignment, TextDecorations } from '@pragmatic-tech-ai/mural/visual-engine'
import { LabelStyleCodec, type LabelStyle } from '../label-style-codec.js'

test('Serialize returns undefined for an empty style (unstyled label carries nothing)', () => {
    expect(LabelStyleCodec.Serialize({})).toBeUndefined()
})

test('Serialize emits only the set overrides; foreground as hex', () => {
    const s: LabelStyle = {
        fontFamily: 'Arial',
        fontSize: 18,
        foreground: new SolidColorBrush(Color.FromHex('#112233')),
        fontWeight: FontWeight.Bold,
        fontStyle: FontStyle.Italic,
        textDecorations: TextDecorations.Underline,
        textAlignment: TextAlignment.Center,
    }
    expect(LabelStyleCodec.Serialize(s)).toEqual({
        fontFamily: 'Arial',
        fontSize: 18,
        foreground: '#112233',
        fontWeight: FontWeight.Bold,
        fontStyle: FontStyle.Italic,
        textDecorations: TextDecorations.Underline,
        textAlignment: TextAlignment.Center,
    })
})

test('Serialize omits a non-solid (or absent) foreground', () => {
    expect(LabelStyleCodec.Serialize({ fontSize: 12 })).toEqual({ fontSize: 12 })
})

test('round-trips a full style through Serialize → Deserialize', () => {
    const s: LabelStyle = {
        fontFamily: 'Georgia',
        fontSize: 20,
        foreground: new SolidColorBrush(Color.FromHex('#abcdef')),
        fontWeight: FontWeight.Bold,
        fontStyle: FontStyle.Italic,
        textDecorations: TextDecorations.Strikethrough,
        textAlignment: TextAlignment.Right,
    }
    const back = LabelStyleCodec.Deserialize(LabelStyleCodec.Serialize(s))
    expect(back.fontFamily).toBe('Georgia')
    expect(back.fontSize).toBe(20)
    expect(back.foreground).toBeInstanceOf(SolidColorBrush)
    expect((back.foreground as SolidColorBrush).Color.ToHex()).toBe('#abcdef')
    expect(back.fontWeight).toBe(FontWeight.Bold)
    expect(back.fontStyle).toBe(FontStyle.Italic)
    expect(back.textDecorations).toBe(TextDecorations.Strikethrough)
    expect(back.textAlignment).toBe(TextAlignment.Right)
})

test('Deserialize degrades a malformed block to an empty style', () => {
    expect(LabelStyleCodec.Deserialize(null)).toEqual({})
    expect(LabelStyleCodec.Deserialize('nope')).toEqual({})
    expect(LabelStyleCodec.Deserialize({ fontSize: 'big' })).toEqual({}) // wrong type ignored
})
