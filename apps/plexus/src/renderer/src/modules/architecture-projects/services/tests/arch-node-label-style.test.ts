import { test, expect, beforeAll } from 'vitest'
import { Application } from '@pragmatic-tech-ai/mural/runtime'
import { Color, FontStyle, FontWeight, SolidColorBrush, TextAlignment } from '@pragmatic-tech-ai/mural/visual-engine'
import { ArchNodeVM } from '../arch-node-vm.js'

// The ArchNodeVM.TextStyle adapter is what mural's FormatMirror seeds from and
// broadcasts to for the node's $Label tile (Format Shape → Text page). Apply*
// write the per-node Label* DPs (which the tile template binds); Current* read
// the effective value the toolbar reflects, defaulting to the @BodySmall look.

beforeAll(() => { Application.current = null; new Application() })

test('unset defaults reflect the @BodySmall / Center look', () => {
    const vm = new ArchNodeVM()
    const t = vm.TextStyle
    expect(t.CurrentFontSize()).toBe(12)
    expect(t.CurrentFontFamily()).toBe('')
    expect(t.CurrentForeground()).toBeUndefined()
    expect(t.CurrentBold()).toBe(false)
    expect(t.CurrentItalic()).toBe(false)
    expect(t.CurrentUnderline()).toBe(false)
    expect(t.CurrentStrikethrough()).toBe(false)
    expect(t.CurrentParagraphAlignment()).toBe(TextAlignment.Center)
    // Untouched → DPs stay undefined so the template keeps @BodySmall (no drift).
    expect(vm.LabelFontSize).toBeUndefined()
    expect(vm.LabelForeground).toBeUndefined()
})

test('Apply* write the DPs and Current* read them back', () => {
    const vm = new ArchNodeVM()
    const t = vm.TextStyle
    t.ApplyFontSize(18)
    t.ApplyFontFamily('Georgia')
    t.ApplyBold(true)
    t.ApplyItalic(true)
    t.ApplyParagraphAlignment(TextAlignment.Right)
    t.ApplyForeground(new SolidColorBrush(Color.FromHex('#00ff00')))

    expect(vm.LabelFontSize).toBe(18)
    expect(t.CurrentFontSize()).toBe(18)
    expect(vm.LabelFontFamily).toBe('Georgia')
    expect(t.CurrentFontFamily()).toBe('Georgia')
    expect(vm.LabelFontWeight).toBe(FontWeight.Bold)
    expect(t.CurrentBold()).toBe(true)
    expect(vm.LabelFontStyle).toBe(FontStyle.Italic)
    expect(t.CurrentItalic()).toBe(true)
    expect(t.CurrentParagraphAlignment()).toBe(TextAlignment.Right)
    expect((vm.LabelForeground as SolidColorBrush).Color.ToHex().toLowerCase().slice(0, 7)).toBe('#00ff00')
})

test('turning bold off restores the (default) weight, and Current tracks it', () => {
    const vm = new ArchNodeVM()
    const t = vm.TextStyle
    t.ApplyBold(true)
    expect(t.CurrentBold()).toBe(true)
    t.ApplyBold(false)
    expect(t.CurrentBold()).toBe(false)
    expect(vm.LabelFontWeight).toBe(FontWeight.Normal)
})

test('underline + strikethrough coexist in the decoration flags', () => {
    const vm = new ArchNodeVM()
    const t = vm.TextStyle
    t.ApplyUnderline(true)
    t.ApplyStrikethrough(true)
    expect(t.CurrentUnderline()).toBe(true)
    expect(t.CurrentStrikethrough()).toBe(true)
    // Clearing one leaves the other set.
    t.ApplyUnderline(false)
    expect(t.CurrentUnderline()).toBe(false)
    expect(t.CurrentStrikethrough()).toBe(true)
})

test('TextStyle returns a stable adapter instance', () => {
    const vm = new ArchNodeVM()
    expect(vm.TextStyle).toBe(vm.TextStyle)
})
