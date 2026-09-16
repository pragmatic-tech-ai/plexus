// flow-style.ts — shared FlowDocument styling helpers for the markdown renderers.
//
// Theme-token binding, the monospace stack, heading sizes, block spacing, and the
// inline-code chip live here so the full marked-based renderer and any other
// FlowDocument builder share one visual vocabulary. All colours bind to theme
// tokens (DynamicResource) so rendered markdown tracks light/dark like the chrome.
import { Border, InlineUIContainer, TextBlock } from '@pragmatic-tech-ai/mural/basic'
import { DynamicResource, MuralBase, type PropertyKey, Thickness } from '@pragmatic-tech-ai/mural/runtime'

// Monospace stack for code (inline chips + fenced blocks).
export const MONO = 'Consolas, "SF Mono", "Courier New", monospace'
export const BASE_SIZE = 14
// A little extra leading over the ~17px natural line so body text breathes.
export const BODY_LINE_HEIGHT = 21
// h1..h6 point sizes (h5/h6 fall back to base; Bold carries their emphasis).
export const HEADING_SIZE: readonly number[] = [24, 20, 17, 15, BASE_SIZE, BASE_SIZE]
// Non-breaking space — keeps code indentation from collapsing in layout.
export const NBSP = ' '

// Standard gap below a block so paragraphs / lists / headings breathe.
export function blockGap(): Thickness { return new Thickness(0, 0, 0, 8) }

// Bind a DP to a theme token via DynamicResource. set_property_value is typed to
// the DP's value, but the runtime also accepts a Binding here (the documented
// DynamicResource pattern) — it resolves against the ambient theme and tracks
// light/dark swaps. The cast is the static-typing tax on that pattern.
export function bindTheme<T>(target: MuralBase, key: PropertyKey<T>, token: string): void
{
    target.set_property_value(key, DynamicResource(target, token) as unknown as T)
}

// Inline code renders as a CHIP — a rounded, tinted Border wrapping a monospace
// label — embedded in the flow through an InlineUIContainer (runs carry no
// background). Colours come from theme tokens so it tracks light/dark.
export function codeChip(text: string): InlineUIContainer
{
    const label = new TextBlock(text)
    label.FontFamily = MONO
    bindTheme(label, TextBlock.ForegroundKey, 'OnSurface')

    const chip = new Border(label)
    chip.CornerRadius = 4
    chip.Padding = new Thickness(5, 3, 5, 0)
    bindTheme(chip, Border.FillKey, 'SurfaceContainerHigh')
    return new InlineUIContainer(chip)
}

// Keep leading indentation visible — layout collapses ordinary leading spaces, so
// swap them for non-breaking spaces (a tab counts as four).
export function preserveIndent(line: string): string
{
    return line.replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, '    ').replace(/ /g, NBSP))
}
