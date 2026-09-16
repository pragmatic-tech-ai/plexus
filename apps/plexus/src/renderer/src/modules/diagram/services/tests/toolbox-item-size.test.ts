import { test, expect } from 'vitest'
import { ResourceDictionary } from '@pragmatic-tech-ai/mural/runtime'

import { applyToolboxItemSize, ITEM_WIDTH_RESOURCE, ITEM_HEIGHT_RESOURCE } from '../diagram-panel-services.js'

test('mirrors the numeric toolbox item size settings into the resource dictionary', () => {
    const rd = new ResourceDictionary()
    applyToolboxItemSize(
        { Get: (k) => (k === 'toolbox.item.width' ? 64 : k === 'toolbox.item.height' ? 40 : undefined) },
        rd,
    )
    expect(rd.Get(ITEM_WIDTH_RESOURCE)).toBe(64)
    expect(rd.Get(ITEM_HEIGHT_RESOURCE)).toBe(40)
})

test('falls back to 48 when a setting is missing or not a number', () => {
    const rd = new ResourceDictionary()
    applyToolboxItemSize({ Get: () => undefined }, rd)
    expect(rd.Get(ITEM_WIDTH_RESOURCE)).toBe(48)
    expect(rd.Get(ITEM_HEIGHT_RESOURCE)).toBe(48)
})
