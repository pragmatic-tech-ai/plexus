// help-overlay.resources.mu — chrome for the help overlay: the round "?" hotspot
// chip and the scenario flyout card. Both are sized by their adorners (which
// arrange them to a fixed rect), so the templates carry look, not layout size.

import HelpHotspotButton from "./help-hotspot-adorner.js"
import HelpFlyoutCard from "./help-flyout-adorner.js"

resources HelpOverlayResources {

    // The round "?" chip. The adorner arranges it to an 18×18 rect, so the
    // Border just fills; CornerRadius rounds it to a circle.
    Template x:key="HelpHotspotButtonTemplate" [ TargetType = HelpHotspotButton ] {
        Border x:name="PART_Border" [ Fill = @Primary, CornerRadius = 9 ] {
            TextBlock [ Text = "?", Foreground = @OnPrimary,
                        HorizontalAlignment = Center, VerticalAlignment = Center, FontSize = 12 ]
        }
        when ( IsMouseOver ) { PART_Border.Fill = @PrimaryContainer; }
    }

    Style [ TargetType = HelpHotspotButton ] {
        Template = @HelpHotspotButtonTemplate;
    }

    // The flyout card hosting the scenario RichTextBlock (surfaced via
    // ContentPresenter). MaxHeight caps it; the ScrollViewer scrolls overflow.
    Template x:key="HelpFlyoutCardTemplate" [ TargetType = HelpFlyoutCard ] {
        Border [ Fill = @Surface, Stroke = Pen [ Brush = @Outline ], CornerRadius = @ShapeSmall,
                 Padding = (@Spacing3,@Spacing3,@Spacing3,@Spacing3), MaxHeight = 360 ] {
            ScrollViewer [ HorizontalScrollEnabled = false ] {
                ContentPresenter {}
            }
        }
    }

    Style [ TargetType = HelpFlyoutCard ] {
        Template = @HelpFlyoutCardTemplate;
    }
}
