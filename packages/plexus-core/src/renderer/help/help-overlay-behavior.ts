// help-overlay-behavior.ts — shell-attached hover→"?"→flyout controller.
import { Help } from '@pragmatic-tech-ai/mural/visual-engine'
import type { Visual } from '@pragmatic-tech-ai/mural/visual-engine'
import type { IDisposable } from '@pragmatic-tech-ai/todl-runtime'
import type { PointerEventArgs } from '@pragmatic-tech-ai/mural/runtime'
import { HelpDocumentStore } from './help-document-store.js'
import { HelpHotspotAdorner } from './help-hotspot-adorner.js'
import { HelpFlyoutAdorner } from './help-flyout-adorner.js'

// Watches pointer movement over the shell root, shows a "?" hotspot for the
// nearest ancestor tagged with a resolvable Help.Topic, and opens a scenario
// flyout when the hotspot is clicked. Holds only view-transient state.
export class HelpOverlayController implements IDisposable
{
    private static readonly PointerMoveEvent = 'PointerMove'
    private static readonly PointerDownEvent = 'PointerDown'

    private target: Visual | undefined
    private hotspot: { detach: () => void } | undefined
    private flyout: { detach: () => void } | undefined
    private readonly onMove = (args: unknown): void =>
        this.HandleMove((args as PointerEventArgs).Source as unknown as Visual)
    private readonly onDown = (args: unknown): void =>
        this.HandleDown((args as PointerEventArgs).Source as unknown as Visual)

    constructor(private readonly root: Visual, private readonly store: HelpDocumentStore)
    {
        // Both bubble to the root; args.Source is the hit-tested leaf. We resolve
        // hover + click at the root because the chip lives in the adorner layer,
        // where a listener on the chip itself isn't reliably on the dispatch route.
        this.root.AddRoutedEventListener(HelpOverlayController.PointerMoveEvent, this.onMove)
        this.root.AddRoutedEventListener(HelpOverlayController.PointerDownEvent, this.onDown)
    }

    // A press inside the "?" chip opens the flyout for the current target.
    public HandleDown(source: Visual): void
    {
        if (this.target !== undefined && this.isWithin(source, HelpHotspotAdorner)) this.openFlyout(this.target)
    }

    public get CurrentTarget(): Visual | undefined { return this.target }

    public HandleMove(source: Visual): void
    {
        // The "?" chip and the flyout live in the adorner layer, NOT under the
        // tagged control — so a naive ancestor-walk from them finds no topic and
        // would tear the hotspot down the instant the pointer reaches it (flicker).
        // Treat "pointer is over our own overlay" as keep-current.
        if (this.isOverOverlay(source)) return
        const found = this.findTarget(source)
        if (found === this.target) return
        this.clearHotspot()
        this.clearFlyout()          // leaving the target dismisses an open flyout
        this.target = found
        if (found !== undefined) this.hotspot = HelpHotspotAdorner.Attach(found) ?? undefined
    }

    // True when `v` sits inside this controller's hotspot or flyout adorner.
    private isOverOverlay(v: Visual | undefined): boolean
    {
        return this.isWithin(v, HelpHotspotAdorner) || this.isWithin(v, HelpFlyoutAdorner)
    }

    // Walk up from `v` looking for an ancestor that is an instance of `type`.
    private isWithin(v: Visual | undefined, type: new (...args: never[]) => object): boolean
    {
        let cur: Visual | undefined = v
        while (cur !== undefined)
        {
            if (cur instanceof type) return true
            cur = cur.GetVisualParent()
        }
        return false
    }

    // Nearest ancestor (inclusive) with a non-empty Help.Topic that resolves to a
    // known scenario. Returns undefined if none.
    private findTarget(from: Visual): Visual | undefined
    {
        let cur: Visual | undefined = from
        while (cur !== undefined)
        {
            const topic = Help.GetTopic(cur)
            if (topic !== '')
            {
                const parts = Help.ParseTopic(topic)
                if (parts !== undefined && this.store.HasScenario(parts.docId, parts.anchor)) return cur
            }
            cur = cur.GetVisualParent()
        }
        return undefined
    }

    private openFlyout(target: Visual): void
    {
        this.flyout?.detach()
        this.flyout = undefined
        const parts = Help.ParseTopic(Help.GetTopic(target))
        if (parts === undefined) return
        const doc = this.store.GetScenario(parts.docId, parts.anchor)
        if (doc === undefined) return
        this.flyout = HelpFlyoutAdorner.Attach(target, doc) ?? undefined
    }

    private clearHotspot(): void { this.hotspot?.detach(); this.hotspot = undefined }
    private clearFlyout(): void { this.flyout?.detach(); this.flyout = undefined }

    public dispose(): void
    {
        this.clearHotspot()
        this.clearFlyout()
        this.root.RemoveRoutedEventListener(HelpOverlayController.PointerMoveEvent, this.onMove)
        this.root.RemoveRoutedEventListener(HelpOverlayController.PointerDownEvent, this.onDown)
    }

    // Sanctioned behavior entry (mirrors attachAutoOpenInspector): construct the
    // controller against the shell root; the controller is the disposable.
    public static Attach(root: Visual, store: HelpDocumentStore): IDisposable
    {
        return new HelpOverlayController(root, store)
    }
}
