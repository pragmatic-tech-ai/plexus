import { Size } from '@pragmatic-tech-ai/mural/runtime'
import type { Diagram, DiagramDocument, ExternalDroppedArgs } from '@pragmatic-tech-ai/mural/framework'
import type { IStorage } from '@pragmatic-tech-ai/todl-runtime'
import { classifyFile, classifyUri } from './classify-media'
import { MediaKind } from './media-kind'
import { LargeFileChoice, resolveDroppedFile } from './media-storage'
import { MediaNodeVM } from './media-node-vm'

export interface MediaDropDeps
{
    storage: IStorage
    promptLargeFile: (name: string) => Promise<LargeFileChoice>
    newId: () => string
    // Injected for tests; production uses a browser HTMLImageElement decode.
    measure?: (uri: string) => Promise<Size | undefined>
}

export interface DroppedItem { file?: File; uri?: string }

// Fallback box for an image whose natural size can't be decoded, and the fixed
// height of a file/hyperlink chip.
const IMAGE_DEFAULT = new Size(160, 120)
const CHIP_HEIGHT = 40
const CASCADE_STEP = 16

// Turn one dropped file/URI into a positioned-ready MediaNodeVM. Pure except for
// the injected storage — unit-tested directly.
export async function buildMediaNode(
    item: DroppedItem, deps: MediaDropDeps,
): Promise<{ vm: MediaNodeVM; natural?: Size }>
{
    const vm = new MediaNodeVM()
    vm.Id = deps.newId()

    if (item.file !== undefined) {
        const file = item.file
        const kind = classifyFile(file)
        const bytes = new Uint8Array(await file.arrayBuffer())
        // Electron's File carries a non-standard absolute .path; used for Link mode.
        const osPath = (file as unknown as { path?: string }).path
        const resolved = await resolveDroppedFile(
            { name: file.name, kind, bytes, osPath },
            { storage: deps.storage, promptLargeFile: deps.promptLargeFile },
        )
        vm.MediaKind = kind
        vm.Source = resolved.source
        vm.Label = resolved.label
        if (kind !== MediaKind.Image && osPath !== undefined) vm.HyperlinkUri = osPath
    } else {
        const uri = item.uri as string
        const kind = classifyUri(uri)
        vm.MediaKind = kind
        vm.Source = uri
        vm.Label = uri
        vm.HyperlinkUri = uri
    }

    const natural = await vm.LoadAsync({ storage: deps.storage, baseDir: '', measure: deps.measure })
    return { vm, natural }
}

// Place a built node at (x, y) with a size derived from its kind/natural size.
function placeNode(doc: DiagramDocument, vm: MediaNodeVM, natural: Size | undefined, x: number, y: number): void
{
    const size = natural ?? IMAGE_DEFAULT
    doc.SetNodeVisual(vm.Id as string, {
        left: x,
        top:  y,
        w:    size.Width,
        h:    vm.MediaKind === MediaKind.Image ? size.Height : CHIP_HEIGHT,
    })
    doc.AddNode(vm)
}

// Build + place every item in a drop, cascading so multiple items don't stack
// exactly. Shared by the drop and paste paths.
export async function placeDroppedItems(
    items: readonly DroppedItem[], doc: DiagramDocument, deps: MediaDropDeps, originX: number, originY: number,
): Promise<void>
{
    let offset = 0
    for (const item of items) {
        const { vm, natural } = await buildMediaNode(item, deps)
        placeNode(doc, vm, natural, originX + offset, originY + offset)
        offset += CASCADE_STEP
    }
}

// Subscribe to the diagram view's ExternalDropped and materialize media nodes.
export function attachMediaDrop(view: Diagram, doc: DiagramDocument, deps: MediaDropDeps): () => void
{
    const onExternal = (args: ExternalDroppedArgs): void => {
        const items: DroppedItem[] = [
            ...args.Files.map((file) => ({ file })),
            ...args.Uris.map((uri) => ({ uri })),
        ]
        void placeDroppedItems(items, doc, deps, args.Position.X, args.Position.Y)
    }
    view.AddExternalDroppedListener(onExternal)
    return (): void => view.RemoveExternalDroppedListener(onExternal)
}

// Extract image/file payloads from a clipboard DataTransfer (Ctrl+V). Only
// `file` items yield media (a pasted screenshot arrives as an image File).
export function pasteItemsFromClipboard(data: DataTransfer): DroppedItem[]
{
    const out: DroppedItem[] = []
    const items = data.items
    for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.kind === 'file') {
            const file = it.getAsFile()
            if (file !== null) out.push({ file })
        }
    }
    return out
}

// Paste a clipboard image onto the diagram (Ctrl+V). Listens at the document
// level but only acts when THIS view holds keyboard focus, so paste isn't
// hijacked from other panels or a sibling diagram. Places at the view centre.
export function attachMediaPaste(view: Diagram, doc: DiagramDocument, deps: MediaDropDeps): () => void
{
    const onPaste = (e: ClipboardEvent): void => {
        if (!view.IsKeyboardFocusWithin || e.clipboardData === null) return
        const items = pasteItemsFromClipboard(e.clipboardData)
        if (items.length === 0) return
        e.preventDefault()
        const r = view.ArrangedRect
        const centre = view.HostToContent(r.Width / 2, r.Height / 2)
        void placeDroppedItems(items, doc, deps, centre.X, centre.Y)
    }
    document.addEventListener('paste', onPaste)
    return (): void => document.removeEventListener('paste', onPaste)
}

// Restore BitmapImages for image media nodes after a document is loaded from
// disk (deserialize rebuilds the VM but not its bitmap).
export async function reloadMediaBitmaps(doc: DiagramDocument, storage: IStorage): Promise<void>
{
    for (const node of doc.Nodes.ToArray()) {
        if (node instanceof MediaNodeVM) await node.LoadAsync({ storage, baseDir: '' })
    }
}
