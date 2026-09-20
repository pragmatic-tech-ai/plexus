// Live smoke for the help overlay: opening the Skills panel and hovering the
// "+ New Skill" button surfaces a "?" chip (HelpHotspotButton) on the shell
// adorner layer; clicking the chip opens the scenario flyout (HelpFlyoutCard).
// Unit tests cover the controller/store headless; this proves the real render +
// pointer routing in Electron.
import { test, expect } from '@playwright/test'
import { launchPlexus, appErrors, countByCtor, rectsForCtor, type Launched } from './plexus-app'

test('help overlay: hover shows the "?" chip, clicking it opens the flyout', async () => {
    const app: Launched = await launchPlexus()
    const { win, errors } = app
    try
    {
        await win.waitForTimeout(3000)

        // Open the Skills panel via its left-rail NavigationItem (matched by label —
        // SVG elements have no innerText, so we read the item's DataContext).
        const navItems = await win.evaluate(() => {
            const S = Symbol.for('mural:visual-backref')
            const label = (d: any): string => {
                if (!d) return ''
                for (const k of ['Name', 'Label', 'Title', 'Text', 'DisplayName'])
                {
                    if (typeof d[k] === 'string') return d[k]
                }
                return ''
            }
            const out: Array<{ label: string; x: number; y: number; w: number; h: number }> = []
            for (const el of document.querySelectorAll('*'))
            {
                const v = (el as any)[S]
                if (!v || v.constructor?.name !== 'NavigationItem') continue
                const r = (el as Element).getBoundingClientRect()
                out.push({ label: label(v.DataContext), x: r.x, y: r.y, w: r.width, h: r.height })
            }
            return out
        })
        const skills = navItems.find((n) => /skill/i.test(n.label))
        expect(skills, 'a Skills nav item').toBeTruthy()
        await win.mouse.click(skills!.x + skills!.w / 2, skills!.y + skills!.h / 2)
        await win.waitForTimeout(1500)

        // Hover each header-region button (a real pointer delta is required to fire
        // PointerMove) until the "?" chip appears — that's the tagged control.
        const header = (await rectsForCtor(win, 'Button'))
            .filter((b) => b.x > 40 && b.x < 400 && b.y > 40 && b.y < 200)
            .sort((a, b) => a.x - b.x)
        let chipCount = 0
        for (const b of header)
        {
            await win.mouse.move(10, 10)
            await win.waitForTimeout(80)
            await win.mouse.move(b.x + b.w / 2, b.y + b.h / 2)
            await win.waitForTimeout(300)
            chipCount = await countByCtor(win, 'HelpHotspotButton')
            if (chipCount > 0) break
        }
        expect(chipCount, 'a "?" chip appears on hover').toBeGreaterThan(0)

        // Click the chip → the scenario flyout appears.
        const chips = await rectsForCtor(win, 'HelpHotspotButton')
        await win.mouse.click(chips[0].x + chips[0].w / 2, chips[0].y + chips[0].h / 2)
        await win.waitForTimeout(600)
        expect(await countByCtor(win, 'HelpFlyoutCard'), 'the flyout opens on click').toBeGreaterThan(0)

        // The card must actually RENDER with size and host the scenario document —
        // countByCtor alone passed even when the card measured to 0×0 with no
        // content (empty ContentControl: no template, presenter behind a ScrollViewer
        // nameScope barrier). Assert real geometry + the RichTextBlock is in the tree.
        const cards = await rectsForCtor(win, 'HelpFlyoutCard')
        expect(cards.length, 'a visibly-sized flyout card').toBeGreaterThan(0)
        expect(cards[0].w, 'flyout card width').toBeGreaterThan(200)
        expect(cards[0].h, 'flyout card height (content, not just padding)').toBeGreaterThan(40)
        expect(await countByCtor(win, 'RichTextBlock'), 'scenario document rendered in the flyout').toBeGreaterThan(0)

        expect(appErrors(errors), 'no app errors').toEqual([])
    }
    finally
    {
        await app.app.close()
    }
})
