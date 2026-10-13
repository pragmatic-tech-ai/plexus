// help-hotspot-adorner.ts — the "?" chip that appears on hover next to a control
// tagged with Help.Topic. Display only: the controller opens the flyout from a
// root-level PointerDown (the chip lives in the IsHitTestVisible=false adorner
// layer, so its own click routing is unreliable).
import { Adorner, AdornerLayer, Rect, Size } from '@pragmatic-tech-ai/mural/visual-engine'
import type { Visual } from '@pragmatic-tech-ai/mural/visual-engine'
import { Button } from '@pragmatic-tech-ai/mural/framework'

// Type hook only: its look (round "?" chip) is authored as
// `Style [TargetType = HelpHotspotButton]` in help-overlay.resources.mu.
export class HelpHotspotButton extends Button {}

const HOTSPOT = 18   // px, square
const INSET   = 2    // px from the control's top-right corner

export class HelpHotspotAdorner extends Adorner
{
    private readonly button = new HelpHotspotButton()

    constructor(adorned: Visual)
    {
        super(adorned)
        this.AttachVisual(this.button)
    }

    public override get visualChildren(): Visual[] { return [this.button] }

    protected override MeasureOverride(_available: Size): Size
    {
        this.button.Measure(new Size(HOTSPOT, HOTSPOT))
        return new Size(HOTSPOT, HOTSPOT)
    }

    // Pin a fixed-size chip to the adorned control's top-right corner.
    public override Placement(adornedRect: Rect, _desiredSize: Size): Rect
    {
        const x = adornedRect.X + adornedRect.Width - HOTSPOT - INSET
        const y = adornedRect.Y + INSET
        return new Rect(x, y, HOTSPOT, HOTSPOT)
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        this.button.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height))
        return finalSize
    }

    public static Attach(adorned: Visual):
        { adorner: HelpHotspotAdorner; detach: () => void } | undefined
    {
        const layer = AdornerLayer.GetAdornerLayer(adorned)
        if (layer === undefined) return undefined
        const adorner = new HelpHotspotAdorner(adorned)
        layer.Add(adorner)
        return { adorner, detach: () => { layer.Remove(adorner) } }
    }
}
