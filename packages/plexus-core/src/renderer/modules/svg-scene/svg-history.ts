// A linear undo/redo history of SVG markup snapshots (the document's Content).
// One entry per committed visual gesture; the visual tab pushes on gesture end
// (drags are coalesced by the caller — one push per gesture, not per move).
export class SvgHistory
{
    private stack: string[]
    private index = 0

    public constructor(initial: string) { this.stack = [initial] }

    public Current(): string { return this.stack[this.index] }
    public CanUndo(): boolean { return this.index > 0 }
    public CanRedo(): boolean { return this.index < this.stack.length - 1 }

    // Record a new snapshot. A snapshot equal to the current one records nothing
    // (a gesture that left the markup unchanged). Pushing truncates any redo tail.
    public Push(snapshot: string): void
    {
        if (snapshot === this.Current()) return
        this.stack = this.stack.slice(0, this.index + 1)
        this.stack.push(snapshot)
        this.index = this.stack.length - 1
    }

    public Undo(): string | undefined
    {
        if (!this.CanUndo()) return undefined
        this.index -= 1
        return this.Current()
    }

    public Redo(): string | undefined
    {
        if (!this.CanRedo()) return undefined
        this.index += 1
        return this.Current()
    }

    // Re-baseline after an external Content change (text-tab edit) so the next
    // gesture branches from the new state rather than the stale stack.
    public Reset(snapshot: string): void { this.stack = [snapshot]; this.index = 0 }
}
