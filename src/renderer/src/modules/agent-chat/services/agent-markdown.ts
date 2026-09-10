// agent-markdown.ts — the agent-chat assistant-bubble markdown renderer.
//
// Assistant replies are markdown; the transcript renders them into a FlowDocument
// a RichTextBlock lays out. This uses the full `renderMarkdown` (the same renderer
// the .md viewer uses) so an image the agent references — `![alt](path)` — is
// DRAWN, not dropped, alongside highlighted code and full GFM.
//
// Image resolution differs from the viewer: the agent works in an ABSOLUTE OS cwd,
// so a relative image path resolves against that directory and its bytes are read
// through the file-system bridge (window.api.fs), not a project-relative IStorage.
// `http(s)/data/blob` URIs pass straight through. The doc rebuilds on every token
// delta while a reply streams, so bytes (an IPC round-trip) and decoded sizes are
// cached per path/uri — a settled image isn't re-read on each subsequent delta.
import { Size } from '@pragmatic-tech-ai/mural/runtime'
import { FlowDocument } from '@pragmatic-tech-ai/mural/basic'
import type { IFileSystemApi } from '../../../../../shared/file-system-api.js'
import { renderMarkdown } from '../../../services/markdown/marked-flow-renderer.js'
import type { ImageByteSource } from '../../../services/markdown/markdown-image.js'

// Reads raw bytes from an ABSOLUTE OS path — the file-system bridge's readBytes,
// injectable so the renderer unit-tests headless.
export type FsBytesReader = (absolutePath: string) => Promise<Uint8Array>

// Decodes a URI to its intrinsic pixel size, or undefined when it can't be loaded
// (no DOM in tests, or a broken image). Injectable for the same reason.
export type ImageDecoder = (uri: string) => Promise<Size | undefined>

// An ImageByteSource over absolute OS paths, caching each read so a streamed
// reply's repeated re-renders don't re-fetch the same picture. `markdown-image`
// only calls ReadBytes on the storage, so nothing else is implemented.
class AbsolutePathImageStorage implements ImageByteSource
{
    private readonly reader: FsBytesReader
    private readonly cache = new Map<string, Promise<Uint8Array>>()

    constructor(reader?: FsBytesReader)
    {
        this.reader = reader ?? AbsolutePathImageStorage.bridgeReader()
    }

    public ReadBytes(path: string): Promise<Uint8Array>
    {
        const hit = this.cache.get(path)
        if (hit !== undefined) return hit
        // Cache the PROMISE so concurrent renders share one round-trip. A rejection
        // is dropped from the cache so a transient failure can be retried later.
        const pending = this.reader(path).catch((e) => { this.cache.delete(path); throw e })
        this.cache.set(path, pending)
        return pending
    }

    // Default reader: the renderer-side file-system bridge. Absent outside the
    // desktop host (tests) → a rejected read, which markdown-image swallows.
    private static bridgeReader(): FsBytesReader
    {
        return (path) => {
            const fs = (globalThis as unknown as { api?: { fs?: IFileSystemApi } }).api?.fs
            if (fs === undefined) return Promise.reject(new Error('window.api.fs unavailable'))
            return fs.readBytes(path)
        }
    }
}

export class AgentMarkdownRenderer
{
    private readonly storage: AbsolutePathImageStorage
    private readonly decoder: ImageDecoder
    private readonly sizeCache = new Map<string, Promise<Size | undefined>>()

    constructor(reader?: FsBytesReader, decoder?: ImageDecoder)
    {
        this.storage = new AbsolutePathImageStorage(reader)
        this.decoder = decoder ?? AgentMarkdownRenderer.browserDecoder()
    }

    // Render assistant markdown into a FlowDocument. `baseDir` is the conversation's
    // absolute cwd; relative image paths resolve against it. Passed per call (read
    // lazily by the caller) so a conversation whose cwd binds after construction
    // still resolves correctly.
    public render(text: string, baseDir: string): FlowDocument
    {
        return renderMarkdown(text, {
            image: { storage: this.storage, baseDir, measure: (uri) => this.decode(uri) },
            openLink: AgentMarkdownRenderer.openExternal,
        })
    }

    // Memoised decode — the same (cached-bytes) data URI recurs on every streaming
    // delta, so decode it once.
    private decode(uri: string): Promise<Size | undefined>
    {
        const hit = this.sizeCache.get(uri)
        if (hit !== undefined) return hit
        const pending = this.decoder(uri)
        this.sizeCache.set(uri, pending)
        return pending
    }

    // Browser image decode via HTMLImageElement; undefined off the main thread.
    private static browserDecoder(): ImageDecoder
    {
        return (uri) => {
            const Ctor = (globalThis as { Image?: new () => HTMLImageElement }).Image
            if (Ctor === undefined) return Promise.resolve(undefined)
            return new Promise((resolve) => {
                const el = new Ctor()
                el.onload = (): void => resolve(new Size(el.naturalWidth, el.naturalHeight))
                el.onerror = (): void => resolve(undefined)
                el.src = uri
            })
        }
    }

    // Best-effort external open for a clicked link (matches the .md viewer). Guarded
    // so the module stays safe outside a renderer window.
    private static openExternal(uri: string): void
    {
        if (typeof window !== 'undefined' && typeof window.open === 'function')
            window.open(uri, '_blank', 'noopener')
    }
}
