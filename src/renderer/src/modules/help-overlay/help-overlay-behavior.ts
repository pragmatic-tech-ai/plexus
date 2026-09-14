// help-overlay-behavior.ts — shell-attached hover→"?"→flyout controller.
import { Help } from '@pragmatic-tech-ai/mural/visual-engine'
import type { Visual } from '@pragmatic-tech-ai/mural/visual-engine'
import type { PointerEventArgs } from '@pragmatic-tech-ai/mural/runtime'
import { HelpDocumentStore } from './help-document-store.js'
import { HelpHotspotAdorner } from './help-hotspot-adorner.js'
import { HelpFlyoutAdorner } from './help-flyout-adorner.js'

// Watches pointer movement over the shell root, shows a "?" hotspot for the
// nearest ancestor tagged with a resolvable Help.Topic, and opens a scenario
// flyout when the hotspot is clicked. Holds only view-transient state.
export class HelpOverlayController
{
    private target: Visual | undefined
    private hotspot: { detach: () => void } | undefined
    private flyout: { detach: () => void } | undefined
    private readonly onMove = (args: unknown): void =>
        this.handleMove((args as PointerEventArgs).Source as unknown as Visual)

    constructor(private readonly root: Visual, private readonly store: HelpDocumentStore)
    {
        // PointerMove bubbles to the root; args.Source is the hit-tested leaf.
        this.root.AddRoutedEventListener('PointerMove', this.onMove)
    }

    public get CurrentTarget(): Visual | undefined { return this.target }

    public handleMove(source: Visual): void
    {
        const found = this.findTarget(source)
        if (found === this.target) return
        this.clearHotspot()
        this.target = found
        if (found !== undefined) this.hotspot = HelpHotspotAdorner.Attach(found, () => this.openFlyout(found)) ?? undefined
    }

    // Nearest ancestor (inclusive) with a non-empty Help.Topic that resolves to a
    // known scenario. Returns undefined if none.
    private findTarget(from: Visual): Visual | undefined
    {
        let cur: Visual | undefined = from
        while (cur !== undefined) {
            const topic = Help.GetTopic(cur)
            if (topic !== '') {
                const parts = Help.ParseTopic(topic)
                if (parts !== undefined && this.store.hasScenario(parts.docId, parts.anchor)) return cur
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
        const doc = this.store.getScenario(parts.docId, parts.anchor)
        if (doc === undefined) return
        this.flyout = HelpFlyoutAdorner.Attach(target, doc) ?? undefined
    }

    private clearHotspot(): void { this.hotspot?.detach(); this.hotspot = undefined }

    public dispose(): void
    {
        this.clearHotspot()
        this.flyout?.detach(); this.flyout = undefined
        this.root.RemoveRoutedEventListener('PointerMove', this.onMove)
    }
}

// Sanctioned behavior entry (mirrors attachAutoOpenInspector): construct the
// controller against the shell root, return its dispose thunk.
export function attachHelpOverlay(root: Visual, store: HelpDocumentStore): () => void
{
    const controller = new HelpOverlayController(root, store)
    return () => controller.dispose()
}
