import { describe, test, expect } from 'vitest'
import { AdornerDecorator } from '@pragmatic-tech-ai/mural/visual-engine'
import { Border, FlowDocument, Paragraph, Run } from '@pragmatic-tech-ai/mural/basic'
import { HelpFlyoutAdorner } from '../help-flyout-adorner.js'

function doc(): FlowDocument
{
    const d = new FlowDocument()
    const p = new Paragraph()
    p.AddChild(new Run('hello'))
    d.AddChild(p)
    return d
}

describe('HelpFlyoutAdorner', () => {
    test('Attach returns undefined when no adorner layer is reachable', () => {
        expect(HelpFlyoutAdorner.Attach(new Border(), doc())).toBeUndefined()
    })

    test('Attach adds a flyout under an AdornerDecorator; detach removes it', () => {
        const deco = new AdornerDecorator()
        const child = new Border()
        deco.Child = child
        const res = HelpFlyoutAdorner.Attach(child, doc())
        expect(res).toBeDefined()
        expect(deco.AdornerLayer.GetAdorners(child)?.length).toBe(1)
        res!.detach()
        expect(deco.AdornerLayer.GetAdorners(child)?.length ?? 0).toBe(0)
    })
})
