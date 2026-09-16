import { ServiceBase, ServiceKey, type IServiceProvider } from '@pragmatic-tech-ai/mural/runtime'

// A writer that persists text to the system clipboard. Injected so tests capture
// the text without touching the real clipboard.
export type ClipboardWriter = (text: string) => Promise<void>

// Thin, injectable clipboard seam. The default writer targets the renderer's
// navigator.clipboard; tests pass a fake. Consumers (the Problems popup's
// copy-all + per-row copy) resolve this via ClipboardService.Key.
export class ClipboardService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ClipboardService>('ClipboardService')

    private readonly write: ClipboardWriter

    constructor(provider: IServiceProvider, writer: ClipboardWriter = (t) => navigator.clipboard.writeText(t))
    {
        super(provider)
        this.write = writer
    }

    public writeText(text: string): Promise<void> { return this.write(text) }
}
