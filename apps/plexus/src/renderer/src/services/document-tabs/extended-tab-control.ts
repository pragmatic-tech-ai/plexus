import { MuralBase, Element } from '@pragmatic-tech-ai/mural/runtime'
import { TabControl } from '@pragmatic-tech-ai/mural/framework'

// ExtendedTabControl — a mural TabControl that reserves the top-right corner of
// the tab strip for an overflow dropdown (a "Close All" primary action + the
// list of open tabs, each activating on click with its own close ✕).
//
// It's a pure RE-TEMPLATE: overriding DefaultStyleKey lands the Plexus
// `Style[TargetType=ExtendedTabControl]` (document-tabs.resources.mu), whose
// template splits the strip row into [ dropdown → Dock=Right | ItemsPresenter →
// fill ] above the unchanged content presenter. All new behaviour is expressed
// in that markup against the document host's commands (CloseAll /
// ActivateDocument / CloseDocument, resolved via `$service(ContentHostService)`),
// so the class carries only the style hook — no new state or DPs.
export class ExtendedTabControl extends TabControl
{
    static {
        MuralBase.OverrideMetadata(
            ExtendedTabControl, Element.DefaultStyleKeyKey,
            { default_value: ExtendedTabControl })
    }
}

export default ExtendedTabControl
