// A linear undo/redo history of SVG markup snapshots (the document's Content).
// One entry per committed visual gesture; the visual tab pushes on gesture end
// (drags are coalesced by the caller — one push per gesture, not per move).
export class SvgHistory
{
    private stack: string[]
    private index = 0

    public constructor(initial: string) { this.stack = [initial] }

    public current(): string { return this.stack[this.index] }
    public canUndo(): boolean { return this.index > 0 }
    public canRedo(): boolean { return this.index < this.stack.length - 1 }

    // Record a new snapshot. A snapshot equal to the current one records nothing
    // (a gesture that left the markup unchanged). Pushing truncates any redo tail.
    public push(snapshot: string): void
    {
        if (snapshot === this.current()) return
        this.stack = this.stack.slice(0, this.index + 1)
        this.stack.push(snapshot)
        this.index = this.stack.length - 1
    }

    public undo(): string | undefined
    {
        if (!this.canUndo()) return undefined
        this.index -= 1
        return this.current()
    }

    public redo(): string | undefined
    {
        if (!this.canRedo()) return undefined
        this.index += 1
        return this.current()
    }

    // Re-baseline after an external Content change (text-tab edit) so the next
    // gesture branches from the new state rather than the stale stack.
    public reset(snapshot: string): void { this.stack = [snapshot]; this.index = 0 }
}
