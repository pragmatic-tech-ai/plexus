// help-flyout-adorner.ts — the flyout card rendering one help scenario.
import { Adorner, AdornerLayer, Rect, Size } from '@pragmatic-tech-ai/mural/visual-engine'
import type { Visual } from '@pragmatic-tech-ai/mural/visual-engine'
import { ContentControl } from '@pragmatic-tech-ai/mural/framework'
import { RichTextBlock } from '@pragmatic-tech-ai/mural/basic'
import type { FlowDocument } from '@pragmatic-tech-ai/mural/basic'

const WIDTH = 320   // px card width; height measured from content, capped by the card Template.
const GAP   = 8     // px between the control and the card

// Look (border, elevation, padding, max-height + scroll) authored as
// `Style [TargetType = HelpFlyoutCard]` in help-overlay.resources.mu.
export class HelpFlyoutCard extends ContentControl {}

export class HelpFlyoutAdorner extends Adorner
{
    private readonly card = new HelpFlyoutCard()

    constructor(adorned: Visual, doc: FlowDocument)
    {
        super(adorned)
        const view = new RichTextBlock()
        view.Document = doc
        this.card.Content = view
        this.AttachVisual(this.card)
    }

    public override get visualChildren(): Visual[] { return [this.card] }

    protected override MeasureOverride(available: Size): Size
    {
        this.card.Measure(new Size(WIDTH, available.Height))
        return new Size(WIDTH, this.card.DesiredSize.Height)
    }

    // Prefer below-left-aligned with the control; the layer clamps within bounds.
    public override Placement(adornedRect: Rect, desiredSize: Size): Rect
    {
        const x = adornedRect.X
        const y = adornedRect.Y + adornedRect.Height + GAP
        return new Rect(x, y, WIDTH, desiredSize.Height)
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        this.card.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height))
        return finalSize
    }

    public static Attach(adorned: Visual, doc: FlowDocument):
        { adorner: HelpFlyoutAdorner; detach: () => void } | undefined
    {
        const layer = AdornerLayer.GetAdornerLayer(adorned)
        if (layer === undefined) return undefined
        const adorner = new HelpFlyoutAdorner(adorned, doc)
        layer.Add(adorner)
        return { adorner, detach: () => { layer.Remove(adorner) } }
    }
}
