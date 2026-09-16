import { describe, test, expect } from 'vitest'
import { AdornerDecorator } from '@pragmatic-tech-ai/mural/visual-engine'
import { Border } from '@pragmatic-tech-ai/mural/basic'
import { HelpHotspotAdorner } from '../help-hotspot-adorner.js'

describe('HelpHotspotAdorner', () => {
    test('Attach returns undefined when no adorner layer is reachable', () => {
        expect(HelpHotspotAdorner.Attach(new Border())).toBeUndefined()
    })

    test('Attach adds an adorner under an AdornerDecorator; detach removes it', () => {
        const deco = new AdornerDecorator()
        const child = new Border()
        deco.Child = child
        const res = HelpHotspotAdorner.Attach(child)
        expect(res).toBeDefined()
        expect(deco.AdornerLayer.GetAdorners(child)?.length).toBe(1)
        res!.detach()
        expect(deco.AdornerLayer.GetAdorners(child)?.length ?? 0).toBe(0)
    })
})
